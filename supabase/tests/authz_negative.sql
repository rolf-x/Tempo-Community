begin;

-- Fixture setup from rls.sql
insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data, aud, role)
values ('00000000-0000-0000-0000-00000000000a', 'alice@test.local', '{"full_name":"Alice"}', '{"provider":"google"}', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000000b', 'bob@test.local', '{"full_name":"Bob","user_name":"bobgh"}', '{"provider":"github"}', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-00000000000c', 'carol@test.local', '{"full_name":"Carol","user_name":"carolgh"}', '{"provider":"github"}', 'authenticated', 'authenticated'),
       ('00000000-0000-0000-0000-0000000000e1', 'dave@test.local', '{"full_name":"Dave"}', '{"provider":"github"}', 'authenticated', 'authenticated');

insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at)
values (gen_random_uuid(), '9000001', '00000000-0000-0000-0000-00000000000c', '{"sub":"9000001","user_name":"carolgh","email":"carol@test.local"}', 'github', now());

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

-- Bob and Dave join Alice's workspace
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated"}';
select public.accept_invite((select v from t_ctx where k = 'token'));

reset role;
insert into public.members (id, workspace_id, user_id, name, email, role)
select 'm_dave', v::uuid, '00000000-0000-0000-0000-0000000000e1', 'Dave', 'dave@test.local', 'member' from t_ctx where k = 'ws';
insert into auth.sessions (id, user_id) values
  ('00000000-0000-0000-0000-00000000a5e1', '00000000-0000-0000-0000-00000000000a'),
  ('00000000-0000-0000-0000-00000000b5e1', '00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000d5e1', '00000000-0000-0000-0000-0000000000e1');
set local role authenticated;

-- Bob operates as Bob
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated"}';

-- 1. Cross-workspace: a member selecting an app of another workspace via table
do $$
declare n int;
begin
  select count(*) into n from public.projects where workspace_id = (select v::uuid from t_ctx where k = 'other_ws');
  if n <> 0 then raise exception 'NOT REFUSED: 1. Cross-workspace table select'; end if;
end $$;

-- 2. Cross-workspace: a member updating an app of another workspace via table
do $$
declare n int;
begin
  update public.projects set data = data || '{"name":"hacked"}' where id = 'p_other';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'NOT REFUSED: 2. Cross-workspace table update'; end if;
end $$;

-- 3. Cross-workspace: a member deleting an app of another workspace via table
do $$
declare n int;
begin
  delete from public.projects where id = 'p_other';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'NOT REFUSED: 3. Cross-workspace table delete'; end if;
end $$;

-- 4. Cross-workspace: a member adding tasks to an app of another workspace via table
do $$
begin
  begin
    insert into public.tasks (id, workspace_id, data) select 't_cross', v::uuid, '{"title":"hacked","projectId":"p_other"}' from t_ctx where k = 'other_ws';
    raise exception 'NOT REFUSED: 4. Cross-workspace table insert task';
  exception when insufficient_privilege or check_violation then null;
  end;
end $$;

-- 5. Cross-workspace: key_submit_tasks
do $$
begin
  begin
    perform public.key_submit_tasks('p_other', '[{"problem":"no-owner","title":"x"}]');
    raise exception 'NOT REFUSED: 5. Cross-workspace key_submit_tasks';
  exception when no_data_found or sqlstate 'P0002' then null;
  end;
end $$;

-- Bob operates as an agent
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated","client_id":"c","session_id":"00000000-0000-0000-0000-00000000b5e1"}';

-- 6. Cross-workspace: mcp_get_app
do $$
begin
  begin
    perform public.mcp_get_app('p_other');
    raise exception 'NOT REFUSED: 6. Cross-workspace mcp_get_app';
  exception when no_data_found or sqlstate 'P0002' then null;
  end;
end $$;

