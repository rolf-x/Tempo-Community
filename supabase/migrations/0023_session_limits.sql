-- 0023 · Sign-ins end. A sign-in lasts at most 30 days, and
-- ends sooner after 14 days without use; then the person signs in with GitHub again. This covers every session:
-- browsers and connected AI apps alike.
--
-- Supabase Auth refuses to refresh a session once its `not_after` has passed. It checks that before anything else, on
-- every plan (supabase/auth internal/models/sessions.go, Session.CheckValidity → "Invalid Refresh Token: Session
-- Expired"). Supabase's own time-box and inactivity settings need the Pro plan, so Tempo sets `not_after` itself: on
-- sign-in, and again on every refresh (a refresh writes `refreshed_at`), to the earlier of 30 days after sign-in and
-- 14 days from now. An access token already issued still runs out within its hour, as with Supabase's own setting,
-- and the agent guard (0017) already refuses an AI app's calls once `not_after` has passed.
-- Written to re-run safely.

create or replace function public.session_limits() returns trigger
language plpgsql set search_path = '' as $$
declare
  ends timestamptz := least(coalesce(new.created_at, now()) + interval '30 days', now() + interval '14 days');
begin
  -- A new session keeps an earlier end if Auth gave it one. A refresh moves the end, but never past 30 days: a refresh
  -- only happens before `not_after`, so a session that has already ended is never brought back.
  new.not_after := case when tg_op = 'INSERT' then least(ends, coalesce(new.not_after, 'infinity')) else ends end;
  return new;
end $$;

revoke all on function public.session_limits() from public, anon, authenticated;
grant execute on function public.session_limits() to supabase_auth_admin; -- the role Auth writes sessions as

drop trigger if exists session_limits on auth.sessions;
create trigger session_limits before insert or update of refreshed_at on auth.sessions
  for each row execute function public.session_limits();

-- Sessions that exist today get the same end, counted from their sign-in and their last refresh (`refreshed_at` is
-- stored as UTC without a time zone). One that is already past either limit ends at its next refresh. This update
-- doesn't touch `refreshed_at`, so the trigger stays out of it.
update auth.sessions
   set not_after = least(
         created_at + interval '30 days',
         greatest(created_at, coalesce(refreshed_at at time zone 'UTC', created_at)) + interval '14 days')
 where not_after is null;
