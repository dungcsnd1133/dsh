#!/bin/bash
set -euo pipefail
python3 /data/plugins/dsh-reliability-20261104/apply.py
exec python3 /data/plugins/dsh-reliability-20261104/keepalive.py \
  --name dsh-stack --group -- \
  /bin/bash /data/plugins/dsh-context-auto-20261104/startup.sh
