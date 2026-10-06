-- RLS proof. Run by hand on a database with EVERY migration applied (0001 to 0023, e.g. your project after
-- `supabase db push`): Supabase → SQL Editor → paste → Run, as the default postgres role (it writes auth.users and
-- auth.identities). Everything runs in one transaction that is rolled back at the end: the users, workspaces and rows
-- below are fake and never persist. Success = "RLS: all checks passed"; a failure stops with "FAIL: …".
begin;

-- Four fake users (rolled back). The trigger creates their profiles. Carol and Mallory signed in with GitHub, so GoTrue
-- also stored their GitHub identities (auth.identities), which only GitHub can change.
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role)
values ('00000000-0000-0000-0000-00000000000a', 'alice@test.local', '{"full_name":"Alice"}', '{"provider":"google"}', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000000b', 'bob@test.local', '{"full_name":"Bob","user_name":"bobgh"}', '{"provider":"github"}', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000000c', 'carol@test.local', '{"full_name":"Carol","user_name":"carolgh"}', '{"provider":"github"}', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000000d', 'mallory@test.local', '{"full_name":"Mallory","user_name":"mallorygh"}', '{"provider":"github"}', 'authenticated', 'authenticated');
insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at)
values (gen_random_uuid(), '9000001', '00000000-0000-0000-0000-00000000000c', '{"sub":"9000001","user_name":"carolgh","email":"carol@test.local"}', 'github', now()),
       (gen_random_uuid(), '9000002', '00000000-0000-0000-0000-00000000000d', '{"sub":"9000002","user_name":"mallorygh","email":"mallory@test.local"}', 'github', now());

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, anon;

-- Alice creates a workspace, an app, a task and an invite.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
insert into t_ctx values ('ws', public.create_workspace('Acme test', null)::text);
insert into public.projects (id, workspace_id, data) select 'p_t1', v::uuid, '{"name":"Bot","repo":{"fullName":"acme/bot"}}' from t_ctx where k = 'ws';
insert into public.tasks (id, workspace_id, data) select 't_t1', v::uuid, '{"title":"Ship"}' from t_ctx where k = 'ws';
insert into public.invites (workspace_id) select v::uuid from t_ctx where k = 'ws';
insert into t_ctx select 'token', token from public.invites limit 1 on conflict (k) do update set v = excluded.v;

-- Carol runs a second, unrelated workspace with its own app and invite.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","email":"carol@test.local","role":"authenticated"}';
insert into t_ctx values ('other_ws', public.create_workspace('Other Co', null)::text);
insert into public.projects (id, workspace_id, data) select 'p_other', v::uuid, '{"name":"Other app","repo":{"fullName":"other/app"}}' from t_ctx where k = 'other_ws';
insert into public.invites (workspace_id) select v::uuid from t_ctx where k = 'other_ws';

-- Cross-tenant (0016 audit): Alice owns Acme but is nobody in Other Co. She reads none of it and every write misses.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
do $$
declare other uuid := (select v::uuid from t_ctx where k = 'other_ws'); n int;
begin
  if exists (select 1 from public.workspaces where id = other) then raise exception 'FAIL: cross-tenant workspace read'; end if;
  if exists (select 1 from public.projects where workspace_id = other) then raise exception 'FAIL: cross-tenant app read'; end if;
  if exists (select 1 from public.members where workspace_id = other) then raise exception 'FAIL: cross-tenant member read'; end if;
  if exists (select 1 from public.invites where workspace_id = other) then raise exception 'FAIL: cross-tenant invite read'; end if;
  begin
    insert into public.projects (id, workspace_id, data) values ('p_planted', other, '{"name":"planted"}');
    raise exception 'FAIL: cross-tenant app insert';
  exception when insufficient_privilege or check_violation then null;
  end;
  update public.projects set data = data || '{"name":"hijacked"}' where id = 'p_other';
  delete from public.projects where id = 'p_other';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: cross-tenant app delete'; end if;
  begin
    insert into public.members (workspace_id, name) values (other, 'Planted');
    raise exception 'FAIL: cross-tenant member insert';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into public.invites (workspace_id) values (other);
    raise exception 'FAIL: cross-tenant invite insert';
  exception when insufficient_privilege or check_violation then null;
  end;
  delete from public.invites where workspace_id = other;
  begin
    perform public.list_invites(other);
    raise exception 'FAIL: cross-tenant list_invites';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.set_workspace_github_org(other, 'pwned');
    raise exception 'FAIL: cross-tenant set_workspace_github_org';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","email":"carol@test.local","role":"authenticated"}';
do $$ begin
  if (select data->>'name' from public.projects where id = 'p_other') is distinct from 'Other app' then
    raise exception 'FAIL: a cross-tenant update or delete reached Other Co';
  end if;
  if (select count(*) from public.members) <> 1 then raise exception 'FAIL: a cross-tenant member landed in Other Co'; end if;
  if (select count(*) from public.invites) <> 1 then raise exception 'FAIL: a cross-tenant invite insert or delete reached Other Co'; end if;
  if (select github_org from public.workspaces) is not null then raise exception 'FAIL: a cross-tenant GitHub organisation change went through'; end if;
end $$;

-- Bob (not a member) sees nothing and can write nothing.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.projects) <> 0 then raise exception 'FAIL: non-member can read projects'; end if;
  if (select count(*) from public.tasks) <> 0 then raise exception 'FAIL: non-member can read tasks'; end if;
  if (select count(*) from public.workspaces) <> 0 then raise exception 'FAIL: non-member can read workspaces'; end if;
  if (select count(*) from public.invites) <> 0 then raise exception 'FAIL: non-member can read invites'; end if;
  begin
    insert into public.tasks (id, workspace_id, data) select 't_bad', v::uuid, '{}' from t_ctx where k = 'ws';
    raise exception 'FAIL: non-member inserted a task';
  exception when insufficient_privilege or check_violation then null; -- RLS rejects: expected
  end;
  update public.tasks set data = '{"title":"hacked"}' where id = 't_t1';
  begin
    insert into public.members (workspace_id, user_id, name) select v::uuid, auth.uid(), 'Bob' from t_ctx where k = 'ws';
    raise exception 'FAIL: non-member added themselves';
  exception when insufficient_privilege or check_violation then null;
  end;
end $$;

-- A wrong token fails; the real one lets Bob in.
do $$ begin
  begin
    perform public.accept_invite('not-a-token');
    raise exception 'FAIL: bad invite token accepted';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
select public.accept_invite((select v from t_ctx where k = 'token'));
do $$ begin
  if (select count(*) from public.projects) <> 1 then raise exception 'FAIL: invited member cannot read projects'; end if;
  if (select data->>'title' from public.tasks where id = 't_t1') <> 'Ship' then raise exception 'FAIL: non-member update went through'; end if;
  -- A plain member can't remove the owner (or anyone).
  -- (Since 0005 the row is filtered out by RLS rather than raising; either way it must stay active.)
  begin
    update public.members set active = false where role = 'owner';
  exception when raise_exception then null;
  end;
  if not (select active from public.members where role = 'owner') then raise exception 'FAIL: member deactivated the owner'; end if;
  -- A member can't promote themselves.
  begin
    update public.members set role = 'owner' where user_id = auth.uid();
    raise exception 'FAIL: member changed their own role';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Alice (owner) removes Bob. The removal is visible through the narrow RPC; an invalid invite does nothing and a fresh one restores him.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
update public.members set active = false, leaving_on = current_date + 7 where user_id = '00000000-0000-0000-0000-00000000000b';
with fresh as (
  insert into public.invites (workspace_id) select v::uuid from t_ctx where k = 'ws' returning token
)
insert into t_ctx select 'fresh_token', token from fresh on conflict (k) do update set v = excluded.v;
-- A reusable team link made before the removal (Bob may still have it).
with old_link as (
  insert into public.invites (workspace_id, created_at) select v::uuid, now() - interval '1 day' from t_ctx where k = 'ws' returning token
)
insert into t_ctx select 'old_token', token from old_link on conflict (k) do update set v = excluded.v;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated"}';
do $$ begin
  if (select count(*) from public.my_removed_workspaces()) <> 1 then raise exception 'FAIL: removed workspace was not reported'; end if;
  if (select name from public.my_removed_workspaces()) <> 'Acme test' then raise exception 'FAIL: removed workspace name was not reported'; end if;
  if (select count(*) from public.projects) <> 0 then raise exception 'FAIL: removed member still reads projects'; end if;
  begin
    perform public.accept_invite('not-a-token');
    raise exception 'FAIL: invalid invite restored removed member';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  if (select count(*) from public.my_removed_workspaces()) <> 1 then raise exception 'FAIL: invalid invite reactivated member'; end if;
end $$;
do $$ begin
  if public.invite_preview((select v from t_ctx where k = 'old_token'))->>'status' <> 'removed' then raise exception 'FAIL: old link preview did not say removed'; end if;
  if public.invite_preview((select v from t_ctx where k = 'fresh_token'))->>'status' <> 'ok' then raise exception 'FAIL: fresh link preview is not ok'; end if;
  begin
    perform public.accept_invite((select v from t_ctx where k = 'old_token'));
  exception when raise_exception then null;
  end;
  if (select count(*) from public.my_removed_workspaces()) <> 1 then raise exception 'FAIL: a link made before the removal brought the member back'; end if;
