-- 0004: workspace kind, chosen at first sign-in: an organization (team portfolio) or a personal workspace.
-- Existing workspaces become 'org'.
alter table public.workspaces
  add column kind text not null default 'org' check (kind in ('org', 'personal'));
-- One personal workspace per user.
create unique index workspaces_one_personal on public.workspaces (created_by) where kind = 'personal';

-- Owners may rename; the kind changes only through upgrade_to_org.
revoke update on public.workspaces from authenticated, anon;
grant update (name) on public.workspaces to authenticated;

create or replace function public.is_org(ws uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from workspaces where id = ws and kind = 'org')
$$;

-- New workspaces choose a kind. A separate function (not an overload of create_workspace) keeps PostgREST's
-- named-argument calls unambiguous and leaves the deployed client's create_workspace untouched (it makes 'org').
create or replace function public.create_workspace_of_kind(p_name text, p_kind text, p_member_id text default null)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare ws uuid; p profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_kind not in ('org', 'personal') then raise exception 'kind must be org or personal'; end if;
  select * into p from profiles where id = auth.uid();
  insert into workspaces (name, kind, created_by)
  values (left(coalesce(nullif(trim(p_name), ''), case p_kind when 'org' then 'My team' else 'My apps' end), 80), p_kind, auth.uid())
  returning id into ws;
  insert into members (id, workspace_id, user_id, name, email, avatar_url, github_login, role)
  values (coalesce(p_member_id, 'm_' || substr(encode(gen_random_bytes(8), 'hex'), 1, 8)), ws, auth.uid(),
          coalesce(nullif(p.name, ''), 'Owner'), p.email, p.avatar_url, p.github_login, 'owner');
  return ws;
end $$;
revoke all on function public.create_workspace_of_kind(text, text, text) from public, anon;
grant execute on function public.create_workspace_of_kind(text, text, text) to authenticated;

-- Personal → organization (one way).
create or replace function public.upgrade_to_org(p_workspace uuid, p_name text default null) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_owner(p_workspace) then raise exception 'Only the owner can change this workspace.'; end if;
  update workspaces set kind = 'org', name = coalesce(left(nullif(trim(p_name), ''), 80), name)
    where id = p_workspace and kind = 'personal';
  if not found then raise exception 'This workspace is already an organization.'; end if;
end $$;
revoke all on function public.upgrade_to_org(uuid, text) from public, anon;
grant execute on function public.upgrade_to_org(uuid, text) to authenticated;

-- Invites only for organizations: a restrictive policy narrows the existing "members manage" one for inserts.
-- A workspace can't go back from org to personal, so an invite never points at a personal workspace and
-- accept_invite needs no change.
create policy "invites only in orgs" on public.invites as restrictive for insert with check (is_org(workspace_id));
