-- 0021 · Coding-agent heartbeats removed.
-- Everything Tempo shows now comes from GitHub. This drops the whole heartbeat path: the hook endpoint
-- (ingest_heartbeat), heartbeat keys (ingest_keys, its revoke guard and the removed-member trigger), the one-line setup
-- (0020) and the MCP report_activity call, plus every heartbeat row already stored. Nothing else references them
-- (no foreign keys, views, publications or other policies or functions). To bring heartbeats back,
-- start a new migration from 0001, 0008, 0010, 0016, 0017 and 0020.

-- ── MCP: report_activity is no longer an allowed call ──────────────────────────────────────────────────────────────
-- Same as 0018 without '/rpc/mcp_report_activity'. create or replace keeps the owner and grants.
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
                                  '/rpc/mcp_submit_handover', '/rpc/mcp_submit_tasks') then
    return;
  end if;
  raise sqlstate 'PT403' using message = 'An MCP client can only read apps and write drafts.';
end $$;

drop function if exists public.mcp_report_activity(text, text, text, text, text);

-- ── One-line setup (0020) ─────────────────────────────────────────────────────────────────────────────────────────
drop function if exists public.redeem_agent_setup_code(text);
drop function if exists public.create_agent_setup_code(uuid);
drop table if exists public.agent_setup_codes;

-- ── Heartbeat keys and the hook endpoint ──────────────────────────────────────────────────────────────────────────
drop function if exists public.ingest_heartbeat(text, jsonb);
drop function if exists public.create_ingest_key(uuid);
drop trigger if exists members_revoke_keys_on_removal on public.members;
drop function if exists public.revoke_keys_of_removed_member();
-- Takes its policies and the ingest_keys_guard_revoke trigger with it.
drop table if exists public.ingest_keys;
drop function if exists public.guard_ingest_key_revoke();

-- ── Stored heartbeats ─────────────────────────────────────────────────────────────────────────────────────────────
drop index if exists public.activity_heartbeat_ws_at_idx;
delete from public.activity where data->>'kind' = 'heartbeat';
