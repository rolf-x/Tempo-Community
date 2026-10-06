-- 0022 · Up to date on every push. GitHub sends a webhook for every push to the
-- GitHub App Tempo signs in with; Tempo's server re-reads that repo with the App's own installation token and saves
-- the facts here. The server is the only caller of the github_* functions below: each takes Tempo's server key, kept
-- in Vercel env and stored here only as a SHA-256 hash (set by hand, never in a migration). Facts land only in
-- workspaces linked to the installation that sent the push; a manager links them from the browser, and the server
-- checks the installation list with that person's own GitHub token first. Written to re-run safely.

-- ── 0. Timestamps as the browser writes them (ISO 8601, milliseconds, UTC) ───────────────────────────────────────
create or replace function public.iso_ms(t timestamptz) returns text
language sql immutable set search_path = public as $$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
revoke all on function public.iso_ms(timestamptz) from public, anon;

-- ── 1. Tempo's server key ──────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.server_keys (
  name text primary key,
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
alter table public.server_keys enable row level security;
revoke all on public.server_keys from public, anon, authenticated;

create or replace function public.server_key_ok(p_name text, p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(length(p_key), 0) >= 32 and exists (
    select 1 from public.server_keys
    where name = p_name and key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex'))
$$;
revoke all on function public.server_key_ok(text, text) from public, anon, authenticated;

-- ── 2. Installations linked to workspaces ─────────────────────────────────────────────────────────────────────────
create table if not exists public.workspace_installations (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  installation_id bigint not null check (installation_id > 0),
  account_login text not null check (char_length(account_login) between 1 and 100),
  linked_by uuid,
  linked_at timestamptz not null default now(),
  primary key (workspace_id, installation_id)
);
create index if not exists workspace_installations_installation_idx on public.workspace_installations (installation_id);
alter table public.workspace_installations enable row level security;
revoke all on public.workspace_installations from public, anon, authenticated;
grant select (workspace_id, installation_id, account_login, linked_at) on public.workspace_installations to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_installations' and policyname = 'members read their links') then
    create policy "members read their links" on public.workspace_installations for select
      using (public.is_member(workspace_id));
  end if;
  -- Same default-deny as 0017: a connected AI app's token reads and writes no table.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'workspace_installations' and policyname = 'agents use mcp functions only') then
    create policy "agents use mcp functions only" on public.workspace_installations as restrictive for all
      using (not public.is_agent()) with check (not public.is_agent());
  end if;
end $$;

-- ── 3. Deliveries already handled (GitHub may send one twice) ─────────────────────────────────────────────────────
create table if not exists public.github_deliveries (
  id text primary key check (char_length(id) between 1 and 100),
  received_at timestamptz not null default now()
);
alter table public.github_deliveries enable row level security;
revoke all on public.github_deliveries from public, anon, authenticated;

-- True the first time a delivery id is seen. Ids older than 3 days are dropped (GitHub redelivers only within 3 days).
create or replace function public.github_record_delivery(p_key text, p_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.server_key_ok('github', p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if p_id is null or p_id !~ '^[0-9A-Za-z-]{1,100}$' then raise exception 'Bad delivery id.' using errcode = '22023'; end if;
  delete from public.github_deliveries where received_at < now() - interval '3 days';
  insert into public.github_deliveries (id) values (p_id) on conflict (id) do nothing;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.github_record_delivery(text, text) from public;
grant execute on function public.github_record_delivery(text, text) to anon;

-- ── 4. Link a workspace to the installations its manager can see ──────────────────────────────────────────────────
-- p_installations comes from Tempo's server, which read it from GitHub with the caller's own token (GET
-- /user/installations): [{ "id": 123, "login": "acme" }, …]. Only installations whose account owns one of the
-- workspace's repos, or is its GitHub org, are linked. Links are only added here; GitHub's "installation deleted"
-- removes them.
create or replace function public.github_link_installations(p_key text, p_workspace uuid, p_installations jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  owners text[];
  inst jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if public.is_agent() then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not public.server_key_ok('github', p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if not public.is_manager(p_workspace) then
    raise exception 'Only owners and admins can turn on updates on every push.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_installations) is distinct from 'array' or jsonb_array_length(p_installations) > 100 then
    raise exception 'Bad installation list.' using errcode = '22023';
  end if;

  select array_agg(distinct o) into owners from (
    select lower(split_part(p.data->'repo'->>'fullName', '/', 1)) as o
    from public.projects p where p.workspace_id = p_workspace and p.data->'repo'->>'fullName' like '%/%'
    union
    select lower(w.github_org) from public.workspaces w where w.id = p_workspace and w.github_org is not null
  ) s where o is not null and o <> '';

  for inst in select * from jsonb_array_elements(p_installations) loop
    if jsonb_typeof(inst->'id') = 'number' and (inst->>'id') ~ '^[1-9][0-9]{0,18}$'
       and jsonb_typeof(inst->'login') = 'string' and char_length(inst->>'login') between 1 and 100
       and lower(inst->>'login') = any(coalesce(owners, '{}')) then
      insert into public.workspace_installations (workspace_id, installation_id, account_login, linked_by)
      values (p_workspace, (inst->>'id')::bigint, inst->>'login', auth.uid())
      on conflict (workspace_id, installation_id) do update set account_login = excluded.account_login;
    end if;
  end loop;

  return coalesce((select jsonb_agg(jsonb_build_object('installationId', l.installation_id, 'login', l.account_login,
                                                       'linkedAt', l.linked_at) order by l.account_login)
                   from public.workspace_installations l where l.workspace_id = p_workspace), '[]'::jsonb);
end $$;
revoke all on function public.github_link_installations(text, uuid, jsonb) from public, anon;
grant execute on function public.github_link_installations(text, uuid, jsonb) to authenticated;

-- An installation was deleted or suspended on GitHub: unlink it everywhere.
create or replace function public.github_unlink_installation(p_key text, p_installation bigint) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.server_key_ok('github', p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  delete from public.workspace_installations where installation_id = p_installation;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.github_unlink_installation(text, bigint) from public;
grant execute on function public.github_unlink_installation(text, bigint) to anon;

-- ── 5. Save what a push changed ───────────────────────────────────────────────────────────────────────────────────
-- p_repo: { id, fullName, private, defaultBranch } as GitHub reports it now (an account name is letters, digits and
-- dashes; a repo name may also hold dots and underscores, but is never . or ..). Apps match by repo id, then by full
-- name (apps saved before ids were kept, and p_old_full_name after a rename). p_signals: fresh facts after a push to
-- the default branch, or null for a push to another branch. p_active_at: when the push happened. Only signals,
-- lastActivityAt and the repo's id, name, url, visibility and default branch are written; never cards, owners,
-- tasks or members. Returns how many apps were updated.
create or replace function public.github_save_facts(p_key text, p_installation bigint, p_repo jsonb, p_signals jsonb,
                                                    p_active_at timestamptz, p_old_full_name text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  rid bigint;
  full_name text;
  repo jsonb;
  sig jsonb;
  secret_files jsonb;
  live text;
  active timestamptz;
  n integer;
begin
  if not public.server_key_ok('github', p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  if jsonb_typeof(p_repo) is distinct from 'object' or (p_repo->>'id') !~ '^[1-9][0-9]{0,18}$'
     or (p_repo->>'fullName') !~ '^[A-Za-z0-9-]{1,39}/[A-Za-z0-9_.-]{1,100}$'
     or split_part(p_repo->>'fullName', '/', 2) in ('.', '..') then
    raise exception 'Bad repo.' using errcode = '22023';
  end if;
  rid := (p_repo->>'id')::bigint;
  full_name := p_repo->>'fullName';
  -- Visibility and default branch only when GitHub sent them, so a partial update never resets them.
  repo := jsonb_build_object('id', rid, 'fullName', full_name, 'url', 'https://github.com/' || full_name)
    || case when jsonb_typeof(p_repo->'private') = 'boolean' then jsonb_build_object('private', (p_repo->>'private')::boolean) else '{}'::jsonb end
    || case when jsonb_typeof(p_repo->'defaultBranch') = 'string' and char_length(p_repo->>'defaultBranch') between 1 and 200
            then jsonb_build_object('defaultBranch', p_repo->>'defaultBranch') else '{}'::jsonb end;

  if p_signals is not null then
    if jsonb_typeof(p_signals) <> 'object' then raise exception 'Bad facts.' using errcode = '22023'; end if;
    select coalesce(jsonb_agg(left(f, 300)), '[]'::jsonb) into secret_files
    from (select jsonb_array_elements_text(case when jsonb_typeof(p_signals->'secretFiles') = 'array'
                                                then p_signals->'secretFiles' else '[]'::jsonb end) as f limit 100) s;
    live := nullif(p_signals->>'liveUrl', '');
    if live is not null and (live !~ '^https?://' or char_length(live) > 500) then live := null; end if;
    sig := jsonb_build_object(
      'hasReadme', jsonb_typeof(p_signals->'hasReadme') = 'boolean' and (p_signals->>'hasReadme')::boolean,
      'secretFiles', secret_files,
      'lastCommitAt', public.iso_ms(public.mcp_ts(p_signals->>'lastCommitAt')),
      'openIssues', least(greatest(coalesce(case when jsonb_typeof(p_signals->'openIssues') = 'number' then (p_signals->>'openIssues')::numeric end, 0), 0), 100000)::integer,
      'openPrs', least(greatest(coalesce(case when jsonb_typeof(p_signals->'openPrs') = 'number' then (p_signals->>'openPrs')::numeric end, 0), 0), 100000)::integer,
      'syncedAt', public.iso_ms(now()),
      'liveUrl', live);
  end if;
  -- A push can't be in the future; allow a little clock drift between GitHub and the database.
  active := case when p_active_at is not null and p_active_at <= now() + interval '5 minutes' then least(p_active_at, now()) end;

  update public.projects p
  set data = p.data
        || jsonb_build_object('repo', coalesce(case when jsonb_typeof(p.data->'repo') = 'object' then p.data->'repo' end, '{}'::jsonb) || repo)
        || case when sig is null then '{}'::jsonb else jsonb_build_object('signals', sig) end
        || case when active is null
                  or coalesce(public.mcp_ts(p.data->>'lastActivityAt'), '-infinity'::timestamptz) >= active then '{}'::jsonb
                else jsonb_build_object('lastActivityAt', public.iso_ms(active)) end,
      updated_at = now()
  where p.workspace_id in (select l.workspace_id from public.workspace_installations l where l.installation_id = p_installation)
    and jsonb_typeof(p.data->'repo') = 'object'
    and ((p.data->'repo'->>'id') = rid::text
         or ((p.data->'repo'->>'id') is null
             and (lower(p.data->'repo'->>'fullName') = lower(full_name)
                  or (p_old_full_name is not null and lower(p.data->'repo'->>'fullName') = lower(p_old_full_name)))));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.github_save_facts(text, bigint, jsonb, jsonb, timestamptz, text) from public;
grant execute on function public.github_save_facts(text, bigint, jsonb, jsonb, timestamptz, text) to anon;

-- ── 6. The daily check: linked repos whose facts are more than a day old ──────────────────────────────────────────
create or replace function public.github_due_repos(p_key text, p_limit integer default 200)
returns table (installation_id bigint, full_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.server_key_ok('github', p_key) then raise exception 'Not allowed.' using errcode = '42501'; end if;
  return query
    select min(l.installation_id), min(p.data->'repo'->>'fullName')
    from public.projects p
    join public.workspace_installations l on l.workspace_id = p.workspace_id
    where jsonb_typeof(p.data->'repo') = 'object' and p.data->'repo'->>'fullName' like '%/%'
      and (p.data->>'archived') is distinct from 'true'
      and coalesce(public.mcp_ts(p.data->'signals'->>'syncedAt'), '-infinity'::timestamptz) < now() - interval '24 hours'
    group by lower(p.data->'repo'->>'fullName')
    order by min(coalesce(public.mcp_ts(p.data->'signals'->>'syncedAt'), '-infinity'::timestamptz))
    limit least(greatest(coalesce(p_limit, 200), 1), 500);
end $$;
revoke all on function public.github_due_repos(text, integer) from public;
grant execute on function public.github_due_repos(text, integer) to anon;

-- ── 7. Browser saves keep the newer facts ─────────────────────────────────────────────────────────────────────────
-- Same as 0019 plus the facts block at the end: a browser's syncedAt is capped at the server clock, and while the
-- app keeps the same repo, the signals with the later syncedAt and the later lastActivityAt win. So a browser holding a
-- copy from before a push can't wipe what the push wrote.
create or replace function public.keep_agent_writes() returns trigger
language plpgsql set search_path = public as $$
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
  if jsonb_typeof(n->'signals') = 'object' and public.mcp_ts(n->'signals'->>'syncedAt') > now() then
    n := jsonb_set(n, '{signals,syncedAt}', to_jsonb(public.iso_ms(now())));
  end if;
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

  -- 0022: the newer facts win while the app keeps the same repo.
  if lower(n->'repo'->>'fullName') is not distinct from lower(o->'repo'->>'fullName') then
    if jsonb_typeof(o->'signals') = 'object'
       and coalesce(public.mcp_ts(n->'signals'->>'syncedAt'), '-infinity'::timestamptz)
           < coalesce(public.mcp_ts(o->'signals'->>'syncedAt'), '-infinity'::timestamptz) then
      n := jsonb_set(n, '{signals}', o->'signals');
    end if;
    if public.mcp_ts(o->>'lastActivityAt') is not null
       and coalesce(public.mcp_ts(n->>'lastActivityAt'), '-infinity'::timestamptz) < public.mcp_ts(o->>'lastActivityAt') then
      n := jsonb_set(n, '{lastActivityAt}', o->'lastActivityAt');
    end if;
    -- The repo id GitHub gave a push is kept when a browser copy doesn't have it yet.
    if (o->'repo'->>'id') is not null and (n->'repo'->>'id') is null and jsonb_typeof(n->'repo') = 'object' then
      n := jsonb_set(n, '{repo,id}', o->'repo'->'id');
    end if;
  end if;

  new.data := n;
  return new;
end $$;
