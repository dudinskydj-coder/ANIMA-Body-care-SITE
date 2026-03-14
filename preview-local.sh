#!/bin/zsh

set -euo pipefail

port="${1:-4173}"

if command -v python3 >/dev/null 2>&1; then
  echo "Open http://localhost:${port}/admin-prices.html"
  echo "Open http://localhost:${port}/Laser%204.html"
  exec python3 -m http.server "$port"
fi

if command -v deno >/dev/null 2>&1; then
  echo "Open http://localhost:${port}/admin-prices.html"
  echo "Open http://localhost:${port}/Laser%204.html"
  exec deno serve --allow-read --port "$port"
fi

echo "Neither python3 nor deno is available for a local preview server." >&2
exit 1
