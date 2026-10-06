-- Public invite preflight: reveal only status, never workspace or recipient details.
create or replace function public.invite_status(p_token text) returns text
language plpgsql stable security definer set search_path = public as $$
declare inv public.invites;
begin
  select * into inv from public.invites where token = p_token;
  if inv.token is null then return 'missing'; end if;
  if inv.expires_at < now() then return 'expired'; end if;
  -- Email-bound invites are single-use; unrestricted links remain reusable until expiry.
  if inv.email is not null and inv.used_at is not null then return 'used'; end if;
  return 'ok';
end $$;

revoke all on function public.invite_status(text) from public;
grant execute on function public.invite_status(text) to anon, authenticated;
