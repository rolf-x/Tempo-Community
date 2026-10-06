-- Agent keys can only be revoked. Before this, the "members revoke" policy let any member change any column of a
-- key row: clear revoked_at (switch a revoked key back on) or swap key_hash for one they know. Now members may set
-- revoked_at and nothing else, and a trigger keeps a revoked key revoked for everyone, trusted RPCs included.
-- create_ingest_key (0008) is security definer, so the column grant doesn't limit it, and it only touches live keys.
-- Written to re-run safely without drop statements (the Supabase MCP blocks drop in -p mode).

revoke update on public.ingest_keys from authenticated, anon;
grant update (revoked_at) on public.ingest_keys to authenticated;

create or replace function public.guard_ingest_key_revoke() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if old.revoked_at is not null then raise exception 'This key is already revoked. Make a new one instead.'; end if;
  if new.revoked_at is null then raise exception 'A key can only be revoked.'; end if;
  if (new.id, new.workspace_id, new.key_hash, new.created_by) is distinct from (old.id, old.workspace_id, old.key_hash, old.created_by) then
    raise exception 'A key can only be revoked.';
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ingest_keys_guard_revoke' and tgrelid = 'public.ingest_keys'::regclass) then
    create trigger ingest_keys_guard_revoke before update on public.ingest_keys
      for each row execute function public.guard_ingest_key_revoke();
  end if;
end $$;
