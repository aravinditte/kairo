#!/usr/bin/env bash
# run-local.sh — start the full Kairo local stack from a fresh clone:
#
#   Kairo API        http://localhost:8080   (in-memory storage unless
#                                            KAIRO_DATABASE_URL is set)
#   checkout         http://localhost:8081
#   inventory        http://localhost:8082
#   payment          http://localhost:8083
#   notifications    http://localhost:8084
#   frontend (opt-in) http://localhost:5173  — only with --frontend
#
# The API is started in demo mode with the seeded development project and
# the documented development API key `kairo-dev-key`, which is also the
# key the demo services use to ingest spans — so traces from real
# checkouts appear in the API immediately. This key is a development
# credential only; never use it outside a local demo.
#
# Usage:
#   scripts/run-local.sh [--frontend]
#
# Press Ctrl-C to stop everything. Logs go to .kairo-run/*.log.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

WITH_FRONTEND=0
for arg in "$@"; do
  case "${arg}" in
    --frontend) WITH_FRONTEND=1 ;;
    *) echo "unknown argument: ${arg} (only --frontend is supported)" >&2; exit 2 ;;
  esac
done

if ! command -v go >/dev/null 2>&1; then
  # Fall back to well-known install locations before giving up.
  for candidate in "${HOME}/workspace/tools/go/bin" "/usr/local/go/bin" "${HOME}/go/bin" "${HOME}/.local/go/bin"; do
    if [ -x "${candidate}/go" ]; then PATH="${candidate}:${PATH}"; break; fi
  done
fi
command -v go >/dev/null 2>&1 || { echo "error: Go 1.23+ is required (https://go.dev/dl/)" >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "error: curl is required" >&2; exit 1; }

LOG_DIR="${REPO_ROOT}/.kairo-run"
mkdir -p "${LOG_DIR}"
PIDS=()
cleanup() {
  echo
  echo "==> Stopping Kairo local stack"
  for pid in "${PIDS[@]:-}"; do
    [ -n "${pid}" ] && kill "${pid}" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait_healthy() {
  # wait_healthy <name> <health-url>
  local name="$1" url="$2" i
  for i in $(seq 1 60); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      echo "    ${name} is healthy"
      return 0
    fi
    sleep 0.5
  done
  echo "error: ${name} did not become healthy at ${url}; see ${LOG_DIR}/${name}.log" >&2
  return 1
}

API_ADDR="${KAIRO_HTTP_ADDR:-:8080}"
API_PORT="${API_ADDR##*:}"
API_BASE="http://localhost:${API_PORT}"

echo "==> Building Kairo API and demo services"
go build -o "${LOG_DIR}/kairo-api" ./cmd/kairo-api
go build -o "${LOG_DIR}/checkout" ./services/checkout
go build -o "${LOG_DIR}/inventory" ./services/inventory
go build -o "${LOG_DIR}/payment" ./services/payment
go build -o "${LOG_DIR}/notifications" ./services/notifications

echo "==> Starting Kairo API on ${API_BASE} (demo mode, seeded dev project)"
KAIRO_ENV="${KAIRO_ENV:-development}" \
KAIRO_HTTP_ADDR="${API_ADDR}" \
KAIRO_DEMO_MODE=true \
KAIRO_SEED_DEMO=true \
KAIRO_DATABASE_URL="${KAIRO_DATABASE_URL:-}" \
KAIRO_CHECKOUT_URL="http://localhost:8081" \
  "${LOG_DIR}/kairo-api" > "${LOG_DIR}/api.log" 2>&1 &
PIDS+=($!)
wait_healthy "api" "${API_BASE}/healthz"

export KAIRO_ENDPOINT="${API_BASE}/v1/traces"
export KAIRO_API_KEY="kairo-dev-key"

echo "==> Starting demo services"
PORT=8082 "${LOG_DIR}/inventory" > "${LOG_DIR}/inventory.log" 2>&1 &
PIDS+=($!)
PORT=8083 "${LOG_DIR}/payment" > "${LOG_DIR}/payment.log" 2>&1 &
PIDS+=($!)
PORT=8084 "${LOG_DIR}/notifications" > "${LOG_DIR}/notifications.log" 2>&1 &
PIDS+=($!)
PORT=8081 INVENTORY_URL="http://localhost:8082" PAYMENT_URL="http://localhost:8083" NOTIFICATION_URL="http://localhost:8084" \
  "${LOG_DIR}/checkout" > "${LOG_DIR}/checkout.log" 2>&1 &
PIDS+=($!)

wait_healthy "inventory" "http://localhost:8082/healthz"
wait_healthy "payment" "http://localhost:8083/healthz"
wait_healthy "notifications" "http://localhost:8084/healthz"
wait_healthy "checkout" "http://localhost:8081/healthz"

PROJECT_ID=""
if command -v python3 >/dev/null 2>&1; then
  PROJECTS_JSON="$(curl -fsS "${API_BASE}/api/v1/projects" -H "X-Admin-Token: ${KAIRO_ADMIN_TOKEN:-kairo-dev-admin}" || true)"
  PROJECT_ID="$(printf '%s' "${PROJECTS_JSON}" | python3 -c 'import json,sys
try:
    d = json.load(sys.stdin)
    items = d if isinstance(d, list) else d.get("projects", [])
    print(items[0]["id"] if items else "")
except Exception:
    print("")' 2>/dev/null || true)"
fi

echo "==> Generating one checkout so a real trace exists"
curl -fsS -X POST "http://localhost:8081/checkout" \
  -H 'Content-Type: application/json' -d '{"items": 2}' || \
  echo "    (checkout failed — check ${LOG_DIR}/checkout.log; the stack is still up)"

if [ "${WITH_FRONTEND}" = "1" ]; then
  command -v npm >/dev/null 2>&1 || { echo "error: --frontend requires npm" >&2; exit 1; }
  echo "==> Starting frontend dev server on http://localhost:5173"
  ( cd web && VITE_DATA_MODE=api VITE_API_BASE_URL="${API_BASE}" npm install --silent && npm run dev ) \
    > "${LOG_DIR}/frontend.log" 2>&1 &
  PIDS+=($!)
fi

echo
echo "Kairo local stack is running:"
echo "  API:           ${API_BASE}   (health: ${API_BASE}/healthz)"
echo "  Checkout:      http://localhost:8081  (POST /checkout)"
echo "  Inventory:     http://localhost:8082  (GET /reserve)"
echo "  Payment:       http://localhost:8083  (POST /charge)"
echo "  Notifications: http://localhost:8084  (POST /notify)"
echo "  Dev API key:   kairo-dev-key (development only)"
[ -n "${PROJECT_ID}" ] && echo "  Demo project:  ${PROJECT_ID}"
[ "${WITH_FRONTEND}" = "1" ] && echo "  Frontend:      http://localhost:5173"
echo "  Logs:          ${LOG_DIR}/*.log"
echo
echo "Try a fault:  curl -X POST localhost:8082/_fault -d '{\"delay_ms\": 900, \"error_rate\": 0, \"enabled\": true}'"
echo "Then check out: curl -X POST localhost:8081/checkout -d '{\"items\": 1}'"
echo "Press Ctrl-C to stop."
wait
