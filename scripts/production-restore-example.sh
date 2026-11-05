#!/usr/bin/env bash
set -euo pipefail

# DO NOT RUN DIRECTLY ON PRODUCTION WITHOUT CONFIRMATION.
#
# This is a reference template only. It intentionally performs no restore.
# Review the selected backup, take a fresh backup first, and obtain explicit
# confirmation before adapting the commented commands below.

cat <<'EOF'
DBS-Operations-OS restore reference

1. Identify a backup folder, for example:
   /var/www/dbs-operations-os/shared/backups/2026-07-25_02-30-00

2. Verify the manifest and archives before restoring:
   cat <backup-folder>/manifest.txt
   gzip -t <backup-folder>/database.sql.gz
   tar -tzf <backup-folder>/uploads.tar.gz

3. Take a fresh backup before any restore.

4. Restore the database only after confirmation. Keep database credentials in
   a protected MySQL defaults file outside Git (for example /root/.my.cnf):

   # gunzip -c <backup-folder>/database.sql.gz \
   #   | mysql --defaults-extra-file=/root/.my.cnf dbs_operations_os

5. Restore uploads only after confirmation. Preserve or move the current
   uploads directory first, then restore into the shared uploads path:

   # mkdir -p /var/www/dbs-operations-os/shared/uploads
   # tar -xzf <backup-folder>/uploads.tar.gz \
   #   -C /var/www/dbs-operations-os/shared/uploads

6. Validate the application and data after restore. Do not restore or modify
   the separate WhatsApp Automation project.
EOF
