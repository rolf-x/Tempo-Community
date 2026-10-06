-- 0016: security hardening. One file, in this order:
--   1. Invite revoke: only an owner or admin deletes an invite (the client now deletes by token, the table's key).
--   2. Placeholder claim matches the verified GitHub identity (auth.identities), not user-editable metadata.
--   3. Removing a member revokes the agent keys they made there, and heartbeats refuse a key whose maker left.
--   4. New member rows can't carry admin or owner rights; admin stays owner-only through set_member_admin.
--   5. Heartbeats: 60 calls a minute per key (every call counts) and at most 5000 heartbeat rows per workspace.
--   6. Smaller fixes: the invite preview hides details of dead links, only a key's maker or a manager revokes it,
--      created_by / updated_by are stamped by the database, anon can't run the membership helpers.
-- Written to re-run safely: create or replace, "if not exists" and guarded policy/trigger creation, no drops.
-- Not changed on purpose: an email-bound invite is still the credential by itself (whoever opens the link and signs in
-- with that email joins), and a plain team link stays reusable until it expires.

-- ── 1. Invites: owners and admins revoke ─────────────────────────────────────────────────────────────────────────
-- 0005 already narrowed deletes to managers. Re-assert it so the rule doesn't depend on 0005 having run in full.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invites' and policyname = 'managers revoke invites') then
    create policy "managers revoke invites" on public.invites as restrictive for delete using (public.is_manager(workspace_id));
  end if;
end $$;

-- ── 5 (schema first). Per-key usage, read by the heartbeat rate limit ────────────────────────────────────────────
alter table public.ingest_keys add column if not exists last_used_at timestamptz;
alter table public.ingest_keys add column if not exists window_started_at timestamptz;
alter table public.ingest_keys add column if not exists window_calls integer not null default 0;

-- The cap below finds the 5000th newest heartbeat of a workspace; this keeps that an index-only walk.
create index if not exists activity_heartbeat_ws_at_idx on public.activity (workspace_id, at desc)
  where data->>'kind' = 'heartbeat';

-- 0010's guard refused every update that wasn't a revoke, which would also refuse the usage bookkeeping above. Same
-- rules otherwise: identity columns never change, and a revoked key stays revoked. Members still can't touch the usage
-- columns: their only column grant on ingest_keys is revoked_at (0010).
create or replace function public.guard_ingest_key_revoke() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if (new.id, new.workspace_id, new.key_hash, new.created_by, new.created_at)
     is distinct from (old.id, old.workspace_id, old.key_hash, old.created_by, old.created_at) then
    raise exception 'A key can only be revoked.';
  end if;
  if new.revoked_at is not distinct from old.revoked_at then return new; end if; -- usage bookkeeping only
  if old.revoked_at is not null then raise exception 'This key is already revoked. Make a new one instead.'; end if;
  return new;
end $$;

-- ── 3. Removed members' agent keys ───────────────────────────────────────────────────────────────────────────────
-- Security definer: whoever removes the person (owner or admin) may not be the key's maker, and the revoke must
-- happen whatever the ingest_keys update policies say.
create or replace function public.revoke_keys_of_removed_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.active and not new.active and old.user_id is not null then
    update public.ingest_keys
    set revoked_at = now()
    where workspace_id = old.workspace_id and created_by = old.user_id and revoked_at is null;
  end if;
  return null;
end $$;
revoke all on function public.revoke_keys_of_removed_member() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'members_revoke_keys_on_removal' and tgrelid = 'public.members'::regclass) then
    create trigger members_revoke_keys_on_removal after update of active on public.members
      for each row execute function public.revoke_keys_of_removed_member();
  end if;
end $$;

-- Backfill: live keys whose maker is no longer an active member of that workspace. Revoking can't be undone (the guard
-- above); someone who is later added back makes a new key, as they would after a removal from now on.
update public.ingest_keys k
set revoked_at = now()
where k.revoked_at is null
  and not exists (
    select 1 from public.members m
    where m.workspace_id = k.workspace_id and m.user_id = k.created_by and m.active
  );

