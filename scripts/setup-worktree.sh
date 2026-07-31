#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

minimum_node_major=20
recommended_node_major=22
node_major="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1 || true)"
if [[ -z "$node_major" || "$node_major" -lt "$minimum_node_major" ]]; then
  echo "CivJS requires Node.js ${minimum_node_major} or newer. Found: ${node_major:-not installed}." >&2
  echo "Install/switch to the version in .nvmrc, then rerun this script." >&2
  exit 1
fi
if [[ "$node_major" != "$recommended_node_major" ]]; then
  echo "Warning: recommended Node.js version is ${recommended_node_major}; found ${node_major}." >&2
fi

npm_version="$(npm --version)"
npm_major="${npm_version%%.*}"
if (( npm_major < 10 )); then
  echo "CivJS requires npm 10 or newer. Found npm ${npm_version}." >&2
  exit 1
fi

echo "Installing root dependencies..."
npm ci

echo "Installing client dependencies..."
(cd apps/client && npm ci)

echo "Installing server dependencies..."
(cd apps/server && npm ci)

copy_env() {
  local template="$1"
  local destination="$2"
  if [[ ! -e "$destination" ]]; then
    cp "$template" "$destination"
    echo "Created $destination from $template"
  else
    echo "Keeping existing $destination"
  fi
}

copy_env apps/server/.env.example apps/server/.env
copy_env apps/client/.env.example apps/client/.env

if [[ "${INSTALL_PLAYWRIGHT_BROWSERS:-0}" == "1" ]] && command -v npx >/dev/null 2>&1; then
  echo "Installing the Chromium runtime used by end-to-end tests..."
  npx playwright install chromium
fi

echo
echo "Worktree setup complete. Run 'npm run verify' before pushing."
echo "For browser tests, rerun with INSTALL_PLAYWRIGHT_BROWSERS=1 if Chromium is not cached."
