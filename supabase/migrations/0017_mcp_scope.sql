-- 0017 · MCP scope. An MCP client signs in through Supabase's OAuth 2.1 server and gets the user's own JWT plus a
-- `client_id` claim. That token could talk to the Data API directly, not only through /api/mcp, so the database narrows
-- it here: an agent token can call the five mcp_* functions and nothing else. It reads no table and writes no table.
-- Three layers: a pre-request guard on every Data API call, restrictive policies on every table (they also cover
-- Realtime), and narrow security-definer functions that return or write exactly what the MCP tools need.

-- ── 1. Who is an agent ──────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.is_agent() returns boolean
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id', '') <> ''
$$;
revoke all on function public.is_agent() from public;
grant execute on function public.is_agent() to anon, authenticated;

-- ── 2. Pre-request guard: default deny for agent tokens ───────────────────────────────────────────────────────────
-- PostgREST runs this before every Data API request. Browser sessions and anon have no client_id and pass straight
-- through. An agent token must still have a live sign-in: revoking a client deletes its sessions, so a JWT that has not
-- expired yet stops working at once (PT401 becomes HTTP 401). Then only the five mcp_* functions, by POST (PT403).
-- Security definer only to read auth.sessions.
create or replace function public.mcp_request_guard() returns void
language plpgsql stable security definer set search_path = public as $$
declare
  method text := coalesce(current_setting('request.method', true), '');
  path text := regexp_replace(coalesce(current_setting('request.path', true), ''), '^/?(rest/v1/)?', '/');
  sid text := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'session_id';
begin
  if not public.is_agent() then return; end if;
  if sid is null or sid !~ '^[0-9a-f-]{36}$'
     or not exists (select 1 from auth.sessions s where s.id = sid::uuid and (s.not_after is null or s.not_after > now())) then
    raise sqlstate 'PT401' using message = 'This connection was revoked or signed out. Sign in to Tempo again.';
  end if;
  if method = 'POST' and path in ('/rpc/mcp_list_apps', '/rpc/mcp_get_app', '/rpc/mcp_submit_card',
                                  '/rpc/mcp_submit_handover', '/rpc/mcp_report_activity') then
    return;
  end if;
  raise sqlstate 'PT403' using message = 'An MCP client can only read apps and write drafts.';
end $$;
revoke all on function public.mcp_request_guard() from public;
grant execute on function public.mcp_request_guard() to anon, authenticated;

alter role authenticator set pgrst.db_pre_request = 'public.mcp_request_guard';
notify pgrst, 'reload config';

-- ── 3. Restrictive policies: an agent token reads and writes no table directly ───────────────────────────────────
-- Defence in depth behind the guard: Realtime and any path that skips PostgREST still meet these. The mcp_*
-- functions below are security definer and owned by the table owner, so they are not affected.
do $$
declare t text;
begin
  foreach t in array array['projects', 'tasks', 'activity', 'members', 'workspaces', 'invites', 'ingest_keys', 'profiles'] loop
    execute format('drop policy if exists "agents use mcp functions only" on public.%I', t);
    execute format('create policy "agents use mcp functions only" on public.%I as restrictive for all '
                   'using (not public.is_agent()) with check (not public.is_agent())', t);
  end loop;
end $$;

-- ── 3b. What an agent may read ───────────────────────────────────────────────────────────────────────────────────
-- Only workspaces where the caller is an active member. People come back as id, name, GitHub login, role and status:
-- no emails or avatars. An app comes back without its access note, and its handover only as who wrote it and whether
-- a person checked it. These functions are the whole read surface: the same answer reaches the MCP server and a
-- client that calls them directly.
create or replace function public.mcp_people(ws uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'name', m.name, 'githubLogin', m.github_login, 'userId', null, 'email', null, 'avatarUrl', null,
    'role', m.role, 'isAdmin', m.is_admin, 'active', m.active, 'leavingOn', m.leaving_on) order by m.name), '[]'::jsonb)
  from public.members m where m.workspace_id = ws and m.removed_at is null
