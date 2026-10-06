-- The invite preview says 'removed' when a signed-in person who was removed from the workspace opens a link made
-- before the removal. Before this, the join page offered Confirm and refused only after the click.
-- Same function as 0007 plus the removed check. Written to re-run safely without drop statements.

create or replace function public.invite_preview(p_token text) returns json
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  inv public.invites%rowtype;
  state text;
  inviter text;
  workspace_name text;
  app_list json;
begin
  select * into inv from public.invites where token = p_token;
  if inv.token is null then
    return json_build_object(
      'status', 'missing', 'inviter_name', null, 'workspace_name', null, 'apps', '[]'::json
    );
  end if;

  -- A plain team link (no email, no apps) is reusable until it expires, as in 0002; personal links are single-use.
  state := case
    when inv.used_at is not null and (inv.email is not null or cardinality(inv.app_ids) > 0) then 'used'
    when inv.expires_at < now() then 'expired'
    else 'ok'
  end;

  -- A signed-in person removed from this workspace learns it here, before pressing Confirm. A link made after the
  -- removal still brings them back (accept_invite, 0011), so it stays 'ok'.
  if state = 'ok' and exists (
    select 1 from public.members m
    where m.workspace_id = inv.workspace_id and m.user_id = (select auth.uid())
      and not m.active and inv.created_at < coalesce(m.removed_at, 'infinity'::timestamptz)
  ) then
    state := 'removed';
  end if;

  select coalesce(nullif(m.name, ''), nullif(pr.name, ''), 'A teammate'), w.name
    into inviter, workspace_name
  from public.workspaces w
  left join public.members m
    on m.workspace_id = w.id and m.user_id = inv.created_by
  left join public.profiles pr on pr.id = inv.created_by
  where w.id = inv.workspace_id
  limit 1;

  select coalesce(
    json_agg(
      json_build_object(
        'id', p.id,
        'name', coalesce(nullif(p.data->>'name', ''), 'Untitled app'),
        'repo', nullif(p.data->'repo'->>'fullName', '')
      ) order by requested.ord
    ),
    '[]'::json
  ) into app_list
  from unnest(inv.app_ids) with ordinality as requested(id, ord)
  join public.projects p on p.id = requested.id and p.workspace_id = inv.workspace_id;

  return json_build_object(
    'status', state,
    'inviter_name', inviter,
    'workspace_name', workspace_name,
    'apps', app_list
  );
end $$;

revoke all on function public.invite_preview(text) from public;
grant execute on function public.invite_preview(text) to anon, authenticated;