end $$;
select public.accept_invite((select v from t_ctx where k = 'fresh_token'));
do $$ begin
  if not (select active from public.members where user_id = auth.uid()) then raise exception 'FAIL: fresh invite did not reactivate member'; end if;
  if (select leaving_on from public.members where user_id = auth.uid()) is not null then raise exception 'FAIL: rejoin kept the old leaving date'; end if;
  if (select count(*) from public.my_removed_workspaces()) <> 0 then raise exception 'FAIL: active member still reported as removed'; end if;
  if (select count(*) from public.projects) <> 1 then raise exception 'FAIL: restored member cannot read projects'; end if;
end $$;

-- Anon can't read the activity log. A row is planted first (as the database owner) so an empty table can't pass this.
reset role;
insert into public.activity (id, workspace_id, data)
  select 'a_anon_probe', v::uuid, '{"projectId":"p_t1","kind":"sync","title":"probe"}' from t_ctx where k = 'ws';
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$ begin
  begin
    if (select count(*) from public.activity) <> 0 then raise exception 'FAIL: anon can read activity'; end if;
  exception when insufficient_privilege then null; -- since 0016 anon can't even run the membership check
  end;
end $$;

-- 0004 workspace kinds. Bob is now a member (not owner) of Alice's org.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated"}';
do $$ begin
  if (select kind from public.workspaces where id = (select v::uuid from t_ctx where k = 'ws')) <> 'org' then
    raise exception 'FAIL: create_workspace should make an org';
  end if;
  begin
    perform public.upgrade_to_org((select v::uuid from t_ctx where k = 'ws'), null);
    raise exception 'FAIL: non-owner called upgrade_to_org';
  exception when raise_exception then
    if sqlerrm not like 'Only the owner%' then raise; end if;
  end;
end $$;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
insert into t_ctx values ('solo', public.create_workspace_of_kind('Solo', 'personal', null)::text);
do $$ begin
  if (select kind from public.workspaces where id = (select v::uuid from t_ctx where k = 'solo')) <> 'personal' then
    raise exception 'FAIL: personal workspace not created';
  end if;
  begin
    perform public.create_workspace_of_kind('Solo 2', 'personal', null);
    raise exception 'FAIL: second personal workspace allowed';
  exception when unique_violation then null;
  end;
  begin
    perform public.create_workspace_of_kind('x', 'team', null);
    raise exception 'FAIL: unknown kind accepted';
  exception when raise_exception then
    if sqlerrm not like 'kind must be%' then raise; end if;
  end;
  begin
    insert into public.invites (workspace_id) select v::uuid from t_ctx where k = 'solo';
    raise exception 'FAIL: invite created in a personal workspace';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    update public.workspaces set kind = 'org' where id = (select v::uuid from t_ctx where k = 'solo');
    raise exception 'FAIL: kind changed by direct update';
  exception when insufficient_privilege then null;
  end;
  perform public.upgrade_to_org((select v::uuid from t_ctx where k = 'solo'), 'Solo Inc');
  if (select kind || '/' || name from public.workspaces where id = (select v::uuid from t_ctx where k = 'solo')) <> 'org/Solo Inc' then
    raise exception 'FAIL: owner upgrade did not apply';
  end if;
  insert into public.invites (workspace_id) select v::uuid from t_ctx where k = 'solo'; -- allowed once it's an org
end $$;

-- 0005 roles. Alice (owner) restores Bob, who was removed above; he is a plain member again.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
update public.members set active = true where user_id = '00000000-0000-0000-0000-00000000000b';
-- 0016: the database, not the client, says who made an invite or changed an app. An expired link's public preview
-- shows its status and nothing else.
with spoofed as (
  insert into public.invites (workspace_id, created_by)
  select v::uuid, '00000000-0000-0000-0000-00000000000b' from t_ctx where k = 'ws' returning token
)
insert into t_ctx select 'revoke_token', token from spoofed on conflict (k) do update set v = excluded.v;
with expired as (
  insert into public.invites (workspace_id, email, expires_at)
  select v::uuid, 'late@test.local', now() - interval '1 day' from t_ctx where k = 'ws' returning token
)
insert into t_ctx select 'expired_token', token from expired on conflict (k) do update set v = excluded.v;
update public.projects set updated_by = '00000000-0000-0000-0000-00000000000b' where id = 'p_t1';
do $$ begin
  if (select created_by from public.invites where token = (select v from t_ctx where k = 'revoke_token')) <> auth.uid() then
    raise exception 'FAIL: an invite kept the created_by the client sent';
  end if;
  if (select updated_by from public.projects where id = 'p_t1') <> auth.uid() then
    raise exception 'FAIL: an app kept the updated_by the client sent';
  end if;
  if public.invite_preview((select v from t_ctx where k = 'expired_token'))::jsonb
     <> '{"status":"expired","inviter_name":null,"workspace_name":null,"apps":[]}'::jsonb then
    raise exception 'FAIL: an expired invite preview shows details';
  end if;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated"}';
do $$
declare ws uuid := (select v::uuid from t_ctx where k = 'ws'); n int;
begin
  begin
    insert into public.invites (workspace_id) values (ws);
    raise exception 'FAIL: plain member created an invite';
  exception when insufficient_privilege or check_violation then null;
  end;
  -- 0016: a plain member can't revoke an invite (the delete matches nothing).
  delete from public.invites where token = (select v from t_ctx where k = 'revoke_token');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: plain member deleted an invite'; end if;
  update public.projects set data = data || '{"name":"hijacked"}' where id = 'p_t1';
  if (select data->>'name' from public.projects where id = 'p_t1') <> 'Bot' then raise exception 'FAIL: member edited an app they do not own'; end if;
  insert into public.projects (id, workspace_id, data) values ('p_bob', ws, jsonb_build_object('name', 'Bob app', 'ownerId', public.my_member_id(ws)));
  update public.projects set data = data || '{"name":"Bob app 2"}' where id = 'p_bob';
  if (select data->>'name' from public.projects where id = 'p_bob') <> 'Bob app 2' then raise exception 'FAIL: member cannot edit their own app'; end if;
  insert into public.tasks (id, workspace_id, data) values ('t_bob', ws, '{"title":"mine","projectId":"p_bob"}');
  begin
    insert into public.tasks (id, workspace_id, data) values ('t_bad2', ws, '{"title":"x","projectId":"p_t1"}');
    raise exception 'FAIL: member added a task to an app they do not own';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    perform public.set_member_admin(public.my_member_id(ws), true);
    raise exception 'FAIL: member made themselves admin';
  exception when raise_exception then
    if sqlerrm not like 'Only the owner%' then raise; end if;
  end;
  begin
    perform public.set_workspace_github_org(ws, 'acme');
    raise exception 'FAIL: plain member changed the GitHub organisation';
  exception when raise_exception then
    if sqlerrm not like 'Only the workspace owner or an admin%' then raise; end if;
  end;
end $$;

-- 0016: the owner revokes the invite the plain member couldn't (the client deletes by token, the table's key).
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
do $$
declare n int;
begin
  delete from public.invites where token = (select v from t_ctx where k = 'revoke_token');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: the owner could not revoke an invite'; end if;
end $$;

-- 0012 invite answers. Bob is already a member; accepting takes an app from its placeholder, declining clears it.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
insert into public.members (id, workspace_id, name, email)
  select 'm_invited_owner', v::uuid, 'Invited owner', 'owner@test.local' from t_ctx where k = 'ws';
insert into public.projects (id, workspace_id, data)
  select 'p_handoff', v::uuid, '{"name":"Handoff app","ownerId":"m_invited_owner"}' from t_ctx where k = 'ws';
insert into public.invites (workspace_id, app_ids)
  select v::uuid, array['p_handoff']::text[] from t_ctx where k = 'ws';
insert into t_ctx select 'handoff_token', token from public.invites where 'p_handoff' = any(app_ids)
  on conflict (k) do update set v = excluded.v;

insert into public.members (id, workspace_id, name, email)
  select 'm_declined_owner', v::uuid, 'Wrong owner', 'wrong@test.local' from t_ctx where k = 'ws';
insert into public.projects (id, workspace_id, data)
  select 'p_declined', v::uuid, '{"name":"Declined app","ownerId":"m_declined_owner"}' from t_ctx where k = 'ws';
insert into public.invites (workspace_id, app_ids)
  select v::uuid, array['p_declined']::text[] from t_ctx where k = 'ws';
insert into t_ctx select 'decline_token', token from public.invites where 'p_declined' = any(app_ids)
  on conflict (k) do update set v = excluded.v;

