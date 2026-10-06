-- 0012: app-invite answers transfer the invited placeholder's apps to an existing member too.
-- The signature stays unchanged so browsers also keep working against 0007 until this migration lands.

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
    raise exception 'You were removed from this workspace. Ask an owner or admin to add you back.';
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
