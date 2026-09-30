#!/bin/zsh
# Art direction helper: render a small preview with theme overrides, fast.
#
#   ./scripts/tune.sh renders/t1.png --set terrain.amplitude=900
#   THEME=desert ./scripts/tune.sh renders/d1.png --camera aerial
#
# Anything set with --set wins over the preset, so you can explore a parameter
# without editing a preset file. Quote the whole argument so '=' is not globbed.

cd "${0:A:h}/.."
out=${1:-renders/tune.png}
shift 2>/dev/null

bun run src/cli/index.ts -- \
  --seed "${SEED:-42}" \
  --theme "${THEME:-alpine}" \
  --out "$out" \
  --width "${W:-400}" --height "${H:-225}" \
  --quality "${QUALITY:-preview}" \
  "$@"