set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated"}';
select public.accept_invite_apps((select v from t_ctx where k = 'handoff_token'), array['p_handoff']::text[], null);
select public.accept_invite_apps((select v from t_ctx where k = 'decline_token'), '{}'::text[], 'Not my project');
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
do $$
begin
  if (select data->>'ownerId' from public.projects where id = 'p_handoff') <>
      (select id from public.members where user_id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'FAIL: existing member did not receive the placeholder-owned app';
  end if;
  if (select data->>'ownerId' from public.projects where id = 'p_declined') is not null then
    raise exception 'FAIL: declined app stayed on its placeholder owner';
  end if;
  if not exists (
    select 1 from public.invites
    where token = (select v from t_ctx where k = 'decline_token')
      and used_at is not null and declined_at is not null and decline_note = 'Not my project'
  ) then
    raise exception 'FAIL: declined invite answer was not recorded';
  end if;
  -- 0016: an answered (used) link's public preview names nobody and no apps.
  if public.invite_preview((select v from t_ctx where k = 'decline_token'))::jsonb
     <> '{"status":"used","inviter_name":null,"workspace_name":null,"apps":[]}'::jsonb then
    raise exception 'FAIL: a used invite preview shows details';
  end if;
end $$;

-- Alice makes Bob an admin; now he can edit any app and invite.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
select public.set_workspace_github_org((select v::uuid from t_ctx where k = 'ws'), 'Acme');
select public.set_member_admin((select id from public.members where user_id = '00000000-0000-0000-0000-00000000000b'), true);
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated"}';
do $$
declare ws uuid := (select v::uuid from t_ctx where k = 'ws');
begin
  if (select github_org from public.workspaces where id = ws) <> 'Acme' then raise exception 'FAIL: owner did not set the GitHub organisation'; end if;
  perform public.set_workspace_github_org(ws, 'Acme-Team');
  if (select github_org from public.workspaces where id = ws) <> 'Acme-Team' then raise exception 'FAIL: admin cannot set the GitHub organisation'; end if;
  update public.projects set data = data || '{"name":"Bot by admin"}' where id = 'p_t1';
  if (select data->>'name' from public.projects where id = 'p_t1') <> 'Bot by admin' then raise exception 'FAIL: admin cannot edit apps'; end if;
  insert into public.invites (workspace_id) values (ws);
  -- 0016: an admin adds plain placeholders only. One flagged admin (or an owner row) would hand those rights to
  -- whoever claims it.
  begin
    insert into public.members (workspace_id, name, is_admin) values (ws, 'Shadow admin', true);
    raise exception 'FAIL: admin inserted an admin placeholder';
  exception when insufficient_privilege or check_violation then null;
  end;
  begin
    insert into public.members (workspace_id, name, role) values (ws, 'Shadow owner', 'owner');
    raise exception 'FAIL: admin inserted an owner';
  exception when insufficient_privilege or check_violation then null;
  end;
  insert into public.members (id, workspace_id, name) values ('m_by_admin', ws, 'Added by admin');
end $$;

-- 0016 placeholder claims. A placeholder can't be made admin, and joining claims a placeholder by the GitHub identity
-- (auth.identities), never by user_name in the user metadata, which anyone can rewrite with auth.updateUser.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
do $$ begin
  begin
    perform public.set_member_admin('m_by_admin', true);
    raise exception 'FAIL: a placeholder was made admin';
  exception when raise_exception then
    if sqlerrm not like 'Only people who have joined%' then raise; end if;
  end;
end $$;
insert into public.members (id, workspace_id, name, github_login) select 'm_victim', v::uuid, 'Victim', 'victimgh' from t_ctx where k = 'ws';
insert into public.members (id, workspace_id, name, github_login) select 'm_carol', v::uuid, 'Carol (placeholder)', 'CarolGH' from t_ctx where k = 'ws';
with team as (insert into public.invites (workspace_id) select v::uuid from t_ctx where k = 'ws' returning token)
insert into t_ctx select 'team2_token', token from team on conflict (k) do update set v = excluded.v;
-- Mallory names herself after the victim; Carol renames herself. Their GitHub identities stay what GitHub said.
reset role;
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"user_name":"victimgh"}' where id = '00000000-0000-0000-0000-00000000000d';
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"user_name":"not-carol"}' where id = '00000000-0000-0000-0000-00000000000c';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000d","email":"mallory@test.local","role":"authenticated"}';
select public.accept_invite((select v from t_ctx where k = 'team2_token'));
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","email":"carol@test.local","role":"authenticated"}';
select public.accept_invite((select v from t_ctx where k = 'team2_token'));
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
do $$
declare ws uuid := (select v::uuid from t_ctx where k = 'ws');
begin
  if (select user_id from public.members where id = 'm_victim') is not null then
    raise exception 'FAIL: a user_name in user metadata claimed someone else''s placeholder';
  end if;
  if not exists (select 1 from public.members where workspace_id = ws and user_id = '00000000-0000-0000-0000-00000000000d' and id <> 'm_victim') then
    raise exception 'FAIL: Mallory did not join as herself';
  end if;
  if (select user_id from public.members where id = 'm_carol') is distinct from '00000000-0000-0000-0000-00000000000c'::uuid then
    raise exception 'FAIL: the GitHub identity did not claim its placeholder';
  end if;
  if (select is_admin from public.members where id = 'm_carol') then raise exception 'FAIL: a claimed placeholder brought admin rights'; end if;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon', 'public.is_member(uuid)', 'execute')
     or has_function_privilege('anon', 'public.is_manager(uuid)', 'execute')
     or has_function_privilege('anon', 'public.my_member_id(uuid)', 'execute') then
    raise exception 'FAIL: anon can run the membership helpers';
  end if;
  if not has_function_privilege('authenticated', 'public.is_member(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.is_manager(uuid)', 'execute') then
    raise exception 'FAIL: authenticated lost the membership helpers the access rules call';
  end if;
  if not has_function_privilege('anon', 'public.invite_preview(text)', 'execute') then
    raise exception 'FAIL: signed-out people can no longer preview an invite';
  end if;
end $$;
do $$ begin
  if has_function_privilege('anon', 'public.set_workspace_github_org(uuid,text)', 'execute') then
    raise exception 'FAIL: anon can set the GitHub organisation';
  end if;
  if not has_function_privilege('authenticated', 'public.set_workspace_github_org(uuid,text)', 'execute') then
    raise exception 'FAIL: authenticated cannot call set_workspace_github_org';
  end if;
end $$;

-- 0017 and 0018 · MCP agent tokens (a JWT with client_id): no direct table access, only the mcp_* functions.
-- Dave is a plain member of Acme who owns no app. Alice owns the workspace, so she may edit p_t1.
-- Each agent token carries a session_id that must exist in auth.sessions (revoking a client deletes its sessions).
-- Stored results are checked as postgres: an agent token sees no table rows, so reading them as the agent would
-- always find null.
reset role;
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role)
values ('00000000-0000-0000-0000-0000000000e1', 'dave@test.local', '{"full_name":"Dave"}', '{"provider":"github"}', 'authenticated', 'authenticated');
insert into public.members (id, workspace_id, user_id, name, email, role)
select 'm_dave', v::uuid, '00000000-0000-0000-0000-0000000000e1', 'Dave', 'dave@test.local', 'member' from t_ctx where k = 'ws';
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a5e1', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000d5e1', '00000000-0000-0000-0000-0000000000e1');
update public.projects set data = data || '{"access":"Ask ops for the vault password"}' where id = 'p_t1';
set local role authenticated;

-- A browser session (no client_id) still passes the guard and reads tables as before.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
do $$ begin
  perform set_config('request.method', 'GET', true);
  perform set_config('request.path', '/projects', true);
  perform public.mcp_request_guard();
  if not exists (select 1 from public.projects where id = 'p_t1') then raise exception 'FAIL: a browser session lost its app read'; end if;
end $$;

-- An agent token without a live sign-in is refused before anything else (PT401 = HTTP 401).
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","client_id":"test-client"}';
do $$ begin
  perform set_config('request.method', 'POST', true);
  perform set_config('request.path', '/rpc/mcp_list_apps', true);
  begin
    perform public.mcp_request_guard();
    raise exception 'FAIL: an agent token without a session_id got through';
  exception when sqlstate 'PT401' then null;
  end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","client_id":"test-client","session_id":"00000000-0000-0000-0000-00000000dead"}';
do $$ begin
  begin
    perform public.mcp_request_guard();
    raise exception 'FAIL: an agent token whose sign-in was revoked got through';
  exception when sqlstate 'PT401' then null;
  end;
end $$;

