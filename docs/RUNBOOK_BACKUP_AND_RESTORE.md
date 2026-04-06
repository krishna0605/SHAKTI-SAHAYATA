# Runbook: Backup And Restore

## Backup Strategy
SHKATI backup bundles contain:
- `database.sql`
- `uploads.tar.gz`
- `manifest.json`

Bundles are written under:
- `ops/backups/<timestamp>/`

Runtime status files:
- `ops/runtime/backup-status.json`
- `ops/runtime/restore-status.json`

## Manual Backup

```powershell
cd "C:\Users\ADMIN\Desktop\kavish\old new porject\shakti"
npm run backup
```

Optional off-machine copy:
- set `BACKUP_OFFSITE_DIR`

Example:

```powershell
$env:BACKUP_OFFSITE_DIR="D:\ShaktiBackups"
npm run backup
```

## Restore Drill

```powershell
cd "C:\Users\ADMIN\Desktop\kavish\old new porject\shakti"
npm run restore -- --bundle "ops/backups/<timestamp>"
```

Default behavior:
- creates an isolated restore database
- restores DB dump
- extracts uploads archive
- verifies seed user presence and basic counts
- records restore metadata

## What To Validate After Restore
- restore command exits successfully
- `ops/runtime/restore-status.json` shows `verified`
- restored case count is non-zero when bundle manifest expects cases
- upload count matches manifest
- admin login works in the restored environment if attached to a test stack

## Retention Policy
- daily backups: 14 days
- weekly backups: 8 weeks
- pre-change snapshots: until next verified release cycle

## Recommended Scheduler Pattern
- nightly backup
- pre-deploy backup
- pre-maintenance backup
- weekly restore drill

## Failure Procedure
- if backup fails:
  - inspect container reachability
  - inspect disk space
  - inspect `ops/runtime/backup-status.json`
- if restore fails:
  - inspect bundle completeness
  - inspect `database.sql` validity
  - inspect `uploads.tar.gz` checksum in `manifest.json`