-- 7. Cross-workspace: mcp_submit_card
do $$
begin
  begin
    perform public.mcp_submit_card('p_other', '{"what":"x","who":"y","stage":"idea","status":"z"}', 'c');
    raise exception 'NOT REFUSED: 7. Cross-workspace mcp_submit_card';
  exception when no_data_found or sqlstate 'P0002' then null;
  end;
end $$;

-- 8. Cross-workspace: mcp_submit_handover
do $$
begin
  begin
    perform public.mcp_submit_handover('p_other', '{"summary":"x","howToRun":[],"whereThingsAre":[],"openWork":[],"risks":[],"contacts":[],"unknowns":[]}', 'c');
    raise exception 'NOT REFUSED: 8. Cross-workspace mcp_submit_handover';
  exception when no_data_found or sqlstate 'P0002' then null;
  end;
end $$;

-- 9. Cross-workspace: mcp_submit_tasks
do $$
begin
  begin
    perform public.mcp_submit_tasks('p_other', '[{"problem":"no-owner","title":"x"}]', 'c');
    raise exception 'NOT REFUSED: 9. Cross-workspace mcp_submit_tasks';
  exception when no_data_found or sqlstate 'P0002' then null;
  end;
end $$;

-- Bob operates as Bob again
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated"}';

-- 10. Role rules: plain member changing app card/tasks/handover/ownerId/archived via table
do $$
declare n int;
begin
  update public.projects set data = jsonb_set(data, '{ownerId}', '"m_dave"') where id = 'p_t1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'NOT REFUSED: 10. Role rules app table update'; end if;
end $$;

-- 11. Role rules: plain member calling key_submit_tasks
do $$
begin
  begin
    perform public.key_submit_tasks('p_t1', '[{"problem":"no-owner","title":"x"}]');
    raise exception 'NOT REFUSED: 11. Role rules key_submit_tasks';
  exception when insufficient_privilege or sqlstate '42501' then null;
  end;
end $$;

-- Bob operates as an agent again
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000b","email":"bob@test.local","role":"authenticated","client_id":"c","session_id":"00000000-0000-0000-0000-00000000b5e1"}';

-- 12. Role rules: plain member calling mcp_submit_card
do $$
begin
  begin
    perform public.mcp_submit_card('p_t1', '{"what":"x","who":"y","stage":"idea","status":"z"}', 'c');
    raise exception 'NOT REFUSED: 12. Role rules mcp_submit_card';
  exception when insufficient_privilege or sqlstate '42501' then null;
  end;
end $$;

-- 13. Role rules: plain member calling mcp_submit_handover
do $$
begin
  begin
    perform public.mcp_submit_handover('p_t1', '{"summary":"x","howToRun":[],"whereThingsAre":[],"openWork":[],"risks":[],"contacts":[],"unknowns":[]}', 'c');
    raise exception 'NOT REFUSED: 13. Role rules mcp_submit_handover';
  exception when insufficient_privilege or sqlstate '42501' then null;
  end;
end $$;

-- 14. Role rules: plain member calling mcp_submit_tasks
do $$
begin
  begin
    perform public.mcp_submit_tasks('p_t1', '[{"problem":"no-owner","title":"x"}]', 'c');
    raise exception 'NOT REFUSED: 14. Role rules mcp_submit_tasks';
  exception when insufficient_privilege or sqlstate '42501' then null;
  end;
end $$;

-- Alice operates as an agent
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated","client_id":"c","session_id":"00000000-0000-0000-0000-00000000a5e1"}';

-- 15. AI-app token: direct table writes
do $$
declare n int;
begin
  update public.projects set data = data || '{"name":"hacked"}' where id = 'p_t1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'NOT REFUSED: 15. AI-app token direct table write'; end if;
end $$;

-- 16. AI-app token: key_submit_tasks
do $$
begin
  begin
    perform public.key_submit_tasks('p_t1', '[{"problem":"no-owner","title":"x"}]');
    raise exception 'NOT REFUSED: 16. AI-app token key_submit_tasks';
  exception when insufficient_privilege or sqlstate '42501' then null;
  end;