-- ── 3 + 5. Heartbeat ingest ──────────────────────────────────────────────────────────────────────────────────────
-- Same payload handling and return values as 0001 ('ok' | 'unmatched', errors 'invalid key' | 'rate limited').
-- Changes: the key's maker must still be an active member; the limit is per key (60 a minute) instead of 30 matched
-- heartbeats a minute per workspace, so one leaked key can't starve teammates' agents; every call made with a live key
-- counts, matched, unmatched or malformed; and each workspace keeps its latest 5000 heartbeat rows.
-- A call with an unknown or dead key can't be counted: there is no live key row to charge, and the exception that
-- refuses it rolls back any write. It writes nothing and costs one index lookup.
create or replace function public.ingest_heartbeat(p_key text, p_payload jsonb) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  per_minute constant integer := 60;
  keep_rows constant integer := 5000;
  k public.ingest_keys%rowtype;
  repo text;
  proj text;
  agent text;
  cutoff timestamptz;
begin
  -- Count the call first (a fixed one-minute window per key). The row lock also serialises a key's concurrent calls,
  -- so the count is exact. Over the limit, the exception below rolls this back and the window stays full.
  update public.ingest_keys
  set window_calls = case when window_started_at is null or window_started_at <= now() - interval '1 minute' then 1 else window_calls + 1 end,
      window_started_at = case when window_started_at is null or window_started_at <= now() - interval '1 minute' then now() else window_started_at end,
      last_used_at = now()
  where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null
  returning * into k;
  if k.id is null then raise exception 'invalid key'; end if;
  if not exists (
    select 1 from public.members m where m.workspace_id = k.workspace_id and m.user_id = k.created_by and m.active
  ) then
    raise exception 'invalid key';
  end if;
  if k.window_calls > per_minute then raise exception 'rate limited'; end if;

  -- A malformed payload still used up a call above; it just can't match an app.
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then return 'unmatched'; end if;
  agent := coalesce(p_payload->>'agent', 'other');
  if agent not in ('claude-code', 'codex', 'cursor', 'other') then agent := 'other'; end if;

  -- git@github.com:owner/name.git | https://github.com/owner/name(.git) → owner/name
  repo := lower(substring(regexp_replace(coalesce(p_payload->>'repo', ''), '(\.git)?/*$', '') from '([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$'));
  if repo is null then return 'unmatched'; end if;
  select id into proj from public.projects where workspace_id = k.workspace_id and lower(data->'repo'->>'fullName') = repo limit 1;
  if proj is null then return 'unmatched'; end if;

  insert into public.activity (id, workspace_id, data) values (
    'a_' || substr(encode(gen_random_bytes(8), 'hex'), 1, 8), k.workspace_id,
    jsonb_build_object(
      'projectId', proj, 'kind', 'heartbeat', 'agent', agent,
      'actor', left(coalesce(p_payload->>'actor', 'Agent'), 80),
      'title', left(coalesce(nullif(p_payload->>'summary', ''), 'Session ended'), 500),
      'url', case when p_payload->>'commit' ~ '^[0-9a-f]{7,40}$' then 'https://github.com/' || repo || '/commit/' || (p_payload->>'commit') end,
      'branch', left(p_payload->>'branch', 100),
      'at', to_jsonb(now())
    ));
  update public.projects set data = jsonb_set(data, '{lastActivityAt}', to_jsonb(now())), updated_at = now() where id = proj;

  -- Keep the latest 5000 heartbeats of this workspace. Rows people wrote themselves are never pruned here.
  select a.at into cutoff
  from public.activity a
  where a.workspace_id = k.workspace_id and a.data->>'kind' = 'heartbeat'
  order by a.at desc
  offset keep_rows - 1 limit 1;
  if cutoff is not null then
    delete from public.activity
    where workspace_id = k.workspace_id and data->>'kind' = 'heartbeat' and at < cutoff;
  end if;

  return 'ok';
end $$;

revoke all on function public.ingest_heartbeat(text, jsonb) from public;
grant execute on function public.ingest_heartbeat(text, jsonb) to anon, authenticated;

