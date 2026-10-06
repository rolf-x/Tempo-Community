-- 0005: admins and edit rights.
--   owner  : everything, and the only one who makes or unmakes admins.
--   admin  : invites and removes people, edits every app and task.
--   member : sees every app; edits the apps they own and the tasks assigned to them (or in apps they own).
-- Additive only: admin is a flag next to role, so the existing role check stays untouched.

alter table public.members add column is_admin boolean not null default false;
-- Not in the column grant for updates (name, email, avatar_url, github_login, active), so nobody can self-promote.

create or replace function public.is_manager(ws uuid) returns boolean
language sql security definer stable set search_path = public, extensions as $$
  select exists (select 1 from members where workspace_id = ws and user_id = auth.uid() and active and (role = 'owner' or is_admin))
$$;

create or replace function public.my_member_id(ws uuid) returns text
language sql security definer stable set search_path = public, extensions as $$
  select id from members where workspace_id = ws and user_id = auth.uid() and active limit 1
$$;

create or replace function public.owns_app(ws uuid, app_id text) returns boolean
language sql security definer stable set search_path = public, extensions as $$
  select exists (select 1 from projects where workspace_id = ws and id = app_id and data->>'ownerId' = my_member_id(ws))
$$;

-- Owner makes or unmakes an admin.
create or replace function public.set_member_admin(p_member text, p_admin boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare m members;
begin
  select * into m from members where id = p_member;
  if m.id is null or not is_owner(m.workspace_id) then raise exception 'Only the owner can change roles.'; end if;
  if m.role = 'owner' then raise exception 'The owner already has every permission.'; end if;
  update members set is_admin = p_admin where id = p_member;
end $$;
revoke all on function public.set_member_admin(text, boolean) from public, anon;
grant execute on function public.set_member_admin(text, boolean) to authenticated;

-- Removing or restoring people: owner or admin; nobody removes the owner.
create or replace function public.guard_member_active() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.active is distinct from old.active and current_user = 'authenticated' then
    if not is_manager(old.workspace_id) then raise exception 'Only the owner or an admin can remove or restore people.'; end if;
    if old.role = 'owner' then raise exception 'Owners cannot be removed.'; end if;
  end if;
  return new;
end $$;

-- Restrictive policies narrow the existing permissive "members …" ones.
-- People: only managers add placeholders or edit other people; everyone may edit their own row.
create policy "managers add people" on public.members as restrictive for insert with check (is_manager(workspace_id));
create policy "managers or self edit people" on public.members as restrictive for update
  using (is_manager(workspace_id) or user_id = auth.uid()) with check (is_manager(workspace_id) or user_id = auth.uid());

-- Invites: managers only.
create policy "managers invite" on public.invites as restrictive for insert with check (is_manager(workspace_id));
create policy "managers revoke invites" on public.invites as restrictive for delete using (is_manager(workspace_id));

-- Apps: any member may create one (they become its owner); changing or deleting needs a manager or the app's owner.
create policy "owner or manager edits app" on public.projects as restrictive for update
  using (is_manager(workspace_id) or data->>'ownerId' = my_member_id(workspace_id))
  with check (is_manager(workspace_id) or data->>'ownerId' = my_member_id(workspace_id));
create policy "owner or manager deletes app" on public.projects as restrictive for delete
  using (is_manager(workspace_id) or data->>'ownerId' = my_member_id(workspace_id));

-- Tasks: a manager, the app's owner, or the assignee.
create policy "who may add tasks" on public.tasks as restrictive for insert
  with check (is_manager(workspace_id) or owns_app(workspace_id, data->>'projectId'));
create policy "who may edit tasks" on public.tasks as restrictive for update
  using (is_manager(workspace_id) or owns_app(workspace_id, data->>'projectId') or data->>'assigneeId' = my_member_id(workspace_id))
  with check (is_manager(workspace_id) or owns_app(workspace_id, data->>'projectId') or data->>'assigneeId' = my_member_id(workspace_id));
create policy "who may delete tasks" on public.tasks as restrictive for delete
  using (is_manager(workspace_id) or owns_app(workspace_id, data->>'projectId'));
