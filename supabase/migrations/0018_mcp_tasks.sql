-- 0018 · Tasks from an agent. When Tempo flags a problem on an app (a health flag), the connected agent adds one to
-- three concrete tasks for it. They live in the app's data under `tasks` and are shown on the app page. Tempo has
-- read-only GitHub access, so a task is a note, never a change in the repo.
-- A task closes on its own: it counts as fixed as soon as its flag is gone, and the next sync in the browser saves
-- `fixedAt` so it can't come back. A person can remove one. This migration adds the sixth mcp_* function an agent
-- token may call (the guard lists it), locks the app row before any agent write checks who may edit it, and keeps a
-- browser's whole-document save from undoing an agent's newer card, handover or tasks. No new table, no new policy.

-- ── 1. The guard now lets an agent POST to mcp_submit_tasks ──────────────────────────────────────────────────────
-- Same body as 0017 with one more path.
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
                                  '/rpc/mcp_submit_handover', '/rpc/mcp_report_activity', '/rpc/mcp_submit_tasks') then
    return;
  end if;
  raise sqlstate 'PT403' using message = 'An MCP client can only read apps and write drafts.';
end $$;
revoke all on function public.mcp_request_guard() from public;
grant execute on function public.mcp_request_guard() to anon, authenticated;

-- ── 2. Agent writes lock the app first ───────────────────────────────────────────────────────────────────────────
-- Same as 0017, except: only an agent token may call the write functions (a browser session saves its own edits
-- through the tables, under the trigger in section 4, so it can't pass itself off as Claude); and the app row is read
-- FOR UPDATE, so the owner and role checks hold until the write commits: an admin reassigning the app at the same
-- moment waits, and a former owner's agent can't write after losing it.
create or replace function public.mcp_app_for_edit(p_app text, out ws uuid, out me text, out doc jsonb)
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if not public.is_agent() then raise exception 'Only a connected AI app can do this.' using errcode = '42501'; end if;
  select p.workspace_id, p.data into ws, doc from public.projects p where p.id = p_app for update;
  me := case when ws is null then null else public.my_member_id(ws) end;
  if me is null then raise exception 'No app with that id.' using errcode = 'P0002'; end if;
  -- coalesce: an app with no owner gives null here, and null must mean "no", so only an admin may edit it.
  if not (public.is_manager(ws) or coalesce(doc->>'ownerId' = me, false)) then
    raise exception 'Only the app''s owner or an admin can change this app.' using errcode = '42501';
  end if;
  perform public.mcp_rate_limit(ws, me);
end $$;
revoke all on function public.mcp_app_for_edit(text) from public, anon, authenticated;

-- A task's text, as stored: mcp_clean, links removed (a task is a note, never a link), one line, cut to n characters.
-- The MCP server also redacts secrets; the browser cleans again before showing a task.
create or replace function public.mcp_task_text(t text, n int) returns text
language sql immutable set search_path = public as $$
  select btrim(left(btrim(regexp_replace(regexp_replace(public.mcp_clean(t, 4000), '(https?://|www\.)\S*', '', 'gi'), '\s+', ' ', 'g')), n))
$$;
revoke all on function public.mcp_task_text(text, int) from public, anon, authenticated;

-- ── 3. The tasks an agent may write ──────────────────────────────────────────────────────────────────────────────
-- Same checks as every agent write (mcp_app_for_edit: signed in, an active member, the app's owner or an admin, and
-- the rate limit). The server cleans the text first (src/ai/tools/mcpDrafts.ts) and refuses a problem the app isn't
-- flagged for right now; this function enforces what must hold even for a direct call: a list of at most 10 objects,
-- each with a known problem, a title of 1 to 80 characters and a detail of at most 240 (text, or none), and at most 3
-- tasks per problem. Title and detail are stored as one line of plain text with links removed (mcp_task_text). The
-- new list replaces the app's open tasks; tasks already fixed stay (the 10 most recent), so a fixed task can't come
-- back. An empty list clears the open tasks. `tasksAt` stamps the list, so a browser's older copy can't undo it.
create or replace function public.mcp_submit_tasks(p_app text, p_tasks jsonb, p_client text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  ws uuid; me text; doc jsonb; kept jsonb; fresh jsonb; n int;
begin
  select * into ws, me, doc from public.mcp_app_for_edit(p_app);
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' then
    raise exception 'Tasks must be a list of at most 10 items.' using errcode = '22023';
  end if;
  if jsonb_array_length(p_tasks) > 10 then
    raise exception 'Tasks must be a list of at most 10 items.' using errcode = '22023';
  end if;
  if pg_column_size(p_tasks) > 40000 then raise exception 'Those tasks are too long.' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_tasks) e where jsonb_typeof(e) <> 'object') then
    raise exception 'Each task must be an object with a problem, a title and an optional detail.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_tasks) e
             where jsonb_typeof(e->'problem') is distinct from 'string'
                or e->>'problem' not in ('no-owner', 'owner-leaving', 'owner-left', 'secrets', 'public-repo', 'stale', 'no-readme', 'no-repo')) then
    raise exception 'A task''s problem must be one of: no-owner, owner-leaving, owner-left, secrets, public-repo, stale, no-readme, no-repo.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_tasks) e
             where jsonb_typeof(e->'title') is distinct from 'string'
                or public.mcp_task_text(e->>'title', 80) = '') then
    raise exception 'A task needs a title of 1 to 80 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_tasks) e where jsonb_typeof(e->'detail') not in ('string', 'null')) then
    raise exception 'A task''s detail must be text.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_tasks) e group by e->>'problem' having count(*) > 3) then
    raise exception 'At most 3 tasks per problem.' using errcode = '22023';
  end if;

  -- mcp_app_for_edit read `doc` under a row lock, so a sync closing a task at the same moment waits for this write.
  -- Kept: the 10 most recent fixed tasks, and the 10 most recent a person removed (so the same task isn't added again).
  kept := (select coalesce(jsonb_agg(x.t order by x.k, x.f desc), '[]'::jsonb) from (
             (select t, 1 as k, t->>'fixedAt' as f
              from jsonb_array_elements(case when jsonb_typeof(doc->'tasks') = 'array' then doc->'tasks' else '[]'::jsonb end) as e(t)
              where jsonb_typeof(t) = 'object' and jsonb_typeof(t->'fixedAt') = 'string'
              order by t->>'fixedAt' desc limit 10)
             union all
             (select t, 2 as k, t->>'removedAt' as f
              from jsonb_array_elements(case when jsonb_typeof(doc->'tasks') = 'array' then doc->'tasks' else '[]'::jsonb end) as e(t)
              where jsonb_typeof(t) = 'object' and coalesce(jsonb_typeof(t->'fixedAt'), 'null') <> 'string'
                and jsonb_typeof(t->'removedAt') = 'string'
              order by t->>'removedAt' desc limit 10)) x);
  fresh := (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', gen_random_uuid()::text,
                      'problem', e->'problem',
                      'title', public.mcp_task_text(e->>'title', 80),
                      'detail', nullif(public.mcp_task_text(e->>'detail', 240), ''),
                      'createdAt', to_jsonb(now()),
                      'draftedBy', public.mcp_drafted_by(me, p_client),
                      'fixedAt', null) order by i), '[]'::jsonb)
            from jsonb_array_elements(p_tasks) with ordinality as x(e, i)
            -- A task a person removed stays removed: the same problem and title isn't added again.
            where not exists (select 1 from jsonb_array_elements(kept) k
                              where jsonb_typeof(k->'removedAt') = 'string' and k->>'problem' = e->>'problem'
                                and lower(k->>'title') = lower(public.mcp_task_text(e->>'title', 80))));
  n := jsonb_array_length(fresh);
  update public.projects set data = jsonb_set(jsonb_set(data, '{tasks}', kept || fresh), '{tasksAt}', to_jsonb(now())),
    updated_at = now() where id = p_app;
  perform public.mcp_log(ws, p_app, me, p_client,
    case when n = 0 then 'Cleared its tasks' else 'Added ' || n || (case when n = 1 then ' task' else ' tasks' end) end);
  return jsonb_build_object('appId', p_app, 'tasks', n);
