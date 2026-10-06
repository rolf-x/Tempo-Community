-- 0019 · Tasks written with the person's own AI key. With a key, Tempo writes an app's tasks itself when it syncs.
-- The browser can't add tasks through the table (0018's trigger only lets it mark one fixed or removed), so this adds
-- one function a signed-in person calls
-- for an app they may edit. An AI app (MCP) keeps using mcp_submit_tasks. No new table, no new policy.

-- ── 1. The shape every task list must have ───────────────────────────────────────────────────────────────────────
-- The same rules as mcp_submit_tasks (0018): a list of at most 10 objects, each with a known problem, a title of 1 to
-- 80 characters once cleaned and a detail that is text or none, at most 3 tasks per problem.
create or replace function public.tasks_check(p_tasks jsonb) returns void
language plpgsql immutable set search_path = public as $$
begin
  if p_tasks is null or jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) > 10 then
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
             where jsonb_typeof(e->'title') is distinct from 'string' or public.mcp_task_text(e->>'title', 80) = '') then
    raise exception 'A task needs a title of 1 to 80 characters.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_tasks) e where jsonb_typeof(e->'detail') not in ('string', 'null')) then
    raise exception 'A task''s detail must be text.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_tasks) e group by e->>'problem' having count(*) > 3) then
    raise exception 'At most 3 tasks per problem.' using errcode = '22023';
  end if;
end $$;
revoke all on function public.tasks_check(jsonb) from public, anon, authenticated;

-- ── 2. Tasks from the person's key ───────────────────────────────────────────────────────────────────────────────
-- Who may: a signed-in browser session (never an AI app's token: it has mcp_submit_tasks, and the request guard
-- doesn't list this one) that may edit the app, the app's owner or an admin, checked on the row locked FOR UPDATE.
-- What it does, unlike mcp_submit_tasks: the new tasks replace the open tasks only for the problems they are about, so
-- a sync that asks the AI about one new flag leaves the other flags' tasks (Claude's or the key's) as they were. Fixed
-- tasks (the 10 most recent) and removed ones (the 10 most recent) stay, and a task a person removed isn't added
-- again. The author is the key (`client` = the label the browser sends, e.g. "Anthropic API key"; no clientId), and
-- `tasksAt` stamps the list so a browser's older copy can't undo it. Runs as its owner, so 0018's trigger lets it be.
create or replace function public.key_submit_tasks(p_app text, p_tasks jsonb, p_label text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  ws uuid; me text; doc jsonb; tasks jsonb; kept jsonb; others jsonb; fresh jsonb; probs text[]; n int;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if public.is_agent() then raise exception 'A connected AI app adds tasks with mcp_submit_tasks.' using errcode = '42501'; end if;
  select p.workspace_id, p.data into ws, doc from public.projects p where p.id = p_app for update;
  me := case when ws is null then null else public.my_member_id(ws) end;
  if me is null then raise exception 'No app with that id.' using errcode = 'P0002'; end if;
  if not (public.is_manager(ws) or coalesce(doc->>'ownerId' = me, false)) then
    raise exception 'Only the app''s owner or an admin can change this app.' using errcode = '42501';
  end if;
  perform public.tasks_check(p_tasks);

  probs := array(select distinct e->>'problem' from jsonb_array_elements(p_tasks) e);
  tasks := case when jsonb_typeof(doc->'tasks') = 'array' then doc->'tasks' else '[]'::jsonb end;
  kept := (select coalesce(jsonb_agg(x.t order by x.k, x.f desc), '[]'::jsonb) from (
             (select t, 1 as k, t->>'fixedAt' as f from jsonb_array_elements(tasks) as e(t)
              where jsonb_typeof(t) = 'object' and jsonb_typeof(t->'fixedAt') = 'string'
              order by t->>'fixedAt' desc limit 10)
             union all
             (select t, 2 as k, t->>'removedAt' as f from jsonb_array_elements(tasks) as e(t)
              where jsonb_typeof(t) = 'object' and coalesce(jsonb_typeof(t->'fixedAt'), 'null') <> 'string'
                and jsonb_typeof(t->'removedAt') = 'string'
              order by t->>'removedAt' desc limit 10)) x);
  -- Open tasks about other problems stay, in their order.
  others := (select coalesce(jsonb_agg(t order by i), '[]'::jsonb) from jsonb_array_elements(tasks) with ordinality as e(t, i)
             where jsonb_typeof(t) = 'object' and coalesce(jsonb_typeof(t->'fixedAt'), 'null') <> 'string'
               and coalesce(jsonb_typeof(t->'removedAt'), 'null') <> 'string'
               and coalesce(t->>'problem', '') <> all (probs));
  fresh := (select coalesce(jsonb_agg(jsonb_build_object(
                      'id', gen_random_uuid()::text,
                      'problem', e->'problem',
                      'title', public.mcp_task_text(e->>'title', 80),
                      'detail', nullif(public.mcp_task_text(e->>'detail', 240), ''),
                      'createdAt', to_jsonb(now()),
                      'draftedBy', jsonb_build_object('client', public.mcp_client(coalesce(p_label, 'Your API key')),
                                                      'clientId', null, 'memberId', me, 'at', to_jsonb(now())),
                      'fixedAt', null) order by i), '[]'::jsonb)
            from jsonb_array_elements(p_tasks) with ordinality as x(e, i)
            where not exists (select 1 from jsonb_array_elements(kept) k
                              where jsonb_typeof(k->'removedAt') = 'string' and k->>'problem' = e->>'problem'
                                and lower(k->>'title') = lower(public.mcp_task_text(e->>'title', 80))));
  n := jsonb_array_length(fresh);
  update public.projects set data = jsonb_set(jsonb_set(data, '{tasks}', kept || others || fresh), '{tasksAt}', to_jsonb(now())),
    updated_at = now() where id = p_app;
  return jsonb_build_object('appId', p_app, 'tasks', n);
end $$;
revoke all on function public.key_submit_tasks(text, jsonb, text) from public, anon;
grant execute on function public.key_submit_tasks(text, jsonb, text) to authenticated;

-- ── 3. A browser can't write an AI app's name ────────────────────────────────────────────────────────────────────
-- 0018's trigger with one more rule (marked 0019 below): a browser save can't put an AI app's name (draftedBy) on a
-- card or write a handover, so "Drafted by Claude" in the Review queue is always true. Found by the authorization
-- tests. Inserts stay as sent (Undo after deleting an app puts the app back as it was), so an owner who
-- deletes and re-creates their own app can still write any label on it.
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

  -- 0019: a browser never writes an AI app's name. On a card it may keep the draftedBy already there or drop it; any
  -- other is removed, so the card reads as a person's. A handover only an agent writes: the browser may mark it
  -- checked or remove it, and any other change keeps the stored one.
  if jsonb_typeof(n->'appCard') = 'object' and n->'appCard' ? 'draftedBy'
     and (n->'appCard'->'draftedBy') is distinct from (o->'appCard'->'draftedBy') then
    n := jsonb_set(n, '{appCard}', (n->'appCard') - 'draftedBy');
  end if;
  if jsonb_typeof(n->'handover') = 'object'
     and (jsonb_typeof(o->'handover') is distinct from 'object'
          or ((n->'handover') - 'checkedAt' - 'checkedBy') <> ((o->'handover') - 'checkedAt' - 'checkedBy')) then
    n := case when jsonb_typeof(o->'handover') = 'object' then jsonb_set(n, '{handover}', o->'handover') else n - 'handover' end;
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
