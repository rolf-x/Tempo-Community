-- MCP edge cases (0017). Run like rls.sql: on a database with
-- every migration applied, as postgres, in one transaction that is rolled back. Success = "MCP edge cases: all passed".
-- An expected refusal is any error that is not a 'FAIL: …' raised by the check itself. What an agent stored is read back
-- as postgres: an agent token sees no table rows, so reading as the agent would always find null.
begin;

insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role)
values ('00000000-0000-0000-0000-0000000000f1', 'erin@test.local', '{"full_name":"Erin"}', '{"provider":"github"}', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-0000000000f2', 'finn@test.local', '{"full_name":"Finn"}', '{"provider":"github"}', 'authenticated', 'authenticated');

create temp table t_ctx (k text primary key, v text) on commit drop;
grant all on t_ctx to authenticated, anon;

-- Erin owns "Erin Co" with two apps. Finn owns "Finn Co" with one app and is a plain member of Erin Co.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f1","email":"erin@test.local","role":"authenticated"}';
insert into t_ctx values ('erin_ws', public.create_workspace('Erin Co', null)::text);
insert into public.projects (id, workspace_id, data) select 'p_erin', v::uuid, '{"name":"Erin app","repo":{"fullName":"erin/app"}}' from t_ctx where k = 'erin_ws';
insert into public.projects (id, workspace_id, data) select 'p_erin2', v::uuid, '{"name":"Erin second"}' from t_ctx where k = 'erin_ws';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","email":"finn@test.local","role":"authenticated"}';
insert into t_ctx values ('finn_ws', public.create_workspace('Finn Co', null)::text);
insert into public.projects (id, workspace_id, data) select 'p_finn', v::uuid, '{"name":"Finn app"}' from t_ctx where k = 'finn_ws';
reset role;
insert into public.members (id, workspace_id, user_id, name, role)
select 'm_finn_in_erin', v::uuid, '00000000-0000-0000-0000-0000000000f2', 'Finn', 'member' from t_ctx where k = 'erin_ws';
insert into auth.sessions (id, user_id) values ('00000000-0000-0000-0000-00000000f5e2', '00000000-0000-0000-0000-0000000000f2');
set local role authenticated;

-- From here on Finn calls through an agent.
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-0000000000f2","email":"finn@test.local","role":"authenticated","client_id":"c1","session_id":"00000000-0000-0000-0000-00000000f5e2"}';

do $$ begin
  begin
    perform public.mcp_submit_card(null, null, null);
    raise exception 'FAIL: null arguments accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.mcp_submit_card('p_finn', '{"what":123,"who":"A","stage":"idea","status":"B"}', 'c1');
    raise exception 'FAIL: a number accepted as what';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.mcp_submit_card('p_finn', '"just a string"', 'c1');
    raise exception 'FAIL: a non-object card accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.mcp_submit_handover('p_finn', '{"summary":"s","howToRun":"npm run dev","whereThingsAre":[],"openWork":[],"risks":[],"contacts":[],"unknowns":[]}', 'c1');
    raise exception 'FAIL: a handover list given as a string accepted';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

-- Huge text is cut to the card limits, not stored whole (checked as postgres below).
select public.mcp_submit_card('p_finn', jsonb_build_object('what', repeat('w', 30000), 'who', repeat('u', 5000), 'stage', 'idea', 'status', repeat('s', 9000)), repeat('c', 500));
reset role;
do $$
declare card jsonb := (select data->'appCard' from public.projects where id = 'p_finn');
begin
  if card is null or length(card->>'what') is distinct from 240 or length(card->>'who') is distinct from 160
     or length(card->>'status') is distinct from 400 or length(card->'draftedBy'->>'client') > 60 then
    raise exception 'FAIL: huge text stored past the limits';
  end if;
end $$;
set local role authenticated;

-- Another workspace's app, and an app Finn doesn't own in a workspace where he is a plain member.
do $$ begin
  begin
    perform public.mcp_get_app('p_nope');
    raise exception 'FAIL: an unknown app id answered';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  if public.mcp_get_app('p_erin')->'app'->>'name' <> 'Erin app' then raise exception 'FAIL: a member could not read an app'; end if;
  begin
    perform public.mcp_submit_card('p_erin', '{"what":"w","who":"w","stage":"idea","status":"s"}', 'c1');
    raise exception 'FAIL: a plain member wrote the card of an app he does not own';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.mcp_submit_handover('p_erin', '{"summary":"s","howToRun":[],"whereThingsAre":[],"openWork":[],"risks":[],"contacts":[],"unknowns":[]}', 'c1');
    raise exception 'FAIL: a plain member wrote the handover of an app he does not own';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end $$;

-- Extra keys in p_card never reach the saved card.
select public.mcp_submit_card('p_finn', '{"what":"w","who":"w","stage":"idea","status":"s","checkedAt":"2020-01-01","checkedBy":"finn","source":"manual","draftedBy":{"client":"Tempo staff"},"evil":true}', 'c1');
reset role;
do $$
declare card jsonb := (select data->'appCard' from public.projects where id = 'p_finn');
begin
  if card is null or card->'checkedAt' is distinct from 'null'::jsonb or card->'checkedBy' is distinct from 'null'::jsonb
     or card->>'source' is distinct from 'ai' or card->'draftedBy'->>'client' is distinct from 'c1' or card ? 'evil' then
    raise exception 'FAIL: extra keys leaked into the card: %', card;
  end if;
end $$;

-- A member who left: Finn is made inactive in Erin Co (as postgres), then his agent can't read or write there.
update public.members set active = false where id = 'm_finn_in_erin';
set local role authenticated;
do $$ begin
  begin
    perform public.mcp_get_app('p_erin');
    raise exception 'FAIL: an inactive member read an app';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  begin
    perform public.mcp_submit_card('p_erin', '{"what":"w","who":"w","stage":"idea","status":"s"}', 'c1');
    raise exception 'FAIL: an inactive member wrote a card';
  exception when others then if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  if public.mcp_list_apps()::text like '%p_erin%' then raise exception 'FAIL: an inactive member still lists the workspace'; end if;
end $$;

-- The 31st agent write in a minute is refused with 54000, and only that: the two cards above already count, so
-- calls 1 to 28 must succeed and call 29 must be the refusal. Any other error fails the test.
do $$
declare ok int := 0;
begin
  for i in 1..31 loop
    begin
      perform public.mcp_submit_card('p_finn', '{"what":"w","who":"w","stage":"idea","status":"s"}', 'c1');
      ok := ok + 1;
    exception when sqlstate '54000' then exit;
    end;
  end loop;
  if ok <> 28 then raise exception 'FAIL: expected 28 more writes before the limit, got %', ok; end if;
end $$;

-- What the PostgREST guard alone stops: non-mcp functions and table reads by an agent token. This calls the guard
-- with the settings PostgREST would give it; scripts/mcp-guard-check.sh checks the real HTTP path on a real project.
do $$
declare p text;
begin
  perform set_config('request.method', 'POST', true);
  foreach p in array array['/rpc/set_member_admin', '/rpc/accept_invite', '/rpc/graphql', '/rpc/mcp_report_activity'] loop
    perform set_config('request.path', p, true);
    begin
      perform public.mcp_request_guard();
      raise exception 'FAIL: the guard let an agent call %', p;
    exception when sqlstate 'PT403' then null;
    end;
  end loop;
  perform set_config('request.method', 'GET', true);
  perform set_config('request.path', '/rpc/mcp_list_apps', true);
  begin
    perform public.mcp_request_guard();
    raise exception 'FAIL: the guard let an agent GET an rpc';
  exception when sqlstate 'PT403' then null;
  end;
  perform set_config('request.method', 'POST', true);
  perform set_config('request.path', '/rpc/mcp_submit_tasks', true);
  perform public.mcp_request_guard(); -- a live agent sign-in passes for the five mcp_* functions
  raise notice 'MCP edge cases: all passed';
end $$;

rollback;
