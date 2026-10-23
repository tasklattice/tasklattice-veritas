#!/usr/bin/env bash
# Run only on disposable GitHub-hosted runners, never against an operator's app.
set -euo pipefail
if [[ "${GITHUB_ACTIONS:-}" != true ]]; then
  printf '%s\n' 'Container verification belongs in GitHub Actions.' >&2
  exit 1
fi
image=${1:?Usage: ci-container-smoke.sh IMAGE}
container="veritas-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"
volume="${container}-state"
cleanup() {
  result=$?
  if (( result != 0 )); then docker logs "$container" 2>/dev/null || true; fi
  docker rm -f "$container" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT
docker volume create "$volume" >/dev/null
start() {
  docker run -d --init --name "$container" --read-only \
    --cap-drop=ALL --security-opt=no-new-privileges --tmpfs /tmp \
    -p 127.0.0.1:38100:38100 \
    --mount "type=volume,source=$volume,target=/var/lib/veritas" \
    "$image" >/dev/null
  for attempt in {1..60}; do
    if curl --fail --silent http://127.0.0.1:38100/healthz >/dev/null; then return; fi
    sleep 2
  done
  printf '%s\n' 'Veritas did not become healthy within 120 seconds.' >&2
  return 1
}
start
curl --fail --silent http://127.0.0.1:38100/ | grep -q '<html'
# Loading this native module catches an incorrect prebuilt CPU architecture.
docker exec "$container" node -e "require('lzma-native')"
# Runs bundled synthetic cases, local mocks and zero-traffic offline re-scoring.
docker exec "$container" npm run test:integration
verify_reports() {
  docker exec "$container" node --input-type=module -e '
    import assert from "node:assert/strict";
    const response = await fetch("http://127.0.0.1:38100/api/runs");
    assert.equal(response.status, 200);
    const {items} = await response.json();
    assert.equal(items.length, 2, "Both protocol Reports must be persisted");
    console.log("Persisted Reports:", items.length);
  '
}
verify_reports
docker stop --time 30 "$container" >/dev/null
docker rm "$container" >/dev/null
start
verify_reports