-- Alice through an agent.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated","client_id":"test-client","session_id":"00000000-0000-0000-0000-00000000a5e1"}';
do $$
declare n int; list text; r jsonb;
begin
  -- The guard: only POSTs to the five mcp_* functions get through.
  perform set_config('request.method', 'GET', true);
  perform set_config('request.path', '/projects', true);
  begin
    perform public.mcp_request_guard();
    raise exception 'FAIL: the guard let an agent read /projects';
  exception when sqlstate 'PT403' then null;
  end;
  perform set_config('request.method', 'POST', true);
  perform set_config('request.path', '/rpc/set_member_admin', true);
  begin
    perform public.mcp_request_guard();
    raise exception 'FAIL: the guard let an agent call set_member_admin';
  exception when sqlstate 'PT403' then null;
  end;
  perform set_config('request.path', '/rest/v1/rpc/mcp_list_apps', true);
  perform public.mcp_request_guard();
  perform set_config('request.path', '/rpc/mcp_submit_tasks', true);
  perform public.mcp_request_guard();

  -- No direct table access, even behind the guard.
  if exists (select 1 from public.projects) then raise exception 'FAIL: an agent token reads projects directly'; end if;
  if exists (select 1 from public.members) then raise exception 'FAIL: an agent token reads members directly'; end if;
  update public.projects set data = data || '{"name":"hijacked"}' where id = 'p_t1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: an agent token updated an app directly'; end if;
  begin
    insert into public.activity (id, workspace_id, data) select 'a_agent', v::uuid, '{"kind":"sync"}' from t_ctx where k = 'ws';
    raise exception 'FAIL: an agent token inserted activity directly';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Reads through the functions: own workspace only, no emails, no access note.
  list := public.mcp_list_apps()::text;
  if list not like '%p_t1%' then raise exception 'FAIL: mcp_list_apps missed the caller''s app'; end if;
  if list like '%p_other%' then raise exception 'FAIL: mcp_list_apps leaked another workspace'; end if;
  if list like '%@test.local%' then raise exception 'FAIL: mcp_list_apps leaked an email'; end if;
  if list like '%vault password%' or public.mcp_get_app('p_t1')::text like '%vault password%' then
    raise exception 'FAIL: an access note reached an agent';
  end if;
  begin
    perform public.mcp_get_app('p_other');
    raise exception 'FAIL: an agent read a foreign app';
  exception when no_data_found then null;
  end;

  -- A card draft, even when the caller claims it was checked; a bad stage and a foreign app are refused.
  perform public.mcp_submit_card('p_t1', '{"what":"A bot\u202e\r","who":"Ops","stage":"building","status":"Working on it","checkedAt":"2026-01-01"}', 'Claude Code');
  begin
    perform public.mcp_submit_card('p_t1', '{"what":"A bot","who":"Ops","stage":"launched","status":"x"}', null);
    raise exception 'FAIL: a card with an unknown stage was saved';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.mcp_submit_card('p_other', '{"what":"A bot","who":"Ops","stage":"live","status":"x"}', null);
    raise exception 'FAIL: an agent wrote a card on a foreign app';
  exception when no_data_found then null;
  end;

  -- A handover draft: a link outside the app's repo is dropped, a list item that isn't text is refused.
  perform public.mcp_submit_handover('p_t1', '{"summary":"Runs the bot.","howToRun":["npm start"],"whereThingsAre":[{"path":"src/","what":"code"}],
    "openWork":[{"title":"Phish","evidenceUrl":"https://evil.example/x"},{"title":"Fix login","evidenceUrl":"https://github.com/acme/bot/issues/7"}],
    "risks":[],"contacts":[],"unknowns":[]}', 'Codex');
  begin
    perform public.mcp_submit_handover('p_t1', '{"summary":"s","howToRun":[{"cmd":"x"}],"whereThingsAre":[],"openWork":[],"risks":[],"contacts":[],"unknowns":[]}', 'Codex');
    raise exception 'FAIL: a handover list holding an object was saved';
  exception when invalid_parameter_value then null;
  end;
  if public.mcp_get_app('p_t1')::text like '%Runs the bot%' then raise exception 'FAIL: mcp_get_app returned the whole handover'; end if;

  -- 0018 tasks: the owner's agent may add them (text cleaned, stored open); a list that isn't a list of at most 10 objects,
  -- an unknown problem, a missing or empty title, a detail that isn't text, more than 3 for one problem and a foreign app are refused.
  r := public.mcp_submit_tasks('p_t1', '[{"problem":"no-readme","title":"Write a README\u202e","detail":"Say how to run it."},
    {"problem":"stale","title":"Archive it","detail":null},{"problem":"stale","title":"  Or ask the owner  \n"}]', 'Claude Code');
  if r->>'tasks' is distinct from '3' or r->>'appId' is distinct from 'p_t1' then raise exception 'FAIL: mcp_submit_tasks answered %', r; end if;
  begin
    perform public.mcp_submit_tasks('p_t1', '{"problem":"stale","title":"x"}', null);
    raise exception 'FAIL: tasks that were not a list were saved';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.mcp_submit_tasks('p_t1', '[{"problem":"nonsense","title":"x"}]', null);
    raise exception 'FAIL: a task with an unknown problem was saved';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.mcp_submit_tasks('p_t1', '["no-readme"]', null);
    raise exception 'FAIL: a task that was not an object was saved';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.mcp_submit_tasks('p_t1', '[{"problem":"stale"}]', null);
    raise exception 'FAIL: a task with no title was saved';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.mcp_submit_tasks('p_t1', '[{"problem":"stale","title":"\u200b  "}]', null);
    raise exception 'FAIL: a task with an empty title was saved';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.mcp_submit_tasks('p_t1', '[{"problem":"stale","title":"x","detail":{"a":1}}]', null);
    raise exception 'FAIL: a task with a detail that was not text was saved';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.mcp_submit_tasks('p_t1', (select jsonb_agg(jsonb_build_object('problem', 'no-readme', 'title', 'Task ' || g)) from generate_series(1, 11) g), null);
    raise exception 'FAIL: 11 tasks were saved';
  exception when invalid_parameter_value then
    if sqlerrm not like '%at most 10%' then raise exception 'FAIL: 11 tasks were refused for another reason: %', sqlerrm; end if;
  end;
  begin
    perform public.mcp_submit_tasks('p_t1', (select jsonb_agg(jsonb_build_object('problem', 'no-readme', 'title', 'Task ' || g)) from generate_series(1, 4) g), null);
    raise exception 'FAIL: 4 tasks for one problem were saved';
  exception when invalid_parameter_value then
    if sqlerrm not like '%At most 3 tasks per problem%' then raise exception 'FAIL: 4 tasks for one problem were refused for another reason: %', sqlerrm; end if;
  end;
  begin
    perform public.mcp_submit_tasks('p_other', '[{"problem":"stale","title":"x"}]', null);
    raise exception 'FAIL: an agent wrote tasks on a foreign app';
  exception when no_data_found then null;
  end;
end $$;

-- What the agent wrote, read back as postgres.
reset role;
do $$
declare card jsonb := (select data->'appCard' from public.projects where id = 'p_t1');
        h jsonb := (select data->'handover' from public.projects where id = 'p_t1');
        t jsonb := (select data->'tasks' from public.projects where id = 'p_t1');
begin
  if card is null or card->>'source' is distinct from 'ai' or card->'checkedAt' is distinct from 'null'::jsonb
     or card->'checkedBy' is distinct from 'null'::jsonb then
    raise exception 'FAIL: an MCP card was not an unchecked draft';
  end if;
  if card->'draftedBy'->>'client' is distinct from 'Claude Code' or card->'draftedBy'->>'clientId' is distinct from 'test-client' then
    raise exception 'FAIL: draftedBy missing on an MCP card';
  end if;
  if card->>'what' is distinct from 'A bot' then raise exception 'FAIL: a bidi override or carriage return survived in a card: %', card->>'what'; end if;
  if h is null or h->'draftedBy'->>'client' is distinct from 'Codex' or h->'checkedAt' is distinct from 'null'::jsonb then
    raise exception 'FAIL: the handover was not stored as an unchecked draft';
  end if;
  if h->'doc'->'openWork'->0 ? 'evidenceUrl' then raise exception 'FAIL: a link outside the repo was stored'; end if;
  if h->'doc'->'openWork'->1->>'evidenceUrl' is distinct from 'https://github.com/acme/bot/issues/7' then
    raise exception 'FAIL: a link into the app''s own repo was dropped: %', h->'doc'->'openWork';
  end if;
  -- 0018: the refused calls above saved nothing; the three tasks are open, drafted by the agent, with clean one-line text.
  if jsonb_typeof(t) is distinct from 'array' or jsonb_array_length(t) <> 3 then raise exception 'FAIL: the agent''s tasks were not stored as sent: %', t; end if;
  if exists (select 1 from jsonb_array_elements(t) e
             where e->'fixedAt' is distinct from 'null'::jsonb or e->'draftedBy'->>'client' is distinct from 'Claude Code'
                or e->'draftedBy'->>'clientId' is distinct from 'test-client' or e->'draftedBy'->>'memberId' is null
                or coalesce(e->>'id', '') = '' or e->>'createdAt' is null) then
    raise exception 'FAIL: a stored task was not an open task drafted by the agent: %', t;
  end if;
  if (select count(distinct e->>'id') from jsonb_array_elements(t) e) <> 3 then raise exception 'FAIL: task ids were not distinct'; end if;
  if t->0->>'title' is distinct from 'Write a README' or t->0->>'detail' is distinct from 'Say how to run it.'
     or t->1->'detail' is distinct from 'null'::jsonb or t->2->>'title' is distinct from 'Or ask the owner' or t->2->'detail' is distinct from 'null'::jsonb then
    raise exception 'FAIL: task text was not cleaned: %', t;
  end if;
  if not exists (select 1 from public.activity where data->>'projectId' = 'p_t1' and data->>'title' = 'Added 3 tasks') then
    raise exception 'FAIL: adding tasks left no activity line';
  end if;
end $$;
-- Close one task, as a sync does, so the next list has a fixed task to keep.
update public.projects set data = jsonb_set(data, '{tasks}', (
  select jsonb_agg(case when e->>'title' = 'Archive it' then e || '{"fixedAt":"2026-10-01T00:00:00Z"}'::jsonb else e end order by o)
  from jsonb_array_elements(data->'tasks') with ordinality as x(e, o))) where id = 'p_t1';
set local role authenticated;

