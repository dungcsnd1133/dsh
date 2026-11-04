#!/bin/bash
set -euo pipefail
node /data/plugins/dsh-mobile-model-menu-20261104/patch-client.mjs \
  --root /usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules --apply
python3 /data/plugins/dsh-reliability-20261104/apply.py
exec python3 /data/plugins/dsh-reliability-20261104/keepalive.py \
  --name dsh-stack --group -- \
  /bin/bash /data/plugins/dsh-context-auto-20261104/startup.sh