end $$;

-- 17. AI-app token: function not on the guard's list
do $$
begin
  perform set_config('request.method', 'GET', true);
  perform set_config('request.path', '/projects', true);
  begin
    perform public.mcp_request_guard();
    raise exception 'NOT REFUSED: 17. AI-app token unlisted guard function';
  exception when sqlstate 'PT403' then null;
  end;
end $$;

-- Alice operates as an agent with a dead session
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated","client_id":"c","session_id":"00000000-0000-0000-0000-00000000dead"}';

-- 18. AI-app token: a session_id with no live session
do $$
begin
  perform set_config('request.method', 'POST', true);
  perform set_config('request.path', '/rpc/mcp_list_apps', true);
  begin
    perform public.mcp_request_guard();
    raise exception 'NOT REFUSED: 18. AI-app token dead session_id';
  exception when sqlstate 'PT401' then null;
  end;
end $$;

-- Alice operates as an agent (valid session) to seed data for browser tests
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated","client_id":"c","session_id":"00000000-0000-0000-0000-00000000a5e1"}';
do $$
begin
  perform public.mcp_submit_card('p_t1', '{"what":"A bot","who":"Ops","stage":"building","status":"Working on it"}', 'Claude Code');
  perform public.mcp_submit_tasks('p_t1', '[{"problem":"no-owner","title":"Agent task"}]', 'Claude Code');
end $$;

-- Alice operates as Alice (browser session)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';

-- 19. Browser session: setting appCard.draftedBy directly
do $$
declare new_data jsonb;
begin
  update public.projects set data = jsonb_set(data, '{appCard, draftedBy}', '{"client":"Browser"}') where id = 'p_t1' returning data into new_data;
  if new_data->'appCard'->'draftedBy'->>'client' = 'Browser' then
    raise exception 'NOT REFUSED: 19. Browser session setting appCard.draftedBy';
  end if;
end $$;

-- 20. Browser session: setting tasks with draftedBy.clientId
do $$
declare new_data jsonb;
begin
  update public.projects set data = jsonb_set(data, '{tasks}', '[{"id":"new-id","problem":"secrets","title":"x","draftedBy":{"clientId":"fake"}}]') where id = 'p_t1' returning data into new_data;
  if (new_data->'tasks'->0->'draftedBy'->>'clientId') = 'fake' then
    raise exception 'NOT REFUSED: 20. Browser session setting tasks with draftedBy.clientId';
  end if;
end $$;

-- 21. Browser session: re-adding a removed task
do $$
declare new_data jsonb;
        t_id text;
begin
  t_id := (select data->'tasks'->0->>'id' from public.projects where id = 'p_t1');
  update public.projects set data = jsonb_set(data, '{tasks}', 
    jsonb_build_array(jsonb_build_object('id', t_id, 'removedAt', to_jsonb(now())))) where id = 'p_t1';
  update public.projects set data = jsonb_set(data, '{tasks}', 
    jsonb_build_array(jsonb_build_object('id', t_id))) where id = 'p_t1' returning data into new_data;
  if not (new_data->'tasks'->0 ? 'removedAt') then
    raise exception 'NOT REFUSED: 21. Browser session re-adding a removed task';
  end if;
end $$;

-- 22. Browser session: rewording a task
do $$
declare new_data jsonb;
        t_id text;
begin
  t_id := (select data->'tasks'->0->>'id' from public.projects where id = 'p_t1');
  update public.projects set data = jsonb_set(data, '{tasks}', 
    jsonb_build_array(jsonb_build_object('id', t_id, 'title', 'Hacked title'))) where id = 'p_t1' returning data into new_data;
  if new_data->'tasks'->0->>'title' = 'Hacked title' then
    raise exception 'NOT REFUSED: 22. Browser session rewording a task';
  end if;
end $$;