$$;
revoke all on function public.mcp_people(uuid) from public, anon, authenticated;

create or replace function public.mcp_app_view(p_id text, d jsonb) returns jsonb
language sql immutable set search_path = public as $$
  select (d - 'handover' - 'access') || jsonb_build_object('id', p_id, 'handover',
    case when jsonb_typeof(d->'handover') = 'object'
      then jsonb_build_object('draftedBy', d->'handover'->'draftedBy', 'checkedAt', d->'handover'->'checkedAt') end)
$$;
revoke all on function public.mcp_app_view(text, jsonb) from public, anon, authenticated;

create or replace function public.mcp_list_apps() returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'workspace', jsonb_build_object('id', w.id, 'name', w.name, 'kind', w.kind),
      'me', me.id,
      'members', public.mcp_people(w.id),
      'apps', coalesce((select jsonb_agg(public.mcp_app_view(p.id, p.data) order by p.data->>'name')
                        from public.projects p where p.workspace_id = w.id), '[]'::jsonb)
    ) order by w.name)
    from public.workspaces w
    join public.members me on me.workspace_id = w.id and me.user_id = auth.uid() and me.active and me.removed_at is null
  ), '[]'::jsonb);
end $$;
revoke all on function public.mcp_list_apps() from public, anon;
grant execute on function public.mcp_list_apps() to authenticated;

create or replace function public.mcp_get_app(p_app text) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  ws uuid; me text; doc jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select p.workspace_id, p.data into ws, doc from public.projects p where p.id = p_app;
  me := case when ws is null then null else public.my_member_id(ws) end;
  if me is null then raise exception 'No app with that id.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'workspace', (select jsonb_build_object('id', w.id, 'name', w.name, 'kind', w.kind) from public.workspaces w where w.id = ws),
    'me', me,
    'members', public.mcp_people(ws),
    'app', public.mcp_app_view(p_app, doc),
    'activity', coalesce((select jsonb_agg(jsonb_build_object(
                            'id', a.id, 'projectId', a.data->'projectId', 'kind', a.data->'kind', 'actor', a.data->'actor',
                            'agent', a.data->'agent', 'title', a.data->'title', 'url', a.data->'url', 'at', a.data->'at') order by a.at desc)
                          from (select * from public.activity
                                where workspace_id = ws and data->>'projectId' = p_app
                                order by at desc limit 10) a), '[]'::jsonb));
end $$;
revoke all on function public.mcp_get_app(text) from public, anon;
grant execute on function public.mcp_get_app(text) to authenticated;

-- ── 4. The writes an agent may make ──────────────────────────────────────────────────────────────────────────────
-- Shared checks: signed in, the app exists in a workspace where the caller is an active member, and the caller may
-- edit it (a manager or the app's owner, the 0005 rule). A missing app and a foreign app give the same answer.
-- Rate limit: 30 agent writes per member per minute, counted from the activity rows these functions write. The
-- advisory lock makes check-then-insert atomic per member, so parallel calls can't all see 29.
create or replace function public.mcp_rate_limit(ws uuid, me text) returns void
language plpgsql set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('tempo.mcp:' || me, 0));
  if (select count(*) from public.activity a
      where a.workspace_id = ws and a.data->>'mcpBy' = me and a.at > now() - interval '1 minute') >= 30 then
    raise exception 'Too many agent writes in a minute. Try again shortly.' using errcode = '54000';
  end if;
end $$;
revoke all on function public.mcp_rate_limit(uuid, text) from public, anon, authenticated;