-- 0018 tasks, round two (Alice's agent): a new list replaces the open tasks and keeps the fixed one.
do $$ begin
  if public.mcp_submit_tasks('p_t1', '[{"problem":"no-readme","title":"Write the README properly"}]', 'Claude Code')->>'tasks' is distinct from '1' then
    raise exception 'FAIL: a second task list was not saved';
  end if;
end $$;
reset role;
do $$
declare t jsonb := (select data->'tasks' from public.projects where id = 'p_t1');
begin
  if jsonb_typeof(t) is distinct from 'array' or jsonb_array_length(t) <> 2
     or not exists (select 1 from jsonb_array_elements(t) e where e->>'title' = 'Archive it' and e->>'fixedAt' = '2026-10-01T00:00:00Z')
     or not exists (select 1 from jsonb_array_elements(t) e where e->>'title' = 'Write the README properly' and e->'fixedAt' = 'null'::jsonb)
     or exists (select 1 from jsonb_array_elements(t) e where e->>'title' in ('Write a README', 'Or ask the owner')) then
    raise exception 'FAIL: a new task list did not replace the open tasks and keep the fixed one: %', t;
  end if;
end $$;
-- Twelve fixed tasks and one open one, then an empty list: it clears the open task and keeps the 10 most recent fixed ones.
update public.projects set data = jsonb_set(data, '{tasks}',
  (select jsonb_agg(jsonb_build_object('id', 'f' || g, 'problem', 'stale', 'title', 'Old ' || g, 'detail', null, 'createdAt', '2026-09-01T00:00:00Z',
                                       'fixedAt', to_jsonb(timestamptz '2026-09-01 00:00:00+00' + g * interval '1 day'))) from generate_series(1, 12) g)
  || '[{"id":"o1","problem":"stale","title":"Open one","detail":null,"createdAt":"2026-10-01T00:00:00Z","fixedAt":null}]'::jsonb)
  where id = 'p_t1';
set local role authenticated;
do $$ begin
  if public.mcp_submit_tasks('p_t1', '[]', 'Claude Code')->>'tasks' is distinct from '0' then raise exception 'FAIL: an empty task list was not accepted'; end if;
end $$;
reset role;
do $$
declare t jsonb := (select data->'tasks' from public.projects where id = 'p_t1');
begin
  if jsonb_typeof(t) is distinct from 'array' or jsonb_array_length(t) <> 10
     or exists (select 1 from jsonb_array_elements(t) e where e->>'id' in ('o1', 'f1', 'f2') or e->'fixedAt' = 'null'::jsonb)
     or not exists (select 1 from jsonb_array_elements(t) e where e->>'id' = 'f12') then
    raise exception 'FAIL: an empty task list should clear the open tasks and keep the 10 most recent fixed ones: %', t;
  end if;
  if not exists (select 1 from public.activity where data->>'projectId' = 'p_t1' and data->>'title' = 'Cleared its tasks') then
    raise exception 'FAIL: clearing tasks left no activity line';
  end if;
end $$;
set local role authenticated;

-- 0018 · links never reach a task: Alice's agent sends some; the stored text has none.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated","client_id":"test-client","session_id":"00000000-0000-0000-0000-00000000a5e1"}';
do $$ begin
  perform public.mcp_submit_tasks('p_t1', '[{"problem":"no-readme","title":"Read https://evil.example/login now","detail":"See www.evil.example or http://x.y/z for help"},
    {"problem":"stale","title":"Archive the repo"},{"problem":"stale","title":"Tell the team"}]', 'Claude Code');
end $$;
reset role;
do $$
declare t jsonb := (select data->'tasks' from public.projects where id = 'p_t1');
begin
  if t::text ~* '(https?://|www\.)' then raise exception 'FAIL: a link was stored in a task: %', t; end if;
  if not exists (select 1 from jsonb_array_elements(t) e where e->>'title' = 'Read now' and e->>'detail' = 'See or for help') then
    raise exception 'FAIL: task text lost more than its links: %', t;
  end if;
  perform set_config('t.ws', (select v from t_ctx where k = 'ws'), true);
  perform set_config('t.tasks_at', (select data->>'tasksAt' from public.projects where id = 'p_t1'), true);
  if current_setting('t.tasks_at', true) is null then raise exception 'FAIL: a task list was saved without tasksAt'; end if;
end $$;

-- 0018 · a browser save can't undo an agent's newer write. Alice in the browser (no client_id) saves p_t1 from a copy
-- older than the agent's task list: every stored task stays, nothing she invents is added, tasksAt stays.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
update public.projects set data = data - 'tasks' || jsonb_build_object('tasksAt', '2026-01-01T00:00:00Z',
  'tasks', '[{"id":"forged","problem":"secrets","title":"Paste the key here","detail":null,"createdAt":"2026-01-01T00:00:00Z","fixedAt":null}]'::jsonb)
  where id = 'p_t1';
do $$
declare d jsonb := (select data from public.projects where id = 'p_t1');
begin
  if jsonb_array_length(d->'tasks') <> 13 or (d->'tasks')::text like '%forged%' or d->>'tasksAt' is distinct from current_setting('t.tasks_at') then
    raise exception 'FAIL: a stale browser save changed the agent''s tasks: %', d->'tasks';
  end if;
end $$;
-- An up-to-date copy may remove a task and mark one fixed, but not reword one or add one.
update public.projects set data = jsonb_set(data, '{tasks}', (
  select jsonb_agg(case
      when e->>'title' = 'Archive the repo' then e || '{"fixedAt":"2026-10-02T00:00:00Z"}'::jsonb
      when e->>'title' = 'Read now' then e || '{"title":"Rewritten by hand"}'::jsonb
      else e end)
  from jsonb_array_elements(data->'tasks') e where e->>'title' <> 'Tell the team')
  || '[{"id":"forged2","problem":"stale","title":"Invented","detail":null,"createdAt":"2030-01-01T00:00:00Z","fixedAt":null}]'::jsonb)
  where id = 'p_t1';
do $$
declare t jsonb := (select data->'tasks' from public.projects where id = 'p_t1');
begin
  if exists (select 1 from jsonb_array_elements(t) e where e->>'title' in ('Tell the team', 'Invented', 'Rewritten by hand')) then
    raise exception 'FAIL: a browser save added, kept or reworded a task it may not: %', t;
  end if;
  -- The database stamps its own time on a newly fixed task, not the browser's.
  if not exists (select 1 from jsonb_array_elements(t) e where e->>'title' = 'Archive the repo' and public.mcp_ts(e->>'fixedAt') = now())
     or not exists (select 1 from jsonb_array_elements(t) e where e->>'title' = 'Read now' and e->'fixedAt' = 'null'::jsonb) then
    raise exception 'FAIL: a browser save could not mark a task fixed, or kept the browser''s time: %', t;
  end if;
end $$;
-- Remove marks a task removed (stamped by the database) and Undo takes it back, at any time.
update public.projects set data = jsonb_set(data, '{tasks}', (select jsonb_agg(case when e->>'title' = 'Read now'
  then e || '{"removedAt":"2001-01-01T00:00:00Z"}'::jsonb else e end) from jsonb_array_elements(data->'tasks') e)) where id = 'p_t1';
do $$ begin
  if not exists (select 1 from jsonb_array_elements((select data->'tasks' from public.projects where id = 'p_t1')) e
                 where e->>'title' = 'Read now' and public.mcp_ts(e->>'removedAt') = now()) then
    raise exception 'FAIL: removing a task did not mark it removed with the database''s time';
  end if;
end $$;
update public.projects set data = jsonb_set(data, '{tasks}', (select jsonb_agg(case when e->>'title' = 'Read now'
  then e || '{"removedAt":null}'::jsonb else e end) from jsonb_array_elements(data->'tasks') e)) where id = 'p_t1';
do $$ begin
  if not exists (select 1 from jsonb_array_elements((select data->'tasks' from public.projects where id = 'p_t1')) e
                 where e->>'title' = 'Read now' and e->'removedAt' = 'null'::jsonb) then
    raise exception 'FAIL: Undo could not bring a removed task back';
  end if;
end $$;
-- Removed again, then Claude sends the same task: it stays removed and isn't added a second time.
update public.projects set data = jsonb_set(data, '{tasks}', (select jsonb_agg(case when e->>'title' = 'Read now'
  then e || '{"removedAt":"x"}'::jsonb else e end) from jsonb_array_elements(data->'tasks') e)) where id = 'p_t1';
-- A browser session can't call the agent's write functions, so it can't pass itself off as Claude.
do $$ begin
  perform public.mcp_submit_tasks('p_t1', '[{"problem":"no-readme","title":"Forged by a browser"}]', 'Claude');
  raise exception 'FAIL: a browser session called mcp_submit_tasks';
exception when insufficient_privilege then null;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated","client_id":"test-client","session_id":"00000000-0000-0000-0000-00000000a5e1"}';
do $$ begin
  if public.mcp_submit_tasks('p_t1', '[{"problem":"no-readme","title":"read now"}]', 'Claude Code')->>'tasks' is distinct from '0' then
    raise exception 'FAIL: Claude added a task a person had removed';
  end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from jsonb_array_elements((select data->'tasks' from public.projects where id = 'p_t1')) e
      where lower(e->>'title') = 'read now') <> 1 then
    raise exception 'FAIL: a removed task was lost or doubled when Claude sent its list again';
  end if;
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
-- 0019: with her own AI key, the app's owner adds tasks through key_submit_tasks. They replace the open tasks only for
-- the problems sent, a removed task isn't added again, and the author is the key, never an AI app.
do $$
declare d jsonb; t jsonb;
begin
  if public.key_submit_tasks('p_t1', '[{"problem":"secrets","title":"Rotate the leaked key https://evil.example"}]', 'OpenAI API key')->>'tasks'
     is distinct from '1' then raise exception 'FAIL: the owner could not add tasks with her key'; end if;
  if public.key_submit_tasks('p_t1', '[{"problem":"stale","title":"Ship a small fix"},{"problem":"no-readme","title":"Read now"}]',
       'Anthropic API key')->>'tasks' is distinct from '1' then
    raise exception 'FAIL: key tasks re-added a removed task, or dropped a new one';
  end if;
  d := (select data from public.projects where id = 'p_t1');
  if not exists (select 1 from jsonb_array_elements(d->'tasks') e where e->>'title' = 'Rotate the leaked key' and e->'fixedAt' = 'null'::jsonb) then
    raise exception 'FAIL: key tasks for one problem dropped another problem''s open task, or kept a link: %', d->'tasks';
  end if;
  t := (select e from jsonb_array_elements(d->'tasks') e where e->>'title' = 'Ship a small fix');
  if t is null or t->'draftedBy'->>'client' is distinct from 'Anthropic API key' or t->'draftedBy'->'clientId' <> 'null'::jsonb
     or t->'draftedBy'->>'memberId' is null then
    raise exception 'FAIL: a key task has the wrong author: %', t;
  end if;
  if (select count(*) from jsonb_array_elements(d->'tasks') e where lower(e->>'title') = 'read now') <> 1 then
    raise exception 'FAIL: a removed task was lost or doubled by key tasks';
  end if;
  if (d->>'tasksAt')::timestamptz <> now() then raise exception 'FAIL: key tasks did not stamp tasksAt'; end if;
  begin
    perform public.key_submit_tasks('p_t1', '[{"problem":"nonsense","title":"x"}]', 'Key');
    raise exception 'FAIL: key tasks accepted an unknown problem';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.key_submit_tasks('p_t1', (select jsonb_agg(jsonb_build_object('problem', 'stale', 'title', 'Task ' || g)) from generate_series(1, 4) g), 'Key');
    raise exception 'FAIL: key tasks accepted 4 tasks for one problem';
  exception when sqlstate '22023' then null;
  end;
  begin
    perform public.key_submit_tasks('p_other', '[{"problem":"stale","title":"x"}]', 'Key');
    raise exception 'FAIL: key tasks reached an app in another workspace';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.tasks_check('[]');
    raise exception 'FAIL: a browser can call the internal tasks_check';
  exception when insufficient_privilege then null;
  end;
