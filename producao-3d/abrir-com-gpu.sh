#!/usr/bin/env bash
# Abre o Chrome com WebGL (atalho definitivo: ~/.local/bin/google-chrome-webgl).
set -euo pipefail
URL="${1:-http://127.0.0.1:5001/producao-3d/}"
WRAP="${HOME}/.local/bin/google-chrome-webgl"
if [[ -x "$WRAP" ]]; then
  exec "$WRAP" --new-window "$URL"
fi
# Fallback se o wrapper ainda não existir (perfil próprio = processo novo garantido)
PROFILE="${HOME}/.config/google-chrome-webgl"
mkdir -p "$PROFILE"
exec env -u __NV_PRIME_RENDER_OFFLOAD -u __GLX_VENDOR_LIBRARY_NAME -u __VK_LAYER_NV_optimus \
  /usr/bin/google-chrome-stable \
  --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  --ignore-gpu-blocklist --enable-unsafe-swiftshader \
  --use-gl=angle --use-angle=gl \
  --new-window "$URL"
