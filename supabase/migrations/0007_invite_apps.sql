-- 0007: app-scoped invites, invite previews and admin invite history.
-- Additive: the original accept_invite(text) and invite_status(text) signatures remain available.

alter table public.invites add column if not exists created_at timestamptz not null default now();
alter table public.invites add column if not exists app_ids text[] not null default '{}';
alter table public.invites add column if not exists declined_at timestamptz;
alter table public.invites add column if not exists decline_note text;
-- Needed to name the person who joined even when they use a different GitHub account or decline every app.
alter table public.invites add column if not exists accepted_by uuid references auth.users on delete set null;

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
    return json_build_object(
      'status', 'missing', 'inviter_name', null, 'workspace_name', null, 'apps', '[]'::json
    );
  end if;

  -- A plain team link (no email, no apps) is reusable until it expires, as in 0002; personal links are single-use.
  state := case
    when inv.used_at is not null and (inv.email is not null or cardinality(inv.app_ids) > 0) then 'used'
    when inv.expires_at < now() then 'expired'
    else 'ok'
  end;

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

  return json_build_object(
    'status', state,
    'inviter_name', inviter,
    'workspace_name', workspace_name,
    'apps', app_list
  );
end $$;

revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;

create or replace function public.list_invites(p_workspace uuid) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare result json;
begin
  if auth.uid() is null or not public.is_manager(p_workspace) then
    raise exception 'Only the owner or an admin can list invites.';
  end if;

  select coalesce(json_agg(row_data order by created_at desc), '[]'::json)
    into result
  from (
    select
      i.created_at,
      json_build_object(
        'id', i.token,
        'token', i.token,
        'email', i.email,
        'created_at', i.created_at,
        'expires_at', i.expires_at,
        'used_at', i.used_at,
        'declined_at', i.declined_at,
        'decline_note', i.decline_note,
        'app_ids', i.app_ids,
        'apps', coalesce(apps.value, '[]'::json),
        'inviter_name', coalesce(nullif(inviter.name, ''), nullif(inviter_profile.name, ''), 'A teammate'),
        'invitee_name', coalesce(nullif(joined.name, ''), nullif(target.name, ''), nullif(split_part(i.email, '@', 1), '')),
        'joined_member_name', nullif(joined.name, '')
      ) as row_data
    from public.invites i
    left join public.members inviter
      on inviter.workspace_id = i.workspace_id and inviter.user_id = i.created_by
    left join public.profiles inviter_profile on inviter_profile.id = i.created_by
    left join public.members joined
      on joined.workspace_id = i.workspace_id and joined.user_id = i.accepted_by
    left join lateral (
      select m.name
      from public.members m
      where m.workspace_id = i.workspace_id
        and m.user_id is null
        and (
          (i.email is not null and lower(m.email) = lower(i.email))
          or m.id = any (
            select p.data->>'ownerId'
            from public.projects p
            where p.workspace_id = i.workspace_id and p.id = any(i.app_ids)
          )
        )
      order by case when i.email is not null and lower(m.email) = lower(i.email) then 0 else 1 end
      limit 1
    ) target on true
    left join lateral (
      select coalesce(
        json_agg(
          json_build_object(
            'id', p.id,
            'name', coalesce(nullif(p.data->>'name', ''), 'Untitled app')
          ) order by requested.ord
        ),
        '[]'::json
      ) as value
      from unnest(i.app_ids) with ordinality as requested(id, ord)
      join public.projects p on p.id = requested.id and p.workspace_id = i.workspace_id
    ) apps on true
    where i.workspace_id = p_workspace
  ) listed;

  return result;
end $$;

revoke all on function public.list_invites(uuid) from public, anon;
grant execute on function public.list_invites(uuid) to authenticated;

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
    raise exception 'You were removed from this workspace. Ask an owner or admin to add you back.';
  end if;

  if member.id is null then
    -- The link is the credential. Prefer the placeholder the admin assigned, even when the recipient signs in
    -- with another GitHub account. That preserves the app assignment and tells the admin who actually joined.
    select m.id into candidate_id
    from public.members m
    where m.workspace_id = ws.id and m.user_id is null and m.role = 'member'
      and inv.email is not null and lower(m.email) = lower(inv.email)
    limit 1;

    if candidate_id is null then
      select m.id into candidate_id
      from unnest(inv.app_ids) with ordinality as requested(id, ord)
      join public.projects project on project.id = requested.id and project.workspace_id = ws.id
      join public.members m on m.id = project.data->>'ownerId' and m.workspace_id = ws.id
      where m.user_id is null and m.role = 'member'
      order by requested.ord
      limit 1;
    end if;

    if candidate_id is null then
      jwt_email := lower(nullif(auth.jwt()->>'email', ''));
      select lower(u.raw_user_meta_data->>'user_name') into gh_login
      from auth.users u
      where u.id = auth.uid() and u.raw_app_meta_data->>'provider' = 'github';

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
      set user_id = auth.uid(), active = true,
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

  -- Do not overwrite an app that an admin reassigned after making this link.
  update public.projects
  set data = jsonb_set(data, '{ownerId}', to_jsonb(member.id), true),
      updated_at = now(),
      updated_by = auth.uid()
  where workspace_id = ws.id
    and id = any(confirmed)
    and (data->>'ownerId' is null or data->>'ownerId' = member.id);

  -- An unchecked app returns to the unowned list, but only while this invitee still owns the placeholder.
  update public.projects
  set data = jsonb_set(data, '{ownerId}', 'null'::jsonb, true),
      updated_at = now(),
      updated_by = auth.uid()
  where workspace_id = ws.id
    and id = any(inv.app_ids)
    and not (id = any(confirmed))
    and data->>'ownerId' = member.id;

  declined_count := cardinality(inv.app_ids) - cardinality(confirmed);
  -- A reusable team link stays open for the next person; only personal links are marked used.
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

-- Legacy callers accept every app carried by the invite.
create or replace function public.accept_invite(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
begin
  return public.accept_invite_apps(
    p_token,
    coalesce((select app_ids from public.invites where token = p_token), '{}'::text[]),
    null
  );
end $$;

revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- Same return type and rule as 0006 (a plain team link stays reusable), extended to app invites, which are personal.
create or replace function public.invite_status(p_token text) returns text
language plpgsql stable security definer set search_path = public as $$
declare inv public.invites%rowtype;
begin
  select * into inv from public.invites where token = p_token;
  if inv.token is null then return 'missing'; end if;
  if inv.used_at is not null and (inv.email is not null or cardinality(inv.app_ids) > 0) then return 'used'; end if;
  if inv.expires_at < now() then return 'expired'; end if;
  return 'ok';
end $$;

revoke all on function public.invite_status(text) from public;
grant execute on function public.invite_status(text) to anon, authenticated;

-- Direct invite updates are management actions. Acceptance goes through the security-definer RPC above.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invites' and policyname = 'managers read invites') then
    create policy "managers read invites" on public.invites as restrictive for select
      using (public.is_manager(workspace_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invites' and policyname = 'managers update invites') then
    create policy "managers update invites" on public.invites as restrictive for update
      using (public.is_manager(workspace_id)) with check (public.is_manager(workspace_id));
  end if;
end $$;
