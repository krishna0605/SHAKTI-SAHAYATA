#!/bin/sh
set -eu

ensure_dependency() {
  package_name="$1"

  if node -e "require.resolve('${package_name}/package.json')" >/dev/null 2>&1; then
    return 0
  fi

  echo "Missing dependency '${package_name}'. Running npm install to refresh /app/node_modules..."
  npm install
}

ensure_dependency "prom-client"

exec npx nodemon index.js
