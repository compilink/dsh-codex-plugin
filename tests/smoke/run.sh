#!/bin/sh
set -eu
mkdir -p /data/home /data/cache /data/workspace /data/profiles/web
cat > /data/profiles/web/pnpm-workspace.yaml <<'YAML'
packages:
  - .
nodeLinker: hoisted
autoInstallPeers: false
YAML
node -e "const fs=require('node:fs'),http=require('node:http');http.createServer((q,r)=>fs.createReadStream('/artifact/pkg.tgz').pipe(r)).listen(13879,'127.0.0.1')" &
pkg=$!
trap 'kill "$pkg" 2>/dev/null || true' EXIT
node /opt/dsh/apps/cli/lib/bin.js plugin --profile web add --ignore-scripts http://127.0.0.1:13879/pkg.tgz
cp /qa/profile.yml /data/profiles/web/cordis.patch.yml
NODE_OPTIONS=--import=/qa/preload.mjs node /opt/dsh/apps/cli/lib/bin.js web --patch /qa/patch.yml --public-url http://127.0.0.1:3080 --no-open > /tmp/dsh-codex-smoke.log 2>&1 &
host=$!
trap 'kill "$pkg" "$host" 2>/dev/null || true' EXIT
node /qa/qa.mjs