end $$;
-- An AI app's token can't use the key's function: it has mcp_submit_tasks, and the guard doesn't list this one.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated","client_id":"test-client","session_id":"00000000-0000-0000-0000-00000000a5e1"}';
do $$ begin
  begin
    perform public.key_submit_tasks('p_t1', '[{"problem":"stale","title":"Pretend to be a key"}]', 'Anthropic API key');
    raise exception 'FAIL: an AI app''s token called key_submit_tasks';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.method', 'POST', true);
  perform set_config('request.path', '/rpc/key_submit_tasks', true);
  begin
    perform public.mcp_request_guard();
    raise exception 'FAIL: the guard let an agent call key_submit_tasks';
  exception when sqlstate 'PT403' then null;
  end;
end $$;
-- A member who doesn't own the app is refused, in the browser too.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","email":"dave@test.local","role":"authenticated"}';
do $$ begin
  perform public.key_submit_tasks('p_t1', '[{"problem":"stale","title":"Mine now"}]', 'Key');
  raise exception 'FAIL: a member who doesn''t own the app added key tasks';
exception when insufficient_privilege then null;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';
-- The agent's card and handover: a browser copy older than them leaves them be; checking the draft goes through.
reset role;
update public.projects set data = data
  || '{"appCard":{"what":"Agent draft","who":"Ops","stage":"live","status":"ok","updatedAt":"2026-10-05T12:00:00Z","source":"ai","checkedAt":null,"checkedBy":null,"draftedBy":{"client":"Claude","clientId":"c","memberId":"m","at":"2026-10-05T12:00:00Z"}}}'::jsonb
  || '{"handover":{"doc":{"summary":"Agent pack"},"draftedBy":{"client":"Claude","clientId":"c","memberId":"m","at":"2026-10-05T12:00:00Z"},"checkedAt":null}}'::jsonb
  where id = 'p_t1';
set local role authenticated;
update public.projects set data = (data - 'handover')
  || '{"appCard":{"what":"Old browser copy","who":"x","stage":"live","status":"x","updatedAt":"2026-10-01T00:00:00Z","source":"fallback"}}'::jsonb
  where id = 'p_t1';
do $$
declare d jsonb := (select data from public.projects where id = 'p_t1');
begin
  if d->'appCard'->>'what' is distinct from 'Agent draft' then raise exception 'FAIL: a stale browser save replaced the agent''s card: %', d->'appCard'; end if;
  if d->'handover'->'doc'->>'summary' is distinct from 'Agent pack' then raise exception 'FAIL: a stale browser save dropped the agent''s handover'; end if;
end $$;
update public.projects set data = jsonb_set(jsonb_set(data, '{appCard,checkedAt}', '"2026-10-06T00:00:00Z"'), '{handover,checkedAt}', '"2026-10-06T00:00:00Z"')
  where id = 'p_t1';
do $$
declare d jsonb := (select data from public.projects where id = 'p_t1');
begin
  if d->'appCard'->>'checkedAt' is distinct from '2026-10-06T00:00:00Z' or d->'handover'->>'checkedAt' is distinct from '2026-10-06T00:00:00Z' then
    raise exception 'FAIL: checking the agent''s card or handover in the browser did not save: %', d;
  end if;
end $$;
-- A browser that has seen the agent's draft (its _base is the row's updated_at) may replace it; _base is never stored,
-- and every browser write is stamped with the database's time.
update public.projects set data = data || jsonb_build_object('_base', updated_at)
  || '{"appCard":{"what":"Written by hand","who":"Ops","stage":"live","status":"ok","updatedAt":"2001-01-01T00:00:00Z","source":"fallback"}}'::jsonb
  where id = 'p_t1';
do $$
declare d jsonb := (select data from public.projects where id = 'p_t1');
begin
  if d->'appCard'->>'what' is distinct from 'Written by hand' then raise exception 'FAIL: a browser up to date could not replace the agent''s card: %', d->'appCard'; end if;
  if d ? '_base' then raise exception 'FAIL: _base was stored'; end if;
  if (select updated_at from public.projects where id = 'p_t1') <> now() then raise exception 'FAIL: a browser write was not stamped with the database''s time'; end if;
end $$;
-- 0019: a browser can't write an AI app's name. A card it saves with a new draftedBy keeps its text but loses the
-- name; a handover it changes (beyond checking it) stays as stored; it may remove a handover.
update public.projects set data = data || jsonb_build_object('_base', updated_at)
  || '{"appCard":{"what":"Says Claude wrote it","who":"x","stage":"live","status":"x","updatedAt":"2001-01-01T00:00:00Z","source":"ai","checkedAt":null,"draftedBy":{"client":"Claude Code","clientId":"forged","memberId":"m","at":"2030-01-01T00:00:00Z"}}}'::jsonb
  || '{"handover":{"doc":{"summary":"Forged pack"},"draftedBy":{"client":"Claude","clientId":"forged","memberId":"m","at":"2030-01-01T00:00:00Z"},"checkedAt":null}}'::jsonb
  where id = 'p_t1';
do $$
declare d jsonb := (select data from public.projects where id = 'p_t1');
begin
  if d->'appCard'->>'what' is distinct from 'Says Claude wrote it' then raise exception 'FAIL: a person''s own card text was not saved'; end if;
  if d->'appCard' ? 'draftedBy' then raise exception 'FAIL: a browser put an AI app''s name on a card: %', d->'appCard'->'draftedBy'; end if;
  if d->'handover'->'doc'->>'summary' is distinct from 'Agent pack' then raise exception 'FAIL: a browser rewrote the agent''s handover: %', d->'handover'; end if;
end $$;
update public.projects set data = data || jsonb_build_object('_base', updated_at) || jsonb_build_object('handover',
  jsonb_set(data->'handover', '{checkedAt}', '"2026-10-07T00:00:00Z"')) where id = 'p_t1';
update public.projects set data = (data - 'handover') || jsonb_build_object('_base', updated_at) where id = 'p_t1';
do $$
declare d jsonb := (select data from public.projects where id = 'p_t1');
begin
  if d ? 'handover' then raise exception 'FAIL: a browser could not remove a handover'; end if;
end $$;
update public.projects set data = data || jsonb_build_object('_base', updated_at)
  || '{"handover":{"doc":{"summary":"Forged pack"},"draftedBy":{"client":"Claude","clientId":"forged","memberId":"m","at":"2030-01-01T00:00:00Z"},"checkedAt":"2026-10-07T00:00:00Z"}}'::jsonb
  where id = 'p_t1';
do $$
begin
  if (select data from public.projects where id = 'p_t1') ? 'handover' then raise exception 'FAIL: a browser wrote a handover where there was none'; end if;
end $$;
-- A browser insert (a new app, or Undo after deleting one) is stored as sent, minus _base.
insert into public.projects (id, workspace_id, data)
values ('p_forge', current_setting('t.ws')::uuid, '{"name":"Back","_base":"2001-01-01T00:00:00Z","tasksAt":"2026-10-01T00:00:00Z","tasks":[{"id":"x","problem":"stale","title":"Kept"}]}');
do $$ begin
  if (select data ? '_base' or jsonb_array_length(data->'tasks') <> 1 from public.projects where id = 'p_forge') then
    raise exception 'FAIL: a browser insert lost its tasks or stored _base';
  end if;
