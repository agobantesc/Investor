#!/bin/bash
# Corre TODAS las pruebas de Investor. Uso: bash automation/tests/correr.sh
cd "$(dirname "$0")/../.."
tot=0; mal=0
for f in automation/tests/test_*.js; do
  out=$(timeout 400 node "$f" 2>&1)
  ok=$(echo "$out" | grep -cE "^[0-9]+-[A-Z0-9-]+ OK")
  fa=$(echo "$out" | grep -cE " FALLA ")
  tot=$((tot+ok)); mal=$((mal+fa))
  printf '%-34s %3d OK  %2d FALLA\n' "$(basename "$f")" "$ok" "$fa"
  [ "$fa" -gt 0 ] && echo "$out" | grep -E " FALLA " | cut -c1-300 | sed 's/^/    /'
  echo "$out" | grep -E "^CRASH" | sed 's/^/    /'
done
echo ""
echo "TOTAL verificaciones=$tot fallos=$mal"
[ "$mal" -eq 0 ]
