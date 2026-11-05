# DBS-Operations-OS Backup and Restore

## What is backed up

`scripts/production-backup.sh` creates a timestamped backup folder containing:

- `database.sql.gz`: a compressed MySQL dump of `dbs_operations_os`, including database creation statements, routines, events, and triggers.
- `uploads.tar.gz`: a compressed archive of `/var/www/dbs-operations-os/shared/uploads` when files exist.
- `uploads-not-present.txt`: written instead of an archive when uploads are missing or empty.
- `manifest.txt`: backup timestamp, paths, database name, and created backup files.

The script retains the latest seven timestamped backup folders under `/var/www/dbs-operations-os/shared/backups`.

## Backup location

```text
/var/www/dbs-operations-os/shared/backups/YYYY-MM-DD_HH-mm-ss
```

Backups are stored outside the deployed Git checkout so that deployment changes do not overwrite them.

## Run a manual backup

On the VPS:

```bash
cd /var/www/dbs-operations-os/current
sudo bash scripts/production-backup.sh
```

The script reads `DATABASE_URL` from:

```text
/var/www/dbs-operations-os/shared/env/backend.env
```

It does not print the database password. Ensure the backup root is readable only by the appropriate server administrator account.

## Schedule a daily backup

Edit the root or deployment-user crontab on the VPS:

```bash
sudo crontab -e
```

Run daily at 2:30 AM server time:

```cron
30 2 * * * /usr/bin/bash /var/www/dbs-operations-os/current/scripts/production-backup.sh >> /var/www/dbs-operations-os/shared/backups/backup.log 2>&1
```

After adding the cron entry, run one manual backup and inspect the resulting folder before relying on the schedule.

## Check the latest backup

```bash
ls -ltd /var/www/dbs-operations-os/shared/backups/????-??-??_??-??-?? | head -n 1
```

Inspect its manifest and verify the archives:

```bash
cat /var/www/dbs-operations-os/shared/backups/<timestamp>/manifest.txt
gzip -t /var/www/dbs-operations-os/shared/backups/<timestamp>/database.sql.gz
tar -tzf /var/www/dbs-operations-os/shared/backups/<timestamp>/uploads.tar.gz
```

## Restore database

**Do not restore directly on production without confirmation.** First take a fresh backup and verify the selected archive.

Use a protected MySQL defaults file outside the repository, such as `/root/.my.cnf`, rather than putting a password in shell history:

```bash
gunzip -c /var/www/dbs-operations-os/shared/backups/<timestamp>/database.sql.gz \
  | mysql --defaults-extra-file=/root/.my.cnf dbs_operations_os
```

The reference-only `scripts/production-restore-example.sh` documents this process and intentionally performs no destructive action.

## Restore uploads

**Do not overwrite current uploads without confirmation.** Preserve or move the current uploads directory first, then restore:

```bash
mkdir -p /var/www/dbs-operations-os/shared/uploads
tar -xzf /var/www/dbs-operations-os/shared/backups/<timestamp>/uploads.tar.gz \
  -C /var/www/dbs-operations-os/shared/uploads
```

If the backup contains `uploads-not-present.txt`, there were no uploads to restore.

## Safety notes

- Never commit backup archives, SQL dumps, credentials, SMTP app passwords, or other secrets.
- Test a restore in a safe environment before relying on backups during an incident.
- Backups cover only DBS-Operations-OS database and uploads.
- The WhatsApp Automation project is separate and remains untouched by these scripts and instructions.
- The backup script never stops PM2 applications and never deletes files outside the DBS backup root.
