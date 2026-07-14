#!/usr/bin/env bash
# Altitude dispatcher (TEP-21/SP-2 — subject fidelity): run the per-AC held-out
# probe in whichever harness its FILE SHAPE declares, under one {spec}/{ac}
# template. A component-level criterion is authored as
#   src/acceptance/SP-{spec}_AC-{ac}.test.ts   → node:test, headless
# and a surface-level criterion as
#   src/acceptance/SP-{spec}_AC-{ac}.host.ts   → a real VS Code extension host
#                                                (xvfb, via runAcceptanceHost)
# so the probe's altitude can match the criterion's subject — the fix for the
# recipe that hardcoded node:test and turned every surface AC into a component
# probe (the SP-21/1 car/tricycle failure).
set -euo pipefail
spec="$1"
ac="$2"
node_probe="out-test/acceptance/SP-${spec}_AC-${ac}.test.js"
host_probe="out-test/acceptance/SP-${spec}_AC-${ac}.host.js"
if [ -f "$host_probe" ]; then
  # `// TANDEM_PHASES=N` in the probe → N sequential FRESH extension hosts
  # (phase 0 authors state, phase 1 asserts it survived the restart).
  phases=$(grep -oE 'TANDEM_PHASES=[0-9]+' "$host_probe" | head -1 | cut -d= -f2)
  exec xvfb-run -a node out-test/harness/runAcceptanceHost.js "$host_probe" "${phases:-1}"
elif [ -f "$node_probe" ]; then
  exec node --test "$node_probe"
else
  echo "no probe found for SP-${spec} AC-${ac} (expected ${node_probe} or ${host_probe})" >&2
  exit 127
fi
