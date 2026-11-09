#!/usr/bin/env bash
# Forward one hook event to the AgentPool backend.
#
# This is the fallback for the events that are not delivered over HTTP. It
# reads the hook payload on stdin and posts it to the ingest endpoint. It
# always exits 0, because a hook that fails must not stop the session.
set -u

PORT="${AGENTPOOL_PORT:-38000}"
BASE="http://127.0.0.1:${PORT}"

payload="$(cat)"

event="$(printf '%s' "${payload}" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin).get("hook_event_name") or "SessionStart")' \
  2>/dev/null || printf 'SessionStart')"

curl -s -m 3 -X POST "${BASE}/hooks/${event}" \
  -H 'content-type: application/json' \
  --data-binary @- >/dev/null 2>&1 || true

exit 0
