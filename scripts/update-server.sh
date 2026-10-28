#!/usr/bin/env bash
# Updates the Projektor server on the LAN box to the latest pushed main and waits until it is healthy.
# Push first: the box pulls from GitHub, not from this checkout.
#   scripts/update-server.sh
# Override the target with PROJEKTOR_HOST (ssh destination) and PROJEKTOR_SRC (checkout on the box).
set -euo pipefail

HOST="${PROJEKTOR_HOST:-izzan@192.168.100.20}"
SRC="${PROJEKTOR_SRC:-~/projektor/src}"

ssh -o BatchMode=yes "$HOST" "SRC=$SRC bash -s" <<'REMOTE'
set -euo pipefail
cd "${SRC/#\~/$HOME}"
git pull -q --ff-only
echo "==> Building $(git log --oneline -1)"
docker compose -f deploy/docker-compose.yml up -d --build 2>&1 | tail -3
for _ in $(seq 60); do
  status=$(docker inspect -f '{{.State.Health.Status}}' projektor 2>/dev/null || true)
  if [ "$status" = healthy ]; then
    echo "==> Healthy: $(curl -fsS localhost:8096/api/health)"
    exit 0
  fi
  sleep 2
done
echo "Server did not become healthy; recent logs:" >&2
docker logs --tail 30 projektor >&2
exit 1
REMOTE
