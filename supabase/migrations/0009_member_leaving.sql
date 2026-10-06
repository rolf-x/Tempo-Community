alter table public.members add column if not exists leaving_on date;

grant update (leaving_on) on public.members to authenticated;