-- 23. Browser session: clearing fixedAt
do $$
declare new_data jsonb;
        t_id text;
begin
  t_id := (select data->'tasks'->0->>'id' from public.projects where id = 'p_t1');
  update public.projects set data = jsonb_set(data, '{tasks}', 
    jsonb_build_array(jsonb_build_object('id', t_id, 'fixedAt', to_jsonb(now())))) where id = 'p_t1';
  update public.projects set data = jsonb_set(data, '{tasks}', 
    jsonb_build_array(jsonb_build_object('id', t_id))) where id = 'p_t1' returning data into new_data;
  if not (new_data->'tasks'->0 ? 'fixedAt') or jsonb_typeof(new_data->'tasks'->0->'fixedAt') <> 'string' then
    raise exception 'NOT REFUSED: 23. Browser session clearing fixedAt';
  end if;
end $$;

-- 24. Browser session: removing tasksAt
do $$
declare new_data jsonb;
begin
  update public.projects set data = data - 'tasksAt' where id = 'p_t1' returning data into new_data;
  if not (new_data ? 'tasksAt') then
    raise exception 'NOT REFUSED: 24. Browser session removing tasksAt';
  end if;
end $$;

-- 25. By design, not a refusal: the app's owner may always replace its card (by hand, or with her own key), so a
-- forged _base gains her nothing she can't already do. _base only stops an OLD copy from undoing a newer agent draft
-- by accident (rls.sql tests that). It is never stored.
do $$
declare new_data jsonb;
begin
  update public.projects set data = jsonb_set(data, '{_base}', to_jsonb((now() + interval '1 year')::text))
                                    || '{"appCard":{"what":"Replaced by the owner"}}'::jsonb
  where id = 'p_t1' returning data into new_data;
  if new_data ? '_base' then raise exception 'NOT REFUSED: 25. _base was stored'; end if;
end $$;

-- 26. Browser session: mcp_submit_tasks from a browser
do $$
begin
  begin
    perform public.mcp_submit_tasks('p_t1', '[{"problem":"no-owner","title":"x"}]', 'Browser');
    raise exception 'NOT REFUSED: 26. Browser session mcp_submit_tasks';
  exception when insufficient_privilege or sqlstate '42501' then null;
  end;
end $$;

-- 27. Input validation: key_submit_tasks unknown problem
do $$
begin
  begin
    perform public.key_submit_tasks('p_t1', '[{"problem":"unknown","title":"x"}]');
    raise exception 'NOT REFUSED: 27. Input validation unknown problem';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 28. Input validation: key_submit_tasks 11 items
do $$
begin
  begin
    perform public.key_submit_tasks('p_t1', '[{"problem":"no-owner","title":"1"},{"problem":"no-owner","title":"2"},{"problem":"no-owner","title":"3"},{"problem":"secrets","title":"4"},{"problem":"secrets","title":"5"},{"problem":"secrets","title":"6"},{"problem":"public-repo","title":"7"},{"problem":"public-repo","title":"8"},{"problem":"public-repo","title":"9"},{"problem":"stale","title":"10"},{"problem":"stale","title":"11"}]');
    raise exception 'NOT REFUSED: 28. Input validation 11 items';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 29. Input validation: key_submit_tasks 4 items per problem
do $$
begin
  begin
    perform public.key_submit_tasks('p_t1', '[{"problem":"no-owner","title":"1"},{"problem":"no-owner","title":"2"},{"problem":"no-owner","title":"3"},{"problem":"no-owner","title":"4"}]');
    raise exception 'NOT REFUSED: 29. Input validation 4 items per problem';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 30. Input validation: key_submit_tasks null p_tasks
do $$
begin
  begin
    perform public.key_submit_tasks('p_t1', null);
    raise exception 'NOT REFUSED: 30. Input validation null p_tasks';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 31. Input validation: key_submit_tasks wrong types
