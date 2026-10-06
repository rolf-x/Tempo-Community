-- Explain inactive memberships and let a valid workspace invite reactivate the same member row.

create or replace function public.my_removed_workspaces()
returns table(workspace_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select m.workspace_id, w.name
  from public.members m
  join public.workspaces w on w.id = m.workspace_id
  where m.user_id = auth.uid()
    and not m.active
    and not exists (
      select 1
      from public.members active_member
      where active_member.workspace_id = m.workspace_id
        and active_member.user_id = auth.uid()
        and active_member.active
    )
  order by m.created_at desc
$$;

revoke all on function public.my_removed_workspaces() from public, anon;
grant execute on function public.my_removed_workspaces() to authenticated;

-- Remember when a member was removed: only an invite made after that can bring them back, so an old reusable team
-- link they still have doesn't undo the removal.
alter table public.members add column if not exists removed_at timestamptz;

create or replace function public.stamp_member_removed() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if old.active and not new.active then new.removed_at := now();
  elsif new.active then new.removed_at := null;
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'members_stamp_removed' and tgrelid = 'public.members'::regclass) then
    create trigger members_stamp_removed before update of active on public.members
      for each row execute function public.stamp_member_removed();
  end if;
end $$;

-- People removed before this migration count as removed now: links made before today can't bring them back.
update public.members set removed_at = now() where not active and removed_at is null;

-- Keep 0007's legacy accept_invite behaviour. The only change is that a valid invite made after the removal restores an
-- inactive member before accept_invite_apps performs the existing join and invite bookkeeping.
create or replace function public.accept_invite(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare
  inv public.invites%rowtype;
  single_use boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to use this invite.'; end if;

  select * into inv from public.invites where token = p_token for update;
  if inv.token is null then raise exception 'This invite link does not exist. Ask for a new one.'; end if;
  single_use := inv.email is not null or cardinality(inv.app_ids) > 0;
  if single_use and inv.used_at is not null then raise exception 'This invite link was already used. Ask for a new one.'; end if;
  if inv.expires_at < now() then raise exception 'This invite link has expired. Ask for a new one.'; end if;

  update public.members
  set active = true, leaving_on = null
  where workspace_id = inv.workspace_id
    and user_id = auth.uid()
    and not active
    and inv.created_at >= coalesce(removed_at, 'infinity'::timestamptz);

  return public.accept_invite_apps(p_token, coalesce(inv.app_ids, '{}'::text[]), null);
end $$;

revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
