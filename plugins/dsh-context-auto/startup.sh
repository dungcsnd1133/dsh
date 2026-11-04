#!/bin/bash
set -euo pipefail
# The bundle and this launcher are on the persistent Railway volume.
node /data/plugins/dsh-context-auto-20261104/patch-native.mjs \
  --root /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules --apply
# Preserve the deployed Safari authentication handoff before normal startup.
exec /bin/bash /data/plugins/dsh-safari-redirect-20261104/auth-startup.sh
