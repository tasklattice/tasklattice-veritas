#!/bin/sh
set -eu

# A new PVC starts empty; Docker named volumes may already contain these.
mkdir -p /var/lib/veritas/data /var/lib/veritas/runs \
  /var/lib/veritas/cache /var/lib/veritas/promptfoo
exec "$@"
