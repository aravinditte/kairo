#!/usr/bin/env bash
# seed-demo.sh — create a Kairo project + API key through the management
# API and ingest a small OTLP/JSON trace sample with curl.
#
# Prerequisites: a running Kairo API (see scripts/run-local.sh) and curl.
# python3 is used when available to parse JSON responses and to build a
# fresh, spec-correct OTLP/JSON sample payload (hex IDs); without it the
# script falls back to fixed sample IDs (re-running then re-delivers the
# same spans, which Kairo deduplicates — the sample simply stays as-is).
#
# Configuration (environment):
#   KAIRO_ADDR         default http://localhost:8080
#   KAIRO_ADMIN_TOKEN  default kairo-dev-admin (the development default)
#   KAIRO_PROJECT_NAME default "Demo Project"
#
# Output: prints the project ID and the raw API key (shown only here,
# exactly like the API returns it only at creation time) and the seeded
# trace ID.
set -euo pipefail

ADDR="${KAIRO_ADDR:-http://localhost:8080}"
ADMIN_TOKEN="${KAIRO_ADMIN_TOKEN:-kairo-dev-admin}"
PROJECT_NAME="${KAIRO_PROJECT_NAME:-Demo Project}"

command -v curl >/dev/null 2>&1 || { echo "error: curl is required" >&2; exit 1; }

echo "==> Checking Kairo API at ${ADDR}"
curl -fsS "${ADDR}/healthz" >/dev/null || { echo "error: ${ADDR}/healthz is not healthy — is the API running?" >&2; exit 1; }

json_field() {
  # json_field <json> <field> — extract a top-level-ish string field.
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval("d" + sys.argv[2]))' "$1" "$2"
  else
    echo "$1" | grep -o "\"$3\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//'
  fi
}

echo "==> Creating project '${PROJECT_NAME}'"
PROJECT_JSON="$(curl -fsS -X POST "${ADDR}/api/v1/projects" \
  -H "X-Admin-Token: ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d "{\"name\": \"${PROJECT_NAME}\"}")"
if command -v python3 >/dev/null 2>&1; then
  PROJECT_ID="$(json_field "${PROJECT_JSON}" "['id']")"
else
  PROJECT_ID="$(json_field "${PROJECT_JSON}" "" "id")"
fi
echo "    project_id: ${PROJECT_ID}"

echo "==> Creating API key"
KEY_JSON="$(curl -fsS -X POST "${ADDR}/api/v1/projects/${PROJECT_ID}/api-keys" \
  -H "X-Admin-Token: ${ADMIN_TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{}')"
if command -v python3 >/dev/null 2>&1; then
  RAW_KEY="$(json_field "${KEY_JSON}" "['raw_key']")"
else
  RAW_KEY="$(json_field "${KEY_JSON}" "" "raw_key")"
fi
echo "    api_key (shown only once — store it now): ${RAW_KEY}"

echo "==> Building OTLP sample payload"
PAYLOAD_FILE="$(mktemp)"
TRACE_ID_FILE="$(mktemp)"
trap 'rm -f "${PAYLOAD_FILE}" "${TRACE_ID_FILE}"' EXIT
if command -v python3 >/dev/null 2>&1; then
  python3 - "${PAYLOAD_FILE}" "${TRACE_ID_FILE}" <<'PYEOF'
import json, os, sys, time

out = sys.argv[1]
trace_id_out = sys.argv[2]
trace_id = os.urandom(16)
def sid(n):
    b = bytearray(os.urandom(8))
    return bytes(b)
span_ids = [sid(i) for i in range(4)]
now = time.time_ns()
ms = 1_000_000
def span(idx, name, kind, parent, start_off, dur, svc_status="STATUS_CODE_OK"):
    s = {
        "traceId": trace_id.hex(),
        "spanId": span_ids[idx].hex(),
        "name": name,
        "kind": kind,
        "startTimeUnixNano": str(now + start_off),
        "endTimeUnixNano": str(now + start_off + dur),
        "status": {"code": svc_status},
        "attributes": [{"key": "seed.source", "value": {"stringValue": "seed-demo"}}],
    }
    if parent is not None:
        s["parentSpanId"] = span_ids[parent].hex()
    return s

spans = [
    span(0, "POST /checkout", 2, None, 0, 42 * ms),
    span(1, "GET /reserve", 2, 0, 2 * ms, 9 * ms),
    span(2, "POST /charge", 2, 0, 13 * ms, 18 * ms),
    span(3, "POST /notify", 2, 0, 33 * ms, 6 * ms),
]
payload = {
    "resourceSpans": [{
        "resource": {"attributes": [
            {"key": "service.name", "value": {"stringValue": "checkout"}},
            {"key": "telemetry.sdk.name", "value": {"stringValue": "kairo-seed"}},
        ]},
        "scopeSpans": [{"scope": {"name": "kairo/seed", "version": "1.0.0"}, "spans": spans}],
    }]
}
with open(out, "w") as f:
    json.dump(payload, f)
with open(trace_id_out, "w") as f:
    f.write(trace_id.hex())
PYEOF
  TRACE_ID="$(cat "${TRACE_ID_FILE}")"
else
  # Fallback: fixed hex IDs (OTLP/JSON encodes trace/span IDs as hex) and
  # date-derived timestamps. Re-running re-delivers
  # the same spans; ingestion deduplicates them.
  NOW_S="$(date +%s)"
  START_NS="${NOW_S}000000000"
  cat > "${PAYLOAD_FILE}" <<EOF
{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"checkout"}},{"key":"telemetry.sdk.name","value":{"stringValue":"kairo-seed"}}]},"scopeSpans":[{"scope":{"name":"kairo/seed","version":"1.0.0"},"spans":[
{"traceId":"30313233343536373839616263646566","spanId":"7365656473706e31","name":"POST /checkout","kind":2,"startTimeUnixNano":"${START_NS}","endTimeUnixNano":"$((NOW_S + 1))000000000","status":{"code":"STATUS_CODE_OK"},"attributes":[{"key":"seed.source","value":{"stringValue":"seed-demo"}}]},
{"traceId":"30313233343536373839616263646566","spanId":"7365656473706e32","parentSpanId":"7365656473706e31","name":"GET /reserve","kind":2,"startTimeUnixNano":"${START_NS}","endTimeUnixNano":"$((NOW_S + 1))000000000","status":{"code":"STATUS_CODE_OK"}}
]}]}]}
EOF
  TRACE_ID="30313233343536373839616263646566"
fi

echo "==> Ingesting sample trace ${TRACE_ID}"
curl -fsS -X POST "${ADDR}/v1/traces" \
  -H "Authorization: Bearer ${RAW_KEY}" \
  -H 'Content-Type: application/json' \
  --data-binary "@${PAYLOAD_FILE}" >/dev/null
echo "    ingested OK"

echo
echo "Seed complete."
echo "  project_id: ${PROJECT_ID}"
echo "  api_key:    ${RAW_KEY}"
echo "  trace_id:   ${TRACE_ID}"
echo "Explore it at ${ADDR}/api/v1/traces/${TRACE_ID}?project_id=${PROJECT_ID} (with the API key or admin token)."
