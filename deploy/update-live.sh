#!/usr/bin/env bash
#
# Puts this Mac's Beam Craft live at https://beamcraft.tech (+ api.beamcraft.tech) - one command:
#
#     ./deploy/update-live.sh
#
# 1. builds the website here (not on the server, which also runs DBS);
# 2. uploads the code - never the server's .env, uploads, sessions or database;
# 3. backs up the live database (beamcraft_db) before changing anything;
# 4. installs, applies any new database migrations, restarts ONLY beamcraft-api / beamcraft-web;
# 5. checks the live site and says whether it worked.
#
# Packages install with --ignore-scripts: the copied DBS code carries ffmpeg-static and puppeteer, whose
# download scripts hang on this server, and Beam Craft uses neither (workers and AI are off in its .env).
#
# Needs: the SSH key added in hPanel (~/.ssh/id_ed25519). Commit to GitHub first, so what is live is
# also what is in GitHub.
set -euo pipefail

SERVER="root@187.127.175.210"
APP_DIR="/var/www/beamcraft"
SITE="https://beamcraft.tech"
API="https://api.beamcraft.tech"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="${TMPDIR:-/tmp}/beamcraft-live-build"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m❌ %s\033[0m\n' "$1"; exit 1; }

say "Checking"
ssh -o BatchMode=yes -o ConnectTimeout=15 "$SERVER" true || fail "Cannot reach the server. Is the SSH key added in hPanel?"
if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "⚠️  You have changes that are not committed to GitHub. They will go live anyway."
  read -r -p "Continue? (y/N) " answer; [ "$answer" = "y" ] || exit 0
fi

say "Building the website on this Mac"
R2_PUBLIC=$(ssh -o BatchMode=yes "$SERVER" "grep '^R2_PUBLIC_BASE_URL=' $APP_DIR/backend/.env | cut -d= -f2- | tr -d '\"'")
VERSION=$(cat "$ROOT/VERSION" 2>/dev/null || echo 1.0)
rm -rf "$BUILD"; mkdir -p "$BUILD"
rsync -a --exclude '.next/' --exclude 'node_modules/' --exclude '.env*' "$ROOT/frontend/" "$BUILD/frontend/"
cp -cR "$ROOT/frontend/node_modules" "$BUILD/frontend/node_modules" 2>/dev/null || cp -R "$ROOT/frontend/node_modules" "$BUILD/frontend/node_modules"
cat > "$BUILD/frontend/.env.production.local" <<EOF
NEXT_PUBLIC_API_URL=$API
NEXT_PUBLIC_SITE_URL=$SITE
NEXT_PUBLIC_PUBLIC_APP_URL=$SITE
NEXT_PUBLIC_R2_PUBLIC_BASE_URL=$R2_PUBLIC
NEXT_PUBLIC_APP_VERSION=$VERSION
EOF
# `npm run build` is the project's own (webpack, as DBS builds it). It downloads Google fonts, which
# now and then fails for a moment, so one failed build is tried again before giving up.
build() { (cd "$BUILD/frontend" && rm -rf .next && NODE_ENV=production npm run build) > "$BUILD/build.log" 2>&1; }
build || { echo "first build failed - trying once more"; build; } || { tail -30 "$BUILD/build.log"; fail "The website did not build. Nothing was changed on the server."; }
echo "built"

say "Backing up the live database"
ssh -o BatchMode=yes "$SERVER" 'set -e; mkdir -p /root/backups/beamcraft; F=/root/backups/beamcraft/beamcraft_db-$(date +%Y%m%d-%H%M%S).sql.gz
  mysqldump --single-transaction --no-tablespaces beamcraft_db | gzip > "$F"; echo "saved $F ($(du -h "$F" | cut -f1))"
  ls -1t /root/backups/beamcraft/*.sql.gz | tail -n +31 | xargs -r rm --'

say "Uploading"
# --delete removes files deleted here; the excluded server-only files are never touched.
rsync -az --delete \
  --exclude 'node_modules/' --exclude '.next/' --exclude '.git/' --exclude '.env' --exclude '.env.*' \
  --exclude '/backend/uploads/' --exclude '.whatsapp-sessions/' --exclude 'backups/' --exclude '.superpowers/' \
  --exclude '.tmp-controller-merge/' --exclude '.vscode/' --exclude '.DS_Store' --exclude 'logs/' --exclude '*.log' \
  "$ROOT/" "$SERVER:$APP_DIR/"
rsync -az --delete --exclude 'cache/' "$BUILD/frontend/.next/" "$SERVER:$APP_DIR/frontend/.next/"
rsync -az "$BUILD/frontend/.env.production.local" "$SERVER:$APP_DIR/frontend/"

say "Installing, migrating, restarting Beam Craft only"
ssh -o BatchMode=yes "$SERVER" "set -e
  cd $APP_DIR/backend && nice -n 15 npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null && npx prisma generate >/dev/null && npx prisma migrate deploy | tail -1
  cd $APP_DIR/frontend && nice -n 15 npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null
  pm2 restart beamcraft-api beamcraft-web --update-env >/dev/null && echo restarted"

say "Checking the live site"
sleep 12
api=$(curl -s -m 20 "$API/api/health" || true)
page=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "$SITE/" || true)
echo "api: $api"; echo "home page: $page"
case "$api" in *'"ok":true'*) [ "$page" = "200" ] && { printf '\n\033[32m✅ Beam Craft is live with this version.\033[0m\n'; exit 0; } ;; esac
fail "The live check failed. Look at: ssh $SERVER 'pm2 logs beamcraft-api --lines 50'"