end $$;
reset role;
do $$ begin
  perform set_config('t.ntasks', (select jsonb_array_length(data->'tasks')::text from public.projects where id = 'p_t1'), true);
end $$;
set local role authenticated;

-- Dave through an agent: may read apps, may not edit an app he doesn't own.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000e1","email":"dave@test.local","role":"authenticated","client_id":"test-client","session_id":"00000000-0000-0000-0000-00000000d5e1"}';
do $$ begin
  if public.mcp_list_apps()::text not like '%p_t1%' then raise exception 'FAIL: a member could not list the workspace''s apps'; end if;
  begin
    perform public.mcp_submit_card('p_t1', '{"what":"Mine now","who":"Dave","stage":"live","status":"x"}', null);
    raise exception 'FAIL: a member who doesn''t own the app wrote its card';
  exception when insufficient_privilege then null;
  end;
  -- 0018: the same member is refused tasks too, and reads the app's tasks through the narrow read function (the 10 fixed ones).
  begin
    perform public.mcp_submit_tasks('p_t1', '[{"problem":"no-readme","title":"Mine now"}]', null);
    raise exception 'FAIL: a member who doesn''t own the app added tasks';
  exception when insufficient_privilege then null;
  end;
  if jsonb_array_length(public.mcp_get_app('p_t1')->'app'->'tasks')::text is distinct from current_setting('t.ntasks') then
    raise exception 'FAIL: a refused task list changed the app, or mcp_get_app left out its tasks';
  end if;
end $$;

-- 0021 heartbeats removed. The heartbeat path is gone: no keys or setup-code tables, none of their functions, no stored
-- heartbeat rows, and the MCP guard no longer lets an agent report activity.
reset role;
do $$
declare f text;
begin
  if to_regclass('public.ingest_keys') is not null then raise exception 'FAIL: the ingest_keys table is still there'; end if;
  if to_regclass('public.agent_setup_codes') is not null then raise exception 'FAIL: the agent_setup_codes table is still there'; end if;
  if to_regclass('public.activity_heartbeat_ws_at_idx') is not null then raise exception 'FAIL: the heartbeat index is still there'; end if;
  if exists (select 1 from pg_trigger where tgname = 'members_revoke_keys_on_removal') then
    raise exception 'FAIL: the key-revoking trigger on members is still there';
  end if;
  foreach f in array array['public.ingest_heartbeat(text,jsonb)', 'public.create_ingest_key(uuid)', 'public.guard_ingest_key_revoke()',
                           'public.revoke_keys_of_removed_member()', 'public.create_agent_setup_code(uuid)', 'public.redeem_agent_setup_code(text)',
                           'public.mcp_report_activity(text,text,text,text,text)'] loop
    if to_regprocedure(f) is not null then raise exception 'FAIL: % is still there', f; end if;
  end loop;
  if exists (select 1 from public.activity where data->>'kind' = 'heartbeat') then raise exception 'FAIL: heartbeat rows are still stored'; end if;
end $$;
-- An agent's report_activity call is refused by the guard (PT403); its other writes still pass.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated","client_id":"test-client","session_id":"00000000-0000-0000-0000-00000000a5e1"}';
do $$ begin
  perform set_config('request.method', 'POST', true);
  perform set_config('request.path', '/rpc/mcp_report_activity', true);
  begin
    perform public.mcp_request_guard();
    raise exception 'FAIL: the guard let an agent call mcp_report_activity';
  exception when sqlstate 'PT403' then null;
  end;
  perform set_config('request.path', '/rpc/mcp_submit_tasks', true);
  perform public.mcp_request_guard();
end $$;
reset role;

