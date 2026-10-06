-- 0020 · One-line coding-agent setup. Tempo shows a command with a short-lived code in it:
--   curl -fsSL https://<tempo>/api/agent-setup | sh -s -- ts_<32 hex>
-- The person pastes it into Claude Code, Codex, Cursor or Terminal. The installer trades the code for a heartbeat key
-- (/api/agent-setup calls redeem_agent_setup_code below), so the key never appears on screen, in an AI chat or in argv.
-- A code works once, within 10 minutes. Each person has one live code per workspace. Written to re-run safely.

-- ── 1. The codes ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Only the SHA-256 of a code is stored, like heartbeat keys. Browsers read their own rows (no hash); nothing writes the
-- table except the two functions below.
create table if not exists public.agent_setup_codes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  code_hash text not null unique,
  created_by uuid not null default auth.uid() references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  used_at timestamptz
);

alter table public.agent_setup_codes enable row level security;

revoke all on public.agent_setup_codes from anon, authenticated;
grant select (id, workspace_id, created_at, expires_at, used_at) on public.agent_setup_codes to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_setup_codes' and policyname = 'makers read their codes') then
    create policy "makers read their codes" on public.agent_setup_codes for select
      using (created_by = (select auth.uid()));
  end if;
  -- Same default-deny as 0017: a connected AI app's token reads and writes no table.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'agent_setup_codes' and policyname = 'agents use mcp functions only') then
    create policy "agents use mcp functions only" on public.agent_setup_codes as restrictive for all
      using (not public.is_agent()) with check (not public.is_agent());
  end if;
end $$;

-- ── 2. Make a code ───────────────────────────────────────────────────────────────────────────────────────────────
-- Returns the code once, in plain text. A new code replaces the person's other unused codes in that workspace (and
-- clears their expired ones), so there is one live code per person per workspace.
create or replace function public.create_agent_setup_code(p_workspace uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c text := 'ts_' || encode(gen_random_bytes(16), 'hex');
  rec public.agent_setup_codes%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in first.' using errcode = '28000'; end if;
  if public.is_agent() then
    raise exception 'A connected AI app cannot make a setup command.' using errcode = '42501';
  end if;
  if not is_member(p_workspace) then raise exception 'not a member'; end if;

  delete from public.agent_setup_codes
  where workspace_id = p_workspace and created_by = auth.uid() and (used_at is null or expires_at <= now());

  insert into public.agent_setup_codes (workspace_id, code_hash, created_by)
  values (p_workspace, encode(digest(c, 'sha256'), 'hex'), auth.uid())
  returning * into rec;

  return jsonb_build_object('id', rec.id, 'code', c, 'expiresAt', rec.expires_at);
end $$;

revoke all on function public.create_agent_setup_code(uuid) from public, anon;
grant execute on function public.create_agent_setup_code(uuid) to authenticated;

-- ── 3. Trade a code for a heartbeat key ──────────────────────────────────────────────────────────────────────────
-- Called by /api/agent-setup with the anon key, so anon may run it: the code itself is the credential, exactly as the
-- ingest key is for ingest_heartbeat. A missing, used, expired or orphaned code all give the same answer, so the
-- error says nothing about which codes exist. The new key replaces the maker's live key in that workspace (the same
-- rule as create_ingest_key, 0008) and is made for the maker: created_by is set here because anon has no auth.uid().
create or replace function public.redeem_agent_setup_code(p_code text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.agent_setup_codes%rowtype;
  k text;
  ws_name text;
begin
  if p_code is null or p_code !~ '^ts_[0-9a-f]{32}$' then
    raise exception 'That is not a Tempo setup code.' using errcode = '22023';
  end if;

  select * into c from public.agent_setup_codes
  where code_hash = encode(digest(p_code, 'sha256'), 'hex')
  for update;

  if c.id is null or c.used_at is not null or c.expires_at <= now()
     or not exists (
       select 1 from public.members m
       where m.workspace_id = c.workspace_id and m.user_id = c.created_by and m.active
     ) then
    raise exception 'This setup command has expired or was already used.' using errcode = 'P0002';
  end if;

  update public.agent_setup_codes set used_at = now() where id = c.id;

  update public.ingest_keys
  set revoked_at = now()
  where workspace_id = c.workspace_id and created_by = c.created_by and revoked_at is null;

  k := 'tk_' || encode(gen_random_bytes(24), 'hex');
  insert into public.ingest_keys (workspace_id, key_hash, created_by)
  values (c.workspace_id, encode(digest(k, 'sha256'), 'hex'), c.created_by);

  select w.name into ws_name from public.workspaces w where w.id = c.workspace_id;
  return jsonb_build_object('key', k, 'workspace', ws_name);
end $$;

revoke all on function public.redeem_agent_setup_code(text) from public;
grant execute on function public.redeem_agent_setup_code(text) to anon, authenticated;
