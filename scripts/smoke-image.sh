#!/usr/bin/env bash
# Builds the image, boots it, and checks the two acceptance claims that do not
# need a phone: health answers, and /metrics rejects an unauthenticated scrape.
set -euo pipefail

image="${IMAGE:-oktoso:smoke}"
port="${PORT:-18787}"
root="$(mktemp -d)"
container="oktoso-smoke-$$"

cleanup() {
  podman rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$root"
}
trap cleanup EXIT

podman build -t "$image" .

mkdir -p "$root/data"
cat >"$root/data/hub.config.json" <<JSON
{
  "host": "0.0.0.0",
  "port": 8787,
  "token": "smoke-token-00000000000000000001",
  "dataDir": "/data",
  "providers": []
}
JSON
chmod 700 "$root/data"
chmod 600 "$root/data/hub.config.json"

# Rootless podman maps container uids differently; keep-id lets the image's
# `node` user own the host directory without chowning it.
podman run -d --userns=keep-id --name "$container" -p "$port:8787" \
  -v "$root/data:/data:Z" "$image" >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/api/v1/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

health="$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v1/health")"
unauth="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/metrics")"
auth="$(curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer smoke-token-00000000000000000001" "http://127.0.0.1:$port/metrics")"

echo "image health=$health metrics_unauth=$unauth metrics_auth=$auth"
test "$health" = "200"
test "$unauth" = "401"
test "$auth" = "200"