create or replace function public.mcp_app_for_edit(p_app text, out ws uuid, out me text, out doc jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select p.workspace_id, p.data into ws, doc from public.projects p where p.id = p_app;
  me := case when ws is null then null else public.my_member_id(ws) end;
  if me is null then raise exception 'No app with that id.' using errcode = 'P0002'; end if;
  -- coalesce: an app with no owner gives null here, and null must mean "no", so only an admin may edit it.
  if not (public.is_manager(ws) or coalesce(doc->>'ownerId' = me, false)) then
    raise exception 'Only the app''s owner or an admin can change this app.' using errcode = '42501';
  end if;
  perform public.mcp_rate_limit(ws, me);
end $$;
revoke all on function public.mcp_app_for_edit(text) from public, anon, authenticated;

-- Text from an agent, as stored: invisible, bidi-override and control characters removed (the same set as
-- src/ai/tools/mcpDrafts.ts, plus C0 controls other than tab and newline, carriage return included), then cut to n characters. The MCP server
-- also flattens markup and redacts secrets; this is what holds for a direct call too. Cards render as plain text.
create or replace function public.mcp_clean(t text, n int) returns text
language sql immutable set search_path = public as $$
  select left(regexp_replace(coalesce(t, ''),
    '[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF\u0001-\u0008\u000B-\u000D\u000E-\u001F\u007F]', '', 'g'), n)
$$;
revoke all on function public.mcp_clean(text, int) from public, anon, authenticated;

create or replace function public.mcp_client(p_client text) returns text
language sql immutable set search_path = public as $$
  select coalesce(nullif(btrim(regexp_replace(public.mcp_clean(p_client, 200), '\s+', ' ', 'g')), ''), 'An AI agent')::varchar(60)::text
$$;
revoke all on function public.mcp_client(text) from public, anon, authenticated;

create or replace function public.mcp_drafted_by(me text, p_client text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'client', public.mcp_client(p_client),
    'clientId', nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'client_id',
    'memberId', me,
    'at', to_jsonb(now()))
$$;
revoke all on function public.mcp_drafted_by(text, text) from public, anon, authenticated;

create or replace function public.mcp_log(ws uuid, p_app text, me text, p_client text, p_title text) returns void
language sql set search_path = public, extensions as $$
  insert into public.activity (id, workspace_id, data) values (
    'a_' || substr(encode(gen_random_bytes(8), 'hex'), 1, 8), ws,
    jsonb_build_object(
      'projectId', p_app, 'kind', 'sync', 'agent', null, 'mcpBy', me,
      'actor', public.mcp_client(p_client),
      'title', left(p_title, 200), 'url', null, 'at', to_jsonb(now())))
$$;
revoke all on function public.mcp_log(uuid, text, text, text, text) from public, anon, authenticated;

-- An app card draft. The server cleans the text first (src/ai/tools/mcpDrafts.ts); this function enforces what must
-- hold even for a direct call: right shape, clean text within the caps, stage enum, always an unchecked draft,
-- human-edited what/who kept, and the evidence Tempo read itself left as it was. Kept values are kept only when they
-- have the card's shape.
create or replace function public.mcp_submit_card(p_app text, p_card jsonb, p_client text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  ws uuid; me text; doc jsonb; old jsonb; edited jsonb; card jsonb;
begin
  select * into ws, me, doc from public.mcp_app_for_edit(p_app);
  if p_card is null or jsonb_typeof(p_card) <> 'object'
     or jsonb_typeof(p_card->'what') is distinct from 'string' or jsonb_typeof(p_card->'who') is distinct from 'string'
     or jsonb_typeof(p_card->'status') is distinct from 'string' or jsonb_typeof(p_card->'stage') is distinct from 'string'
     or btrim(public.mcp_clean(p_card->>'what', 240)) = '' or btrim(public.mcp_clean(p_card->>'status', 400)) = ''
     or p_card->>'stage' not in ('idea', 'building', 'live', 'stale') then
    raise exception 'A card needs what, who, stage (idea, building, live or stale) and status.' using errcode = '22023';
  end if;
  old := case when jsonb_typeof(doc->'appCard') = 'object' then doc->'appCard' else '{}'::jsonb end;
  edited := case when jsonb_typeof(old->'editedFields') = 'array'
    then (select coalesce(jsonb_agg(distinct e), '[]'::jsonb) from jsonb_array_elements(old->'editedFields') e
          where e in ('"what"'::jsonb, '"who"'::jsonb))
    else '[]'::jsonb end;
  card := jsonb_build_object(
    'what', case when edited ? 'what' and jsonb_typeof(old->'what') = 'string' then old->'what'
                 else to_jsonb(public.mcp_clean(p_card->>'what', 240)) end,
    'who', case when edited ? 'who' and jsonb_typeof(old->'who') = 'string' then old->'who'
                else to_jsonb(public.mcp_clean(p_card->>'who', 160)) end,
    'stage', p_card->'stage',
    'status', to_jsonb(public.mcp_clean(p_card->>'status', 400)),
    'updatedAt', to_jsonb(now()),
    'source', 'ai',
    'checkedAt', null,
    'checkedBy', null,
    'editedFields', edited,
    'draftedBy', public.mcp_drafted_by(me, p_client));
  if jsonb_typeof(old->'evidence') = 'object' then card := card || jsonb_build_object('evidence', old->'evidence'); end if;
  update public.projects set data = jsonb_set(data, '{appCard}', card), updated_at = now() where id = p_app;
  perform public.mcp_log(ws, p_app, me, p_client, 'Drafted the app card');
  return jsonb_build_object('appId', p_app, 'status', 'draft');
end $$;
revoke all on function public.mcp_submit_card(text, jsonb, text) from public, anon;
grant execute on function public.mcp_submit_card(text, jsonb, text) to authenticated;

-- A list of strings from a handover: every element must be a string; each is cleaned and cut to 300 characters.
create or replace function public.mcp_str_list(v jsonb, field text) returns jsonb
language plpgsql immutable set search_path = public as $$
begin
  if jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v) > 20
     or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'string') then
    raise exception 'Handover field % must be a list of at most 20 lines of text.', field using errcode = '22023';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(public.mcp_clean(e #>> '{}', 300)) order by i), '[]'::jsonb)
          from jsonb_array_elements(v) with ordinality as x(e, i));
end $$;
revoke all on function public.mcp_str_list(jsonb, text) from public, anon, authenticated;

-- A handover pack, stored as an unchecked draft: a person reads it and marks it checked in Tempo before it can be
-- copied or downloaded. Every element is checked and cleaned here, and an evidence link survives only when it is an
-- issue, pull request or commit page of the app's own repo (the browser cleans it again before showing it).
create or replace function public.mcp_submit_handover(p_app text, p_doc jsonb, p_client text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  ws uuid; me text; doc jsonb; prefix text; places jsonb; work jsonb;
begin
  select * into ws, me, doc from public.mcp_app_for_edit(p_app);
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' or jsonb_typeof(p_doc->'summary') is distinct from 'string'
     or btrim(public.mcp_clean(p_doc->>'summary', 1200)) = '' then
    raise exception 'A handover needs a summary.' using errcode = '22023';
  end if;
  if pg_column_size(p_doc) > 24000 then raise exception 'That handover is too long.' using errcode = '22023'; end if;
  if jsonb_typeof(p_doc->'whereThingsAre') is distinct from 'array' or jsonb_array_length(p_doc->'whereThingsAre') > 20
     or exists (select 1 from jsonb_array_elements(p_doc->'whereThingsAre') e
                where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'path') is distinct from 'string'
                   or jsonb_typeof(e->'what') is distinct from 'string') then
    raise exception 'Handover field whereThingsAre must be a list of at most 20 {path, what} items.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_doc->'openWork') is distinct from 'array' or jsonb_array_length(p_doc->'openWork') > 20
     or exists (select 1 from jsonb_array_elements(p_doc->'openWork') e
                where jsonb_typeof(e) <> 'object' or jsonb_typeof(e->'title') is distinct from 'string'
                   or (e ? 'evidenceUrl' and jsonb_typeof(e->'evidenceUrl') not in ('string', 'null'))) then
    raise exception 'Handover field openWork must be a list of at most 20 {title, evidenceUrl?} items.' using errcode = '22023';
  end if;
  places := (select coalesce(jsonb_agg(jsonb_build_object('path', public.mcp_clean(e->>'path', 300), 'what', public.mcp_clean(e->>'what', 300)) order by i), '[]'::jsonb)
             from jsonb_array_elements(p_doc->'whereThingsAre') with ordinality as x(e, i));
  prefix := 'https://github.com/' || lower(doc->'repo'->>'fullName') || '/';
  work := (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                    'title', public.mcp_clean(e->>'title', 300),
                    'evidenceUrl', case when prefix is not null and length(e->>'evidenceUrl') <= 300
                                         and left(lower(e->>'evidenceUrl'), length(prefix)) = prefix
                                         and substr(lower(e->>'evidenceUrl'), length(prefix) + 1) ~ '^(issues/[0-9]+|pull/[0-9]+|commit/[0-9a-f]{7,40})$'
                                        then e->>'evidenceUrl' end)) order by i), '[]'::jsonb)
           from jsonb_array_elements(p_doc->'openWork') with ordinality as x(e, i));
  update public.projects
  set data = jsonb_set(data, '{handover}', jsonb_build_object(
        'doc', jsonb_build_object(
          'summary', public.mcp_clean(p_doc->>'summary', 1200),
          'howToRun', public.mcp_str_list(p_doc->'howToRun', 'howToRun'),
          'whereThingsAre', places,
          'openWork', work,
          'risks', public.mcp_str_list(p_doc->'risks', 'risks'),
          'contacts', public.mcp_str_list(p_doc->'contacts', 'contacts'),
          'unknowns', public.mcp_str_list(p_doc->'unknowns', 'unknowns')),
        'draftedBy', public.mcp_drafted_by(me, p_client),
        'checkedAt', null,
        'checkedBy', null)),
      updated_at = now()
  where id = p_app;
  perform public.mcp_log(ws, p_app, me, p_client, 'Wrote a handover pack draft');
  return jsonb_build_object('appId', p_app, 'status', 'draft');
