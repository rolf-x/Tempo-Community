-- Row IS [NOT] NULL is true only when EVERY field is (not) null, so a member row with empty fields slipped past the
-- 'removed' check. Test on the id instead. (Caught by supabase/tests/rls.sql.)
-- Join through an invite link. Returns the workspace id and name.
create or replace function public.accept_invite(p_token text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare inv invites; ws workspaces; p profiles; existing members; jwt_email text; gh_login text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into inv from invites where token = p_token;
  if inv.token is null or inv.expires_at < now() or (inv.email is not null and inv.used_at is not null) then
    raise exception 'This invite link is invalid or has expired.';
  end if;
  if inv.email is not null and lower(inv.email) <> lower(coalesce(auth.jwt()->>'email', '')) then
    raise exception 'This invite was sent to a different email address.';
  end if;
  select * into ws from workspaces where id = inv.workspace_id;
  select * into p from profiles where id = auth.uid();
  select * into existing from members where workspace_id = ws.id and user_id = auth.uid();
  if existing.id is not null and not existing.active then
    raise exception 'You were removed from this workspace. Ask an owner to add you back.';
  end if;
  if existing.id is null then
    -- Claim a placeholder with the same GitHub login or email (their apps and tasks carry over). Identity comes from
    -- the verified sign-in (JWT email, GitHub identity), never from the user-editable profile, and never an owner row.
    jwt_email := lower(nullif(auth.jwt()->>'email', ''));
    select lower(u.raw_user_meta_data->>'user_name') into gh_login from auth.users u
      where u.id = auth.uid() and u.raw_app_meta_data->>'provider' = 'github';
    update members set user_id = auth.uid(), active = true, avatar_url = coalesce(p.avatar_url, avatar_url)
      where id = (select id from members where workspace_id = ws.id and user_id is null and role = 'member'
                  and ((gh_login is not null and lower(github_login) = gh_login)
                    or (jwt_email is not null and lower(email) = jwt_email)) limit 1);
    if not found then
      insert into members (workspace_id, user_id, name, email, avatar_url, github_login)
      values (ws.id, auth.uid(), coalesce(nullif(p.name, ''), 'Member'), p.email, p.avatar_url, p.github_login);
    end if;
  end if;
  if inv.email is not null then update invites set used_at = now() where token = p_token; end if;
  return json_build_object('workspace_id', ws.id, 'name', ws.name);
end $$;
