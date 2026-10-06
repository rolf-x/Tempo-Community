-- Each person has one live heartbeat key per workspace. Making a new key revokes that person's older keys in the
-- same transaction, so a leaked key stops working at once. Teammates' keys are untouched: every owner connects
-- their own agents, and a key is shown only once, so a workspace-wide revoke would silently cut off
-- everyone else's heartbeats.
create or replace function public.create_ingest_key(p_workspace uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare k text := 'tk_' || encode(gen_random_bytes(24), 'hex');
begin
  if not is_member(p_workspace) then raise exception 'not a member'; end if;

  update ingest_keys
  set revoked_at = now()
  where workspace_id = p_workspace and created_by = auth.uid() and revoked_at is null;

  insert into ingest_keys (workspace_id, key_hash)
  values (p_workspace, encode(digest(k, 'sha256'), 'hex'));

  return k;
end $$;

revoke all on function public.create_ingest_key(uuid) from public, anon;
grant execute on function public.create_ingest_key(uuid) to authenticated;