end $$;
revoke all on function public.mcp_submit_tasks(text, jsonb, text) from public, anon;
grant execute on function public.mcp_submit_tasks(text, jsonb, text) to authenticated;

-- ── 4. A browser save can't undo an agent's newer write ──────────────────────────────────────────────────────────
-- The browser saves an app as one whole JSON document, and sends with it `_base`: the server `updated_at` of the copy
-- it last received. Every browser write is stamped `updated_at = now()` here and `_base` is dropped. If an agent wrote
-- after that copy, the browser's document is stale for what the agent wrote, so for browser writes only (the mcp_*
-- functions run as their owner and write what they mean to) this keeps:
--   appCard   the stored agent draft, when it is newer than the browser's copy and the browser's card isn't that draft;
--   handover  the stored pack, on the same rule;
--   tasks     written only by mcp_submit_tasks, which stamps `tasksAt`. A browser may mark a task fixed (stamped with
--             the database's time), mark it removed or restore it (Undo), or drop it; never add one or change its text.
--             When its copy predates the last list (an older tasksAt), it can't drop what it never saw.
-- Both sides of every comparison are server times, so a browser's clock can't tip it. A browser insert (a new app, or
-- Undo after deleting one) is stored as sent, minus `_base`.
create or replace function public.mcp_ts(t text) returns timestamptz
language plpgsql stable set search_path = public as $$
begin
  return t::timestamptz;
exception when others then
  return null;
end $$;
revoke all on function public.mcp_ts(text) from public, anon;
grant execute on function public.mcp_ts(text) to authenticated;

create or replace function public.keep_agent_writes() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  o jsonb;
  n jsonb := coalesce(new.data, '{}'::jsonb);
  base timestamptz;
  o_at timestamptz;
  stale boolean;
  o_tasks jsonb;
  n_tasks jsonb;
begin
  if current_user <> 'authenticated' then return new; end if;
  base := public.mcp_ts(n->>'_base');
  n := n - '_base';
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.data := n;
    return new;
  end if;
  o := coalesce(old.data, '{}'::jsonb);

  o_at := public.mcp_ts(o->'appCard'->'draftedBy'->>'at');
  if o_at is not null and (base is null or o_at > base)
     and (n->'appCard'->'draftedBy'->>'at') is distinct from (o->'appCard'->'draftedBy'->>'at') then
    n := jsonb_set(n, '{appCard}', o->'appCard');
  end if;

  o_at := public.mcp_ts(o->'handover'->'draftedBy'->>'at');
  if o_at is not null and (base is null or o_at > base)
     and (n->'handover'->'draftedBy'->>'at') is distinct from (o->'handover'->'draftedBy'->>'at') then
    n := jsonb_set(n, '{handover}', o->'handover');
  end if;

  if o ? 'tasks' or n ? 'tasks' or o ? 'tasksAt' or n ? 'tasksAt' then
    o_tasks := case when jsonb_typeof(o->'tasks') = 'array' then o->'tasks' else '[]'::jsonb end;
    n_tasks := case when jsonb_typeof(n->'tasks') = 'array' then n->'tasks' else '[]'::jsonb end;
    stale := public.mcp_ts(o->>'tasksAt') is not null
      and coalesce(public.mcp_ts(n->>'tasksAt'), '-infinity'::timestamptz) < public.mcp_ts(o->>'tasksAt');
    n := jsonb_set(n, '{tasks}', coalesce((
      select jsonb_agg(x.ot
          || jsonb_build_object('fixedAt', case
               when jsonb_typeof(x.ot->'fixedAt') = 'string' then x.ot->'fixedAt'
               when jsonb_typeof(m.nt->'fixedAt') = 'string' then to_jsonb(now())
               else 'null'::jsonb end)
          || case when m.nt is null then '{}'::jsonb
               else jsonb_build_object('removedAt', case
                 when coalesce(jsonb_typeof(m.nt->'removedAt'), 'null') <> 'string' then 'null'::jsonb
                 when jsonb_typeof(x.ot->'removedAt') = 'string' then x.ot->'removedAt'
                 else to_jsonb(now()) end) end
        order by x.ord)
      from jsonb_array_elements(o_tasks) with ordinality as x(ot, ord)
      left join lateral (select y.t as nt from jsonb_array_elements(n_tasks) as y(t) where y.t->>'id' = x.ot->>'id' limit 1) m on true
      where stale or m.nt is not null), '[]'::jsonb));
    n := case when o ? 'tasksAt' then jsonb_set(n, '{tasksAt}', o->'tasksAt') else n - 'tasksAt' end;
  end if;

  new.data := n;
  return new;
end $$;
revoke all on function public.keep_agent_writes() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'projects_keep_agent_writes' and tgrelid = 'public.projects'::regclass) then
    create trigger projects_keep_agent_writes before insert or update on public.projects
      for each row execute function public.keep_agent_writes();
  end if;
end $$;
