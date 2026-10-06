#!/bin/sh
# MCP guard check (migration 0017): proves over real HTTP that an MCP client's token reaches only the five mcp_*
# functions. The SQL tests call the guard directly; this checks what Supabase's Data API actually does with the token.
#
# Usage: TEMPO_AGENT_TOKEN=<an access token issued to an MCP client> sh scripts/mcp-guard-check.sh <supabase-url> <anon-key>
# The token is read from the environment so it never appears in the process list or shell history. It is never printed.
# Read-only: the only write it tries is a PATCH that must be refused.

URL="${1:?supabase url}"
ANON="${2:?anon key}"
: "${TEMPO_AGENT_TOKEN:?set TEMPO_AGENT_TOKEN}"
FAILS=0

# check <expected status> <label> <curl args...>
check() {
  want="$1"; label="$2"; shift 2
  got="$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON" -H "Authorization: Bearer $TEMPO_AGENT_TOKEN" "$@")"
  if [ "$got" = "$want" ]; then echo "ok    $got $label"; else echo "FAIL  $got (wanted $want) $label"; FAILS=$((FAILS + 1)); fi
}

json='Content-Type: application/json'
check 403 'read a table'                       "$URL/rest/v1/projects?select=id&limit=1"
check 403 'read members (emails)'              "$URL/rest/v1/members?select=email&limit=1"
check 403 'change an app directly'             -X PATCH -H "$json" -d '{"updated_at":"2020-01-01"}' "$URL/rest/v1/projects?id=eq.none"
check 403 'call an admin function'             -X POST -H "$json" -d '{"p_member":"m_none","p_admin":true}' "$URL/rest/v1/rpc/set_member_admin"
check 403 'GET an allowed function'            "$URL/rest/v1/rpc/mcp_list_apps"
check 403 'GraphQL'                            -X POST -H "$json" -d '{"query":"{ __typename }"}' "$URL/graphql/v1"
check 200 'list apps through mcp_list_apps'    -X POST -H "$json" -d '{}' "$URL/rest/v1/rpc/mcp_list_apps"

[ "$FAILS" -eq 0 ] && echo "MCP guard: all checks passed" || { echo "MCP guard: $FAILS check(s) failed"; exit 1; }
