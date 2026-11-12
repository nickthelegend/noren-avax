#!/usr/bin/env bash
# Fetch Ava Labs eERC circuit artifacts (wasm + zkey) at the pinned upstream commit.
# They match the prod verifiers vendored in contracts/src/vendor/eerc/prod.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMMIT="$(cat "$HERE/../contracts/src/vendor/eerc/UPSTREAM_COMMIT")"
OUT="$HERE/../web/public/circuits"
BASE="https://raw.githubusercontent.com/ava-labs/EncryptedERC/${COMMIT}/circom/build"
mkdir -p "$OUT"
for c in registration transfer withdraw; do
  mkdir -p "$OUT/$c"
  zkey="circuit_final.zkey"; [ "$c" = transfer ] && zkey="transfer.zkey"
  for f in "$c.wasm" "$zkey"; do
    [ -s "$OUT/$c/$f" ] || curl -fsSL "$BASE/$c/$f" -o "$OUT/$c/$f"
  done
done
echo "circuits in $OUT"