end $$;
revoke all on function public.mcp_submit_handover(text, jsonb, text) from public, anon;
grant execute on function public.mcp_submit_handover(text, jsonb, text) to authenticated;

-- A heartbeat from an agent that is signed in over MCP: any active member of the app's workspace may send one (no
-- edit right needed, like the hook script). Same row shape and the same effect as ingest_heartbeat: an activity log
-- line labelled with the client's name, and lastActivityAt. It changes no card, so it is a log, not a draft.
create or replace function public.mcp_report_activity(p_app text, p_summary text, p_branch text default null,
  p_commit text default null, p_client text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  ws uuid; me text; repo text;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  select p.workspace_id, lower(p.data->'repo'->>'fullName') into ws, repo from public.projects p where p.id = p_app;
  me := case when ws is null then null else public.my_member_id(ws) end;
  if me is null then raise exception 'No app with that id.' using errcode = 'P0002'; end if;
  perform public.mcp_rate_limit(ws, me);
  insert into public.activity (id, workspace_id, data) values (
    'a_' || substr(encode(gen_random_bytes(8), 'hex'), 1, 8), ws,
    jsonb_build_object(
      'projectId', p_app, 'kind', 'heartbeat', 'agent', 'other', 'mcpBy', me,
      'actor', public.mcp_client(p_client),
      'title', coalesce(nullif(btrim(public.mcp_clean(p_summary, 500)), ''), 'Session ended'),
      'url', case when repo is not null and p_commit ~ '^[0-9a-f]{7,40}$' then 'https://github.com/' || repo || '/commit/' || p_commit end,
      'branch', nullif(public.mcp_clean(p_branch, 100), ''),
      'at', to_jsonb(now())));
  update public.projects set data = jsonb_set(data, '{lastActivityAt}', to_jsonb(now())), updated_at = now() where id = p_app;
  return jsonb_build_object('appId', p_app, 'status', 'ok');
end $$;
revoke all on function public.mcp_report_activity(text, text, text, text, text) from public, anon;
grant execute on function public.mcp_report_activity(text, text, text, text, text) to authenticated;
