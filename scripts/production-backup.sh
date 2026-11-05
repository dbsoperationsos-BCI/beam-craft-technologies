#!/usr/bin/env bash
set -euo pipefail

readonly APP_PATH="/var/www/dbs-operations-os/current"
readonly SHARED_PATH="/var/www/dbs-operations-os/shared"
readonly ENV_FILE="${SHARED_PATH}/env/backend.env"
readonly UPLOADS_PATH="${SHARED_PATH}/uploads"
readonly BACKUP_ROOT="${SHARED_PATH}/backups"
readonly RETENTION_COUNT=7

umask 077

log() {
  printf '[dbs-backup] %s\n' "$*"
}

fail() {
  printf '[dbs-backup] ERROR: %s\n' "$*" >&2
  exit 1
}

trap 'printf "[dbs-backup] ERROR: backup failed. Review the messages above.\n" >&2' ERR

[[ -r "$ENV_FILE" ]] || fail "Backend environment file is not readable: $ENV_FILE"
command -v mysqldump >/dev/null 2>&1 || fail "mysqldump is not installed or not on PATH"
command -v node >/dev/null 2>&1 || fail "node is required to safely parse DATABASE_URL"
command -v gzip >/dev/null 2>&1 || fail "gzip is not installed or not on PATH"
command -v tar >/dev/null 2>&1 || fail "tar is not installed or not on PATH"

# Read only DATABASE_URL. Do not source this file because it may contain values
# that are not intended for shell evaluation.
database_url_line="$(grep -E '^[[:space:]]*DATABASE_URL=' "$ENV_FILE" | tail -n 1 || true)"
[[ -n "$database_url_line" ]] || fail "DATABASE_URL is missing from $ENV_FILE"
database_url="${database_url_line#*=}"
database_url="${database_url#\"}"
database_url="${database_url%\"}"
database_url="${database_url#\'}"
database_url="${database_url%\'}"

# Use Node's URL parser so URL-encoded user names and passwords are handled
# correctly. Nothing from this output is logged.
mapfile -t database_parts < <(printf '%s' "$database_url" | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try {
      const url = new URL(input.trim());
      if (!/^mysql:$/i.test(url.protocol)) throw new Error("DATABASE_URL must use mysql://");
      const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
      if (!url.username || !database) throw new Error("DATABASE_URL must include a user and database name");
      console.log(decodeURIComponent(url.username));
      console.log(decodeURIComponent(url.password));
      console.log(url.hostname || "127.0.0.1");
      console.log(url.port || "3306");
      console.log(database);
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
  });
') || fail "DATABASE_URL could not be parsed"

[[ "${#database_parts[@]}" -eq 5 ]] || fail "DATABASE_URL did not produce complete MySQL connection details"
database_user="${database_parts[0]}"
database_password="${database_parts[1]}"
database_host="${database_parts[2]}"
database_port="${database_parts[3]}"
database_name="${database_parts[4]}"

timestamp="$(date '+%Y-%m-%d_%H-%M-%S')"
backup_dir="${BACKUP_ROOT}/${timestamp}"
[[ "$backup_dir" == "${BACKUP_ROOT}/"* ]] || fail "Resolved backup path is unsafe"

mkdir -p "$backup_dir"
log "Starting backup for database ${database_name}"

export MYSQL_PWD="$database_password"
mysqldump \
  --host="$database_host" \
  --port="$database_port" \
  --user="$database_user" \
  --single-transaction \
  --routines \
  --events \
  --triggers \
  --databases "$database_name" \
  | gzip -c > "${backup_dir}/database.sql.gz"
unset MYSQL_PWD
unset database_password

if [[ -d "$UPLOADS_PATH" ]] && [[ -n "$(find "$UPLOADS_PATH" -mindepth 1 -print -quit)" ]]; then
  tar -C "$UPLOADS_PATH" -czf "${backup_dir}/uploads.tar.gz" .
  uploads_backup="uploads.tar.gz"
else
  printf 'No upload files were present at backup time.\n' > "${backup_dir}/uploads-not-present.txt"
  uploads_backup="uploads-not-present.txt"
fi

cat > "${backup_dir}/manifest.txt" <<EOF
DBS-Operations-OS production backup
Created: $(date -Is)
Database: ${database_name}
Application path: ${APP_PATH}
Uploads path: ${UPLOADS_PATH}
Files:
- database.sql.gz
- ${uploads_backup}
EOF

# Retention applies only to timestamp-shaped folders inside DBS's backup root.
# It never touches the separate WhatsApp Automation project or its files.
mapfile -t backup_folders < <(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '????-??-??_??-??-??' -printf '%f\n' | LC_ALL=C sort -r)
for ((index=RETENTION_COUNT; index<${#backup_folders[@]}; index++)); do
  expired_backup="${BACKUP_ROOT}/${backup_folders[$index]}"
  [[ "$expired_backup" == "${BACKUP_ROOT}/"* ]] || fail "Retention target is unsafe"
  rm -rf -- "$expired_backup"
  log "Removed expired backup folder ${backup_folders[$index]}"
done

log "Backup completed successfully: $backup_dir"