-- ── 2 + 4. Accepting an invite ───────────────────────────────────────────────────────────────────────────────────
-- Same as 0014 with two changes:
--   * the GitHub login used to claim a placeholder comes from the GitHub identity GoTrue stores (auth.identities),
--     which only GitHub can change. raw_user_meta_data.user_name is editable by the user through auth.updateUser, so
--     anyone could take over a placeholder (and its apps) by naming themselves after it.
--   * a claimed placeholder never brings admin rights with it: is_admin is reset on claim.
create or replace function public.accept_invite_apps(
  p_token text,
  p_confirmed text[],
  p_note text default null
) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  inv public.invites%rowtype;
  ws public.workspaces%rowtype;
  profile public.profiles%rowtype;
  member public.members%rowtype;
  candidate_id text;
  placeholder_ids text[];
  jwt_email text;
  gh_login text;
  confirmed text[];
  declined_count integer;
  single_use boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to use this invite.'; end if;

  select * into inv from public.invites where token = p_token for update;
  if inv.token is null then raise exception 'This invite link does not exist. Ask for a new one.'; end if;
  single_use := inv.email is not null or cardinality(inv.app_ids) > 0;
  if single_use and inv.used_at is not null then raise exception 'This invite link was already used. Ask for a new one.'; end if;
  if inv.expires_at < now() then raise exception 'This invite link has expired. Ask for a new one.'; end if;

  select * into ws from public.workspaces where id = inv.workspace_id;
  select * into profile from public.profiles where id = auth.uid();
  select * into member from public.members where workspace_id = ws.id and user_id = auth.uid();

  if member.id is not null and not member.active then
    -- Only an invite made after the removal brings them back (an old team link they kept doesn't).
    if inv.created_at >= coalesce(member.removed_at, 'infinity'::timestamptz) then
      update public.members set active = true, leaving_on = null where id = member.id returning * into member;
    else
      raise exception 'You were removed from this workspace. Ask an owner or admin for a new invite.';
    end if;
  end if;

  -- Remember the placeholder currently assigned to these apps before a new joiner can claim that row.
  select coalesce(array_agg(m.id order by requested.ord), '{}'::text[]) into placeholder_ids
  from unnest(inv.app_ids) with ordinality as requested(id, ord)
  join public.projects project on project.id = requested.id and project.workspace_id = ws.id
  join public.members m on m.id = project.data->>'ownerId' and m.workspace_id = ws.id
  where m.user_id is null and m.role = 'member';

  if member.id is null then
    -- The link is the credential. Prefer the named placeholder, then the placeholder already on the apps.
    select m.id into candidate_id
    from public.members m
    where m.workspace_id = ws.id and m.user_id is null and m.role = 'member'
      and inv.email is not null and lower(m.email) = lower(inv.email)
    limit 1;

    candidate_id := coalesce(candidate_id, placeholder_ids[1]);

    if candidate_id is null then
      jwt_email := lower(nullif(auth.jwt()->>'email', ''));
      -- The GitHub identity, not user metadata: see the note above this function.
      select lower(coalesce(nullif(i.identity_data->>'user_name', ''), nullif(i.identity_data->>'preferred_username', '')))
        into gh_login
      from auth.identities i
      where i.user_id = auth.uid() and i.provider = 'github'
      order by i.created_at
      limit 1;

      select m.id into candidate_id
      from public.members m
      where m.workspace_id = ws.id and m.user_id is null and m.role = 'member'
        and (
          (gh_login is not null and lower(m.github_login) = gh_login)
          or (jwt_email is not null and lower(m.email) = jwt_email)
        )
      limit 1;
    end if;

    if candidate_id is not null then
      update public.members
      set user_id = auth.uid(), active = true, is_admin = false,
          avatar_url = coalesce(profile.avatar_url, avatar_url),
          github_login = coalesce(profile.github_login, github_login)
      where id = candidate_id and user_id is null
      returning * into member;
    end if;

    if member.id is null then
      insert into public.members (workspace_id, user_id, name, email, avatar_url, github_login)
      values (
        ws.id,
        auth.uid(),
        coalesce(nullif(profile.name, ''), 'Member'),
        profile.email,
        profile.avatar_url,
        profile.github_login
      )
      returning * into member;
    end if;
  end if;

  select coalesce(array_agg(requested.id order by requested.ord), '{}'::text[])
    into confirmed
  from unnest(inv.app_ids) with ordinality as requested(id, ord)
  where requested.id = any(coalesce(p_confirmed, '{}'::text[]));

  -- A joined member may take the apps from the placeholder named by this invite. Other reassignments stay untouched.
  update public.projects
  set data = jsonb_set(data, '{ownerId}', to_jsonb(member.id), true),
      updated_at = now(),
      updated_by = auth.uid()
  where workspace_id = ws.id
    and id = any(confirmed)
    and (
      data->>'ownerId' is null
      or data->>'ownerId' = member.id
      or data->>'ownerId' = any(placeholder_ids)
    );

  -- A declined app becomes unowned only if it is still on that placeholder or this invitee.
  update public.projects
  set data = jsonb_set(data, '{ownerId}', 'null'::jsonb, true),
      updated_at = now(),
      updated_by = auth.uid()
  where workspace_id = ws.id
    and id = any(inv.app_ids)
    and not (id = any(confirmed))
    and (
      data->>'ownerId' = member.id
      or data->>'ownerId' = any(placeholder_ids)
    );

  declined_count := cardinality(inv.app_ids) - cardinality(confirmed);
  if single_use then
    update public.invites
    set used_at = now(),
        accepted_by = auth.uid(),
        declined_at = case when declined_count > 0 then now() else null end,
        decline_note = case
          when declined_count > 0 then left(nullif(trim(coalesce(p_note, '')), ''), 500)
          else null
        end
    where token = p_token;
  end if;

  return json_build_object(
    'workspace_id', ws.id,
    'name', ws.name,
    'member_id', member.id,
    'confirmed', confirmed
  );
end $$;

revoke all on function public.accept_invite_apps(text, text[], text) from public, anon;
grant execute on function public.accept_invite_apps(text, text[], text) to authenticated;

-- ── 4. Nobody inserts an admin or an owner ───────────────────────────────────────────────────────────────────────
-- 0001's insert policy already required role = 'member' and no user_id, but is_admin (0005) was never limited, so an
-- admin could add a placeholder with is_admin = true and have anyone claim it. Trusted RPCs (create_workspace,
-- accept_invite_apps) run as the table owner and aren't bound by this.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'members' and policyname = 'new people start as plain members') then
    create policy "new people start as plain members" on public.members as restrictive for insert
      with check (not is_admin and role = 'member' and user_id is null);
  end if;
end $$;

-- Placeholders flagged admin before this could only come from that hole (the app offers the admin switch for people
-- who have joined only), and a claim would have handed the flag on. Clear them.
update public.members set is_admin = false where user_id is null and is_admin;

-- Owner makes or unmakes an admin, as in 0005, but only for someone who has joined (a placeholder has nobody to trust).
create or replace function public.set_member_admin(p_member text, p_admin boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare m members;
begin
  select * into m from members where id = p_member;
  if m.id is null or not is_owner(m.workspace_id) then raise exception 'Only the owner can change roles.'; end if;
  if m.role = 'owner' then raise exception 'The owner already has every permission.'; end if;
  if p_admin and m.user_id is null then raise exception 'Only people who have joined can be admins.'; end if;
  update members set is_admin = p_admin where id = p_member;
end $$;
revoke all on function public.set_member_admin(text, boolean) from public, anon;
grant execute on function public.set_member_admin(text, boolean) to authenticated;

-- ── 6a. The public invite preview says less about dead links ─────────────────────────────────────────────────────
-- Same as 0015, except that a missing, used or expired link returns its status and nothing else (no inviter,
-- workspace or app names). 'removed' keeps the workspace name: only a signed-in former member of it gets that status.
create or replace function public.invite_preview(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  inv public.invites%rowtype;
  state text;
  inviter text;
  workspace_name text;
  app_list json;
begin
  select * into inv from public.invites where token = p_token;
  if inv.token is null then
    return json_build_object('status', 'missing', 'inviter_name', null, 'workspace_name', null, 'apps', '[]'::json);
  end if;

  -- A plain team link (no email, no apps) is reusable until it expires; personal links are single-use.
  state := case
    when inv.used_at is not null and (inv.email is not null or cardinality(inv.app_ids) > 0) then 'used'
    when inv.expires_at < now() then 'expired'
    else 'ok'
  end;
  if state <> 'ok' then
    return json_build_object('status', state, 'inviter_name', null, 'workspace_name', null, 'apps', '[]'::json);
  end if;

  -- A signed-in person removed from this workspace learns it here, before pressing Confirm. A link made after the
  -- removal still brings them back (accept_invite, 0011), so it stays 'ok'.
  if exists (
    select 1 from public.members m
    where m.workspace_id = inv.workspace_id and m.user_id = (select auth.uid())
      and not m.active and inv.created_at < coalesce(m.removed_at, 'infinity'::timestamptz)
  ) then
    return json_build_object(
      'status', 'removed', 'inviter_name', null,
      'workspace_name', (select w.name from public.workspaces w where w.id = inv.workspace_id),
      'apps', '[]'::json
    );
  end if;

  select coalesce(nullif(m.name, ''), nullif(pr.name, ''), 'A teammate'), w.name
    into inviter, workspace_name
  from public.workspaces w
  left join public.members m
    on m.workspace_id = w.id and m.user_id = inv.created_by
  left join public.profiles pr on pr.id = inv.created_by
  where w.id = inv.workspace_id
  limit 1;

  select coalesce(
    json_agg(
      json_build_object(
        'id', p.id,
        'name', coalesce(nullif(p.data->>'name', ''), 'Untitled app'),
        'repo', nullif(p.data->'repo'->>'fullName', '')
      ) order by requested.ord
    ),
    '[]'::json
  ) into app_list
  from unnest(inv.app_ids) with ordinality as requested(id, ord)
  join public.projects p on p.id = requested.id and p.workspace_id = inv.workspace_id;

  return json_build_object('status', 'ok', 'inviter_name', inviter, 'workspace_name', workspace_name, 'apps', app_list);
end $$;

-- Signed-out people open invite links (#/join), so anon keeps this one.
revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

-- ── 6b. Only a key's maker, the owner or an admin revokes an agent key ───────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ingest_keys' and policyname = 'maker or manager revokes keys') then
    create policy "maker or manager revokes keys" on public.ingest_keys as restrictive for update
      using (created_by = (select auth.uid()) or public.is_manager(workspace_id))
      with check (created_by = (select auth.uid()) or public.is_manager(workspace_id));
  end if;
end $$;

-- ── 6c. The database stamps who made or changed a row ────────────────────────────────────────────────────────────
-- invites.created_by defaulted to auth.uid() but a client could send someone else's id, which the invite preview then
-- shows as the inviter. It is now always the signed-in caller, and never changes afterwards. (workspaces.created_by
-- and ingest_keys.created_by need nothing: clients have no insert policy on those tables, only the RPCs write them.)
create or replace function public.stamp_invite_creator() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    new.created_by := old.created_by;
  end if;
  return new;
end $$;
revoke all on function public.stamp_invite_creator() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'invites_stamp_creator' and tgrelid = 'public.invites'::regclass) then
    create trigger invites_stamp_creator before insert or update on public.invites
      for each row execute function public.stamp_invite_creator();
  end if;
end $$;

-- projects.updated_by / tasks.updated_by: same idea. Calls without a user (the anon heartbeat) keep the last value.
create or replace function public.stamp_updated_by() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  elsif tg_op = 'UPDATE' then
    new.updated_by := old.updated_by;
  end if;
  return new;
end $$;
revoke all on function public.stamp_updated_by() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'projects_stamp_updated_by' and tgrelid = 'public.projects'::regclass) then
    create trigger projects_stamp_updated_by before insert or update on public.projects
      for each row execute function public.stamp_updated_by();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tasks_stamp_updated_by' and tgrelid = 'public.tasks'::regclass) then
    create trigger tasks_stamp_updated_by before insert or update on public.tasks
      for each row execute function public.stamp_updated_by();
  end if;
end $$;

-- ── 6d. Membership helpers are for signed-in people ──────────────────────────────────────────────────────────────
-- The access rules call these as the requesting role, so authenticated keeps them. Signed-out visitors never read
-- tables (the join page uses invite_preview, the hook script ingest_heartbeat), so anon loses them; a signed-out
-- table read now fails with "permission denied" instead of returning nothing.
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.is_owner(uuid) from public, anon;
revoke execute on function public.is_manager(uuid) from public, anon;
revoke execute on function public.is_org(uuid) from public, anon;
revoke execute on function public.my_member_id(uuid) from public, anon;
revoke execute on function public.owns_app(uuid, text) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.is_owner(uuid) to authenticated;
grant execute on function public.is_manager(uuid) to authenticated;
grant execute on function public.is_org(uuid) to authenticated;
grant execute on function public.my_member_id(uuid) to authenticated;
grant execute on function public.owns_app(uuid, text) to authenticated;