-- 0022 push updates. Tempo's server (the only holder of the server key) saves repo facts after a push, only into
-- workspaces linked to the installation that sent it. Fresh users: Erin owns "Push Co", Finn is a plain member there.
reset role;
insert into public.server_keys (name, key_hash)
values ('github', encode(extensions.digest('rls-test-server-key-0123456789abcdef', 'sha256'), 'hex'))
on conflict (name) do update set key_hash = excluded.key_hash;
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role)
values ('00000000-0000-0000-0000-0000000022e1', 'erin@test.local', '{"full_name":"Erin"}', '{"provider":"github"}', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-0000000022f1', 'finn@test.local', '{"full_name":"Finn"}', '{"provider":"github"}', 'authenticated', 'authenticated');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000022e1","email":"erin@test.local","role":"authenticated"}';
insert into t_ctx values ('push_ws', public.create_workspace('Push Co', null)::text);
insert into public.projects (id, workspace_id, data)
select 'p_push', v::uuid, '{"name":"Pusher","repo":{"fullName":"pushco/pusher","url":"https://github.com/pushco/pusher","private":true,"defaultBranch":"main"}}'
from t_ctx where k = 'push_ws';
reset role;
insert into public.members (id, workspace_id, user_id, name)
select 'm_finn', v::uuid, '00000000-0000-0000-0000-0000000022f1', 'Finn' from t_ctx where k = 'push_ws';

-- Nobody without the key: anon and members can't call the server functions or read the key table.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare skey text := 'rls-test-server-key-0123456789abcdef';
begin
  begin
    perform public.github_save_facts('wrong-key-0123456789abcdef0123456789', 111, '{"id":9001,"fullName":"pushco/pusher"}', null, now());
    raise exception 'FAIL: github_save_facts accepted a wrong key';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.github_save_facts('short', 111, '{"id":9001,"fullName":"pushco/pusher"}', null, now());
    raise exception 'FAIL: github_save_facts accepted a short key';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.github_due_repos('wrong-key-0123456789abcdef0123456789', 10);
    raise exception 'FAIL: github_due_repos accepted a wrong key';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.github_unlink_installation('wrong-key-0123456789abcdef0123456789', 111);
    raise exception 'FAIL: github_unlink_installation accepted a wrong key';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.server_keys;
    raise exception 'FAIL: anon can read server_keys';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.workspace_installations;
    raise exception 'FAIL: anon can read workspace_installations';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.github_link_installations(skey, (select v::uuid from t_ctx where k = 'push_ws'), '[{"id":111,"login":"pushco"}]');
    raise exception 'FAIL: anon could link an installation';
  exception when insufficient_privilege or invalid_authorization_specification then null;
  end;
  -- A delivery id counts once.
  if not public.github_record_delivery(skey, 'd-0022-1') then raise exception 'FAIL: a new delivery was not recorded'; end if;
  if public.github_record_delivery(skey, 'd-0022-1') then raise exception 'FAIL: a repeated delivery was treated as new'; end if;
  -- Nothing is linked yet, so a push changes nothing.
  if public.github_save_facts(skey, 111, '{"id":9001,"fullName":"pushco/pusher"}', null, now()) <> 0 then
    raise exception 'FAIL: facts landed in a workspace that is not linked';
  end if;
end $$;

-- Linking: only a manager, only with the server key, only installations whose account owns the workspace's repos.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000022f1","email":"finn@test.local","role":"authenticated"}';
do $$ begin
  perform public.github_link_installations('rls-test-server-key-0123456789abcdef', (select v::uuid from t_ctx where k = 'push_ws'), '[{"id":111,"login":"pushco"}]');
  raise exception 'FAIL: a plain member linked an installation';
exception when insufficient_privilege then null;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000022e1","email":"erin@test.local","role":"authenticated"}';
do $$
declare ws uuid := (select v::uuid from t_ctx where k = 'push_ws'); r jsonb;
begin
  begin
    perform public.github_link_installations('wrong-key-0123456789abcdef0123456789', ws, '[{"id":111,"login":"pushco"}]');
    raise exception 'FAIL: linking worked without the server key';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.github_link_installations('rls-test-server-key-0123456789abcdef', (select v::uuid from t_ctx where k = 'other_ws'), '[{"id":111,"login":"other"}]');
    raise exception 'FAIL: linked an installation to a workspace the caller does not manage';
  exception when insufficient_privilege then null;
  end;
  r := public.github_link_installations('rls-test-server-key-0123456789abcdef', ws,
         '[{"id":111,"login":"PushCo"},{"id":222,"login":"someone-else"},{"id":"333","login":"pushco"},{"id":0,"login":"pushco"}]');
  if jsonb_array_length(r) <> 1 or (r->0->>'installationId')::bigint <> 111 then
    raise exception 'FAIL: linking took the wrong installations: %', r;
  end if;
  if (select count(*) from public.workspace_installations where workspace_id = ws) <> 1 then
    raise exception 'FAIL: the owner can''t read the workspace''s links';
  end if;
  begin
    insert into public.workspace_installations (workspace_id, installation_id, account_login) values (ws, 444, 'pushco');
    raise exception 'FAIL: a browser inserted a link directly';
  exception when insufficient_privilege then null;
  end;
end $$;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c","email":"carol@test.local","role":"authenticated"}';
do $$ begin
  if exists (select 1 from public.workspace_installations where workspace_id = (select v::uuid from t_ctx where k = 'push_ws')) then
    raise exception 'FAIL: cross-tenant link read';
  end if;
end $$;

-- Saving facts: only allowed fields, cleaned, never into another workspace, never a future time.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare skey text := 'rls-test-server-key-0123456789abcdef'; d jsonb;
begin
  if public.github_save_facts(skey, 111, '{"id":9001,"fullName":"pushco/pusher","private":false,"defaultBranch":"trunk"}',
       '{"hasReadme":true,"secretFiles":[".env","config/key.pem"],"lastCommitAt":"2026-10-06T10:00:00Z","openIssues":3,"openPrs":1,"liveUrl":"javascript:alert(1)","name":"hijacked","extra":"x"}',
       now() - interval '1 minute') <> 1 then
    raise exception 'FAIL: a push to a linked repo saved nothing';
  end if;
  if public.github_save_facts(skey, 222, '{"id":9001,"fullName":"pushco/pusher"}', '{"hasReadme":false}', now()) <> 0 then
    raise exception 'FAIL: an installation that is not linked wrote facts';
  end if;
  if public.github_save_facts(skey, 111, '{"id":9002,"fullName":"other/app"}', '{"hasReadme":false}', now()) <> 0 then
    raise exception 'FAIL: a linked installation wrote into another workspace''s app';
  end if;
  begin
    perform public.github_save_facts(skey, 111, '{"id":9001,"fullName":"../etc"}', null, now());
    raise exception 'FAIL: a bad repo name was accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.github_save_facts(skey, 111, '{"id":9001,"fullName":"pushco/pusher"}', null, now() + interval '1 day');
end $$;
reset role;
do $$
declare d jsonb := (select data from public.projects where id = 'p_push');
begin
  if d->>'name' <> 'Pusher' then raise exception 'FAIL: save_facts changed the app name'; end if;
  if (d->'repo'->>'id')::bigint <> 9001 or (d->'repo'->>'defaultBranch') <> 'trunk' or (d->'repo'->>'private')::boolean then
    raise exception 'FAIL: repo id, branch or visibility not saved: %', d->'repo';
  end if;
  if d->'signals'->'secretFiles' <> '[".env","config/key.pem"]'::jsonb or (d->'signals'->>'openIssues')::int <> 3 then
    raise exception 'FAIL: signals not saved: %', d->'signals';
  end if;
  if d->'signals' ? 'name' or d->'signals' ? 'extra' or d->'signals'->>'liveUrl' is not null then
    raise exception 'FAIL: signals kept unknown fields or a non-web link: %', d->'signals';
  end if;
  if public.mcp_ts(d->'signals'->>'syncedAt') is distinct from date_trunc('milliseconds', now()) then
    raise exception 'FAIL: syncedAt is not the server clock: %', d->'signals'->>'syncedAt';
  end if;
  if public.mcp_ts(d->>'lastActivityAt') > now() or public.mcp_ts(d->>'lastActivityAt') < now() - interval '2 minutes' then
    raise exception 'FAIL: lastActivityAt wrong (a future push must not move it): %', d->>'lastActivityAt';
  end if;
  if (select data->>'name' from public.projects where id = 'p_other') <> 'Other app' or (select data ? 'signals' from public.projects where id = 'p_other') then
    raise exception 'FAIL: another workspace''s app changed';
  end if;
end $$;

-- A browser holding an older copy can't wipe newer facts; a browser's clock can't stamp facts in the future.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000022e1","email":"erin@test.local","role":"authenticated"}';
update public.projects set data = '{"name":"Pusher (renamed)","repo":{"fullName":"pushco/pusher"},"signals":{"hasReadme":false,"secretFiles":[],"syncedAt":"2026-01-01T00:00:00.000Z"},"lastActivityAt":"2026-01-01T00:00:00.000Z"}'
where id = 'p_push';
reset role;
do $$
declare d jsonb := (select data from public.projects where id = 'p_push');
begin
  if d->>'name' <> 'Pusher (renamed)' then raise exception 'FAIL: the browser''s own edit was lost'; end if;
  if d->'signals'->'secretFiles' <> '[".env","config/key.pem"]'::jsonb then raise exception 'FAIL: an older browser copy wiped newer facts'; end if;
  if public.mcp_ts(d->>'lastActivityAt') < now() - interval '2 minutes' then raise exception 'FAIL: an older browser copy moved lastActivityAt back'; end if;
  if (d->'repo'->>'id')::bigint is distinct from 9001 then raise exception 'FAIL: the repo id was dropped by a browser save'; end if;
end $$;
set local role authenticated;
update public.projects set data = data || '{"signals":{"hasReadme":true,"secretFiles":[],"syncedAt":"2099-01-01T00:00:00.000Z"}}' where id = 'p_push';
reset role;
do $$ begin
  if public.mcp_ts((select data->'signals'->>'syncedAt' from public.projects where id = 'p_push')) > now() then
    raise exception 'FAIL: a browser stamped facts in the future';
  end if;
end $$;

-- Rename, the daily check and unlinking.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare skey text := 'rls-test-server-key-0123456789abcdef'; n int;
begin
  if public.github_save_facts(skey, 111, '{"id":9001,"fullName":"pushco/pusher-two"}', null, null, 'pushco/pusher') <> 1 then
    raise exception 'FAIL: a renamed repo lost its app';
  end if;
  select count(*) into n from public.github_due_repos(skey, 10) where full_name = 'pushco/pusher-two';
  if n <> 0 then raise exception 'FAIL: a repo synced just now is due'; end if;
end $$;
reset role;
update public.projects set data = jsonb_set(data, '{signals,syncedAt}', '"2026-01-01T00:00:00.000Z"') where id = 'p_push';
set local role anon;
do $$
declare skey text := 'rls-test-server-key-0123456789abcdef'; n int;
begin
  select count(*) into n from public.github_due_repos(skey, 10) where full_name = 'pushco/pusher-two' and installation_id = 111;
  if n <> 1 then raise exception 'FAIL: a repo synced long ago is not due'; end if;
  if public.github_unlink_installation(skey, 111) <> 1 then raise exception 'FAIL: unlinking removed nothing'; end if;
  if public.github_save_facts(skey, 111, '{"id":9001,"fullName":"pushco/pusher-two"}', '{"hasReadme":false}', now()) <> 0 then
    raise exception 'FAIL: an unlinked installation still writes facts';
  end if;
end $$;
reset role;

-- 0023 sign-ins end: at most 30 days after sign-in, and 14 days after the last refresh. Auth refuses a refresh once
-- not_after has passed, so these check the not_after the trigger writes.
do $$
declare
  erin uuid := '00000000-0000-0000-0000-0000000022e1';
  s_new uuid := '00000000-0000-0000-0000-000000023a01';
  s_old uuid := '00000000-0000-0000-0000-000000023a02';
  s_cut uuid := '00000000-0000-0000-0000-000000023a03';
  s_mid uuid := '00000000-0000-0000-0000-000000023a04';
  ends timestamptz;
  near interval := interval '1 minute';
begin
  insert into auth.sessions (id, user_id) values (s_new, erin);
  select not_after into ends from auth.sessions where id = s_new;
  if ends is null or abs(extract(epoch from ends - (now() + interval '14 days'))) > 60 then
    raise exception 'FAIL: a new sign-in does not end 14 days from now (%)', ends;
  end if;

  insert into auth.sessions (id, user_id, created_at) values (s_old, erin, now() - interval '20 days');
  select not_after into ends from auth.sessions where id = s_old;
  if abs(extract(epoch from ends - (now() + interval '10 days'))) > 60 then
    raise exception 'FAIL: a 20-day-old sign-in does not end 30 days after sign-in (%)', ends;
  end if;

  insert into auth.sessions (id, user_id, not_after) values (s_cut, erin, now() + interval '1 day');
  select not_after into ends from auth.sessions where id = s_cut;
  if ends > now() + interval '1 day' + near then raise exception 'FAIL: an earlier end given by Auth was moved later'; end if;

  -- A refresh (Auth writes refreshed_at) moves the end to 14 days from now, but never past 30 days after sign-in.
  insert into auth.sessions (id, user_id, created_at) values (s_mid, erin, now() - interval '5 days');
  update auth.sessions set not_after = now() + interval '1 hour' where id = s_mid;
  update auth.sessions set refreshed_at = (now() at time zone 'UTC'), user_agent = 'test' where id = s_mid;
  select not_after into ends from auth.sessions where id = s_mid;
  if abs(extract(epoch from ends - (now() + interval '14 days'))) > 60 then
    raise exception 'FAIL: a refresh did not move the end to 14 days from now (%)', ends;
  end if;
  update auth.sessions set refreshed_at = (now() at time zone 'UTC') where id = s_old;
  select not_after into ends from auth.sessions where id = s_old;
  if abs(extract(epoch from ends - (now() + interval '10 days'))) > 60 then
    raise exception 'FAIL: a refresh moved the end past 30 days after sign-in (%)', ends;
  end if;

  -- Writes that aren't a refresh leave the end alone.
  update auth.sessions set not_after = now() + interval '2 hours' where id = s_mid;
  update auth.sessions set user_agent = 'other', aal = 'aal1' where id = s_mid;
  select not_after into ends from auth.sessions where id = s_mid;
  if ends > now() + interval '2 hours' + near then raise exception 'FAIL: a write that is not a refresh moved the end'; end if;

  if has_function_privilege('anon', 'public.session_limits()', 'execute')
     or has_function_privilege('authenticated', 'public.session_limits()', 'execute') then
    raise exception 'FAIL: the browser roles may run session_limits()';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.sessions'::regclass and tgname = 'session_limits' and tgenabled = 'O') then
    raise exception 'FAIL: the session_limits trigger is missing or disabled';
  end if;
  if exists (select 1 from auth.sessions where not_after is null) then
    raise exception 'FAIL: a session has no end';
  end if;
end $$;

do $$ begin
  raise notice 'RLS: all checks passed';
end $$;

rollback;
