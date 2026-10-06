-- handle_new_user is a trigger function: nobody should call it over the API (Supabase advisor
-- anon/authenticated_security_definer_function_executable). The other flagged functions are intentional RPCs
-- (create_workspace, accept_invite, create_ingest_key check auth.uid(); ingest_heartbeat is key-gated) or are needed
-- by RLS policies (is_member, is_owner).
revoke execute on function public.handle_new_user() from public, anon, authenticated;
