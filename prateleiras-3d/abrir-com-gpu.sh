#!/usr/bin/env bash
# Abre o Chrome com WebGL (atalho definitivo: ~/.local/bin/google-chrome-webgl).
set -euo pipefail
URL="${1:-http://127.0.0.1:5001/prateleiras-3d/}"
WRAP="${HOME}/.local/bin/google-chrome-webgl"
if [[ -x "$WRAP" ]]; then
  exec "$WRAP" --new-window "$URL"
fi
# Fallback se o wrapper ainda não existir
exec env -u __NV_PRIME_RENDER_OFFLOAD -u __GLX_VENDOR_LIBRARY_NAME \
  /usr/bin/google-chrome-stable \
  --ignore-gpu-blocklist --use-gl=angle --use-angle=gl \
  --new-window "$URL"
