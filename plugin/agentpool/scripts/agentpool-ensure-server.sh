#!/usr/bin/env bash
# Make sure the AgentPool backend is running, then hand over this hook.
#
# This runs on SessionStart, so it is the one place where the server can be
# started. Every failure path ends in "exit 0": a broken dashboard must never
# break the session.
set -u

PORT="${AGENTPOOL_PORT:-38000}"
BASE="http://127.0.0.1:${PORT}"
STATE_DIR="${AGENTPOOL_STATE_DIR:-$HOME/.local/state/agentpool}"
PID_FILE="${STATE_DIR}/server.pid"
LOG_FILE="${STATE_DIR}/server.log"
ROOT_FILE="$HOME/.config/agentpool/root"

payload="$(cat)"

alive() {
  curl -s -m 1 "${BASE}/api/health" >/dev/null 2>&1
}

post() {
  curl -s -m 3 -X POST "${BASE}/hooks/$1" \
    -H 'content-type: application/json' \
    --data-binary @- >/dev/null 2>&1
}

# Where the AgentPool project lives. The plugin is copied into the plugin
# cache, so the path cannot be derived from this script.
project_root() {
  if [ -n "${AGENTPOOL_ROOT:-}" ] && [ -d "${AGENTPOOL_ROOT}" ]; then
    printf '%s' "${AGENTPOOL_ROOT}"
    return 0
  fi
  if [ -f "${ROOT_FILE}" ]; then
    head -n 1 "${ROOT_FILE}"
    return 0
  fi
  return 1
}

python_for() {
  if [ -n "${AGENTPOOL_PYTHON:-}" ] && [ -x "${AGENTPOOL_PYTHON}" ]; then
    printf '%s' "${AGENTPOOL_PYTHON}"
    return 0
  fi
  local candidate="$HOME/.pyenv/versions/3.11.11/envs/agentpool-env/bin/python"
  if [ -x "${candidate}" ]; then
    printf '%s' "${candidate}"
    return 0
  fi
  command -v python3 2>/dev/null
}

start_server() {
  local root python
  root="$(project_root)" || return 1
  [ -f "${root}/backend/run.py" ] || return 1
  python="$(python_for)" || return 1
  [ -n "${python}" ] || return 1

  mkdir -p "${STATE_DIR}"
  (
    cd "${root}/backend" || exit 1
    nohup "${python}" run.py >>"${LOG_FILE}" 2>&1 &
    echo $! >"${PID_FILE}"
  )
  return 0
}

wait_for_server() {
  local waited=0
  while [ "${waited}" -lt 200 ]; do
    if alive; then
      return 0
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  return 1
}

if ! alive; then
  start_server && wait_for_server || true
fi

if alive; then
  event="$(printf '%s' "${payload}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin).get("hook_event_name") or "SessionStart")' \
    2>/dev/null || printf 'SessionStart')"
  printf '%s' "${payload}" | post "${event}" || true
fi

exit 0