do $$
begin
  begin
    perform public.key_submit_tasks('p_t1', '{"problem":"no-owner","title":"x"}');
    raise exception 'NOT REFUSED: 31. Input validation wrong types';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- 32. Input validation: 300-char label must be cut to 60
do $$
declare long_label text := repeat('A', 300);
        new_data jsonb;
begin
  perform public.key_submit_tasks('p_t1', '[{"problem":"no-owner","title":"x"}]', long_label);
  new_data := (select data from public.projects where id = 'p_t1');
  if length(new_data->'tasks'->(jsonb_array_length(new_data->'tasks') - 1)->'draftedBy'->>'client') > 60 then
    raise exception 'NOT REFUSED: 32. Input validation 300-char label not cut';
  end if;
end $$;

-- 33. Input validation: links and zero-width/bidi characters in titles
do $$
declare raw_title text := 'Title \u202e with http://link.com \u200b!';
        new_data jsonb;
        stored text;
begin
  perform public.key_submit_tasks('p_t1', '[{"problem":"secrets","title":"Title \u202e with http://link.com \u200b!"}]'::jsonb);
  new_data := (select data from public.projects where id = 'p_t1');
  stored := new_data->'tasks'->(jsonb_array_length(new_data->'tasks') - 1)->>'title';
  if stored like '%http%' or stored like '%' || chr(8238) || '%' or stored like '%' || chr(8203) || '%' then
    raise exception 'NOT REFUSED: 33. Input validation links/bidi in titles not stripped';
  end if;
end $$;

-- Alice operates as an agent again
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated","client_id":"c","session_id":"00000000-0000-0000-0000-00000000a5e1"}';

-- 34. Input validation: mcp_submit_tasks null p_tasks
do $$
begin
  begin
    perform public.mcp_submit_tasks('p_t1', null, 'Claude Code');
    raise exception 'NOT REFUSED: 34. Input validation mcp_submit_tasks null p_tasks';
  exception when sqlstate '22023' then null;
  end;
end $$;

-- Alice operates as Alice (browser session)
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a","email":"alice@test.local","role":"authenticated"}';

-- 35. Internal helpers: tasks_check called as authenticated
do $$
begin
  begin
    perform public.tasks_check('[]');
    raise exception 'NOT REFUSED: 35. Internal helpers tasks_check as authenticated';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 36. Internal helpers: mcp_app_for_edit called as anon
do $$
begin
  set local role anon;
  begin
    perform public.mcp_app_for_edit('p_t1');
    raise exception 'NOT REFUSED: 36. Internal helpers mcp_app_for_edit as anon';
  exception when insufficient_privilege then null;
  end;
  set local role authenticated;
end $$;

-- 37. Internal helpers: mcp_task_text called as authenticated
do $$
begin
  begin
    perform public.mcp_task_text('x', 10);
    raise exception 'NOT REFUSED: 37. Internal helpers mcp_task_text as authenticated';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 38. Internal helpers: mcp_log called as authenticated
do $$
begin
  begin
    perform public.mcp_log(gen_random_uuid(), 'p_t1', 'm_1', 'client', 'title');
    raise exception 'NOT REFUSED: 38. Internal helpers mcp_log as authenticated';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 39. Internal helpers: mcp_drafted_by called as authenticated
do $$
begin
  begin
    perform public.mcp_drafted_by('m_1', 'client');
    raise exception 'NOT REFUSED: 39. Internal helpers mcp_drafted_by as authenticated';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 40. Internal helpers: anon calling write function
do $$
begin
  set local role anon;
  begin
    perform public.mcp_submit_card('p_t1', '{"what":"x","who":"y","stage":"idea","status":"z"}', 'c');
    raise exception 'NOT REFUSED: 40. Anon calling write function';
  exception when insufficient_privilege then null;
  end;
  set local role authenticated;
end $$;

do $$ begin
  raise notice 'AUTHZ: all 40 refusal cases passed';
end $$;

rollback;
