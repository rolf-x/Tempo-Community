-- 0013: share an org workspace's GitHub repo scope across members and devices.
alter table public.workspaces add column if not exists github_org text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workspaces_github_org_length'
      and conrelid = 'public.workspaces'::regclass
  ) then
    alter table public.workspaces add constraint workspaces_github_org_length
      check (github_org is null or char_length(github_org) between 1 and 100);
  end if;
end $$;

create or replace function public.set_workspace_github_org(ws uuid, org text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare clean_org text := nullif(trim(org), '');
begin
  if not public.is_manager(ws) then
    raise exception 'Only the workspace owner or an admin can change the GitHub organisation.';
  end if;
  if org is not null and (clean_org is null or char_length(clean_org) > 100) then
    raise exception 'The GitHub organisation must be between 1 and 100 characters.';
  end if;
  update public.workspaces set github_org = clean_org where id = ws;
end $$;
revoke all on function public.set_workspace_github_org(uuid, text) from public, anon;
grant execute on function public.set_workspace_github_org(uuid, text) to authenticated;
