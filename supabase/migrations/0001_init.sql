-- Tempo v2 schema. Paste into Supabase → SQL Editor → Run. Safe to run once on a fresh project.
-- Model: the browser keeps the rich objects (projects/tasks/activity as JSON documents, same shape as src/types.ts);
-- the database scopes them to a workspace and enforces who can see them (row-level security on every table).

create extension if not exists pgcrypto;

-- ── People ────────────────────────────────────────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null default '',
  email text,
  avatar_url text,
  github_login text,
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

-- A member is a person in a workspace. user_id is null for people who haven't signed in (e.g. a repo owner).
create table public.members (
  id text primary key default ('m_' || substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8)),
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid references auth.users on delete set null,
  name text not null check (char_length(name) between 1 and 80),
  email text,
  avatar_url text,
  github_login text,
  role text not null default 'member' check (role in ('owner', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create index members_user_idx on public.members (user_id);

create or replace function public.is_member(ws uuid) returns boolean
language sql security definer stable set search_path = public, extensions as $$
  select exists (select 1 from members where workspace_id = ws and user_id = auth.uid() and active)
$$;

create or replace function public.is_owner(ws uuid) returns boolean
language sql security definer stable set search_path = public, extensions as $$
  select exists (select 1 from members where workspace_id = ws and user_id = auth.uid() and active and role = 'owner')
$$;

-- ── Documents (same JSON shape as the app's types) ────────────────────────────────────────────────────────────
create table public.projects (
  id text primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 65536),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create table public.tasks (
  id text primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 65536),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create table public.activity (
  id text primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 8192),
  at timestamptz not null default now()
);
create index projects_ws_idx on public.projects (workspace_id);
create index tasks_ws_idx on public.tasks (workspace_id);
create index activity_ws_at_idx on public.activity (workspace_id, at desc);

-- ── Invites and heartbeat keys ────────────────────────────────────────────────────────────────────────────────
create table public.invites (
  token text primary key default encode(extensions.gen_random_bytes(16), 'hex'),
  workspace_id uuid not null references public.workspaces on delete cascade,
  email text, -- null = anyone with the link (until it expires); set = only that email, single use
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz
);

create table public.ingest_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  key_hash text not null unique,
  label text not null default 'Coding agents',
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ── Profiles from sign-in (Google or GitHub metadata) ─────────────────────────────────────────────────────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into profiles (id, name, email, avatar_url, github_login)
  values (
    new.id,
    coalesce(nullif(meta->>'full_name', ''), nullif(meta->>'name', ''), nullif(meta->>'user_name', ''), split_part(coalesce(new.email, 'New member'), '@', 1)),
    new.email,
    coalesce(meta->>'avatar_url', meta->>'picture'),
    case when new.raw_app_meta_data->>'provider' = 'github' then meta->>'user_name' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── RPCs ──────────────────────────────────────────────────────────────────────────────────────────────────────
-- Create a workspace with the caller as owner. p_member_id lets the browser keep its local "You" id.
create or replace function public.create_workspace(p_name text, p_member_id text default null) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare ws uuid; p profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from profiles where id = auth.uid();
  insert into workspaces (name, created_by) values (left(coalesce(nullif(trim(p_name), ''), 'My workspace'), 80), auth.uid()) returning id into ws;
  insert into members (id, workspace_id, user_id, name, email, avatar_url, github_login, role)
  values (coalesce(p_member_id, 'm_' || substr(encode(gen_random_bytes(8), 'hex'), 1, 8)), ws, auth.uid(),
          coalesce(nullif(p.name, ''), 'Owner'), p.email, p.avatar_url, p.github_login, 'owner');
  return ws;
end $$;

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

-- A new heartbeat key: returned once in plain text, stored as a SHA-256 hash.
create or replace function public.create_ingest_key(p_workspace uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare k text := 'tk_' || encode(gen_random_bytes(24), 'hex');
begin
  if not is_member(p_workspace) then raise exception 'not a member'; end if;
  insert into ingest_keys (workspace_id, key_hash) values (p_workspace, encode(digest(k, 'sha256'), 'hex'));
  return k;
end $$;

-- Called by the Claude Code / Codex / Cursor hook script with the anon key. No user session: the ingest key is the
-- credential. Stores repo, branch, commit, agent and a capped summary line. Never code or transcripts.
create or replace function public.ingest_heartbeat(p_key text, p_payload jsonb) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  ws uuid;
  repo text;
  proj text;
  agent text := coalesce(p_payload->>'agent', 'other');
  recent int;
begin
  select workspace_id into ws from ingest_keys where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if ws is null then raise exception 'invalid key'; end if;
  select count(*) into recent from activity where workspace_id = ws and at > now() - interval '1 minute' and data->>'kind' = 'heartbeat';
  if recent >= 30 then raise exception 'rate limited'; end if;
  if agent not in ('claude-code', 'codex', 'cursor', 'other') then agent := 'other'; end if;

  -- git@github.com:owner/name.git | https://github.com/owner/name(.git) → owner/name
  repo := lower(substring(regexp_replace(coalesce(p_payload->>'repo', ''), '(\.git)?/*$', '') from '([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$'));
  select id into proj from projects where workspace_id = ws and lower(data->'repo'->>'fullName') = repo limit 1;
  if proj is null then return 'unmatched'; end if;

  insert into activity (id, workspace_id, data) values (
    'a_' || substr(encode(gen_random_bytes(8), 'hex'), 1, 8), ws,
    jsonb_build_object(
      'projectId', proj, 'kind', 'heartbeat', 'agent', agent,
      'actor', left(coalesce(p_payload->>'actor', 'Agent'), 80),
      'title', left(coalesce(nullif(p_payload->>'summary', ''), 'Session ended'), 500),
      'url', case when p_payload->>'commit' ~ '^[0-9a-f]{7,40}$' then 'https://github.com/' || repo || '/commit/' || (p_payload->>'commit') end,
      'branch', left(p_payload->>'branch', 100),
      'at', to_jsonb(now())
    ));
  update projects set data = jsonb_set(data, '{lastActivityAt}', to_jsonb(now())), updated_at = now() where id = proj;
  return 'ok';
end $$;

revoke all on function public.ingest_heartbeat(text, jsonb) from public;
grant execute on function public.ingest_heartbeat(text, jsonb) to anon, authenticated;
revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;
revoke all on function public.create_ingest_key(uuid) from public, anon;
grant execute on function public.create_ingest_key(uuid) to authenticated;

-- ── Row-level security ────────────────────────────────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.members enable row level security;
alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.activity enable row level security;
alter table public.invites enable row level security;
alter table public.ingest_keys enable row level security;

create policy "own profile or a teammate's" on public.profiles for select using (
  id = auth.uid() or exists (select 1 from members a join members b on a.workspace_id = b.workspace_id
                             where a.user_id = auth.uid() and a.active and b.user_id = profiles.id));
create policy "update own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());
-- Email and GitHub login come from the verified sign-in only.
revoke update on public.profiles from authenticated, anon;
grant update (name, avatar_url) on public.profiles to authenticated;

create policy "members read" on public.workspaces for select using (is_member(id));
create policy "owners rename" on public.workspaces for update using (is_owner(id)) with check (is_owner(id));

create policy "members read" on public.members for select using (is_member(workspace_id));
-- Members may add placeholder people (no user_id: that would grant access) and edit names/owner flags.
create policy "members add people" on public.members for insert with check (is_member(workspace_id) and user_id is null and role = 'member');
create policy "members edit people" on public.members for update using (is_member(workspace_id)) with check (is_member(workspace_id));
-- Nobody can grant themselves access or a role by editing a row: only these columns are updatable.
-- (A column-level revoke does nothing while the table-level grant exists, so revoke the table, grant columns.)
revoke update on public.members from authenticated, anon;
grant update (name, email, avatar_url, github_login, active) on public.members to authenticated;

create policy "members all" on public.projects for all using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy "members all" on public.tasks for all using (is_member(workspace_id)) with check (is_member(workspace_id));
create policy "members read" on public.activity for select using (is_member(workspace_id));
create policy "members write" on public.activity for insert with check (is_member(workspace_id));

create policy "members manage" on public.invites for all using (is_member(workspace_id)) with check (is_member(workspace_id));

create policy "members read" on public.ingest_keys for select using (is_member(workspace_id));
create policy "members revoke" on public.ingest_keys for update using (is_member(workspace_id)) with check (is_member(workspace_id));

-- Only owners can remove (deactivate) or restore people, and an owner row can't be deactivated by anyone.
-- Invoker rights on purpose: current_user is 'authenticated' for direct API updates, and the function owner inside
-- trusted RPCs such as accept_invite.
create or replace function public.guard_member_active() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.active is distinct from old.active and current_user = 'authenticated' then
    if not is_owner(old.workspace_id) then raise exception 'Only an owner can remove or restore people.'; end if;
    if old.role = 'owner' then raise exception 'Owners cannot be removed.'; end if;
  end if;
  return new;
end $$;
create trigger members_guard_active before update on public.members
  for each row execute function public.guard_member_active();

-- Invites last at most 30 days, whatever the client sends.
create or replace function public.clamp_invite_expiry() returns trigger
language plpgsql set search_path = public as $$
begin
  new.expires_at := least(coalesce(new.expires_at, now() + interval '7 days'), now() + interval '30 days');
  return new;
end $$;
create trigger invites_clamp_expiry before insert or update on public.invites
  for each row execute function public.clamp_invite_expiry();

-- ── Realtime ──────────────────────────────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.projects, public.tasks, public.activity, public.members;

-- (0003) The sign-up trigger function is not callable over the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
