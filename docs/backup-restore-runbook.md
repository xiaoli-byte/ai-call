# Backup and Restore Runbook

This runbook covers the single-tenant production baseline for PostgreSQL backups,
restore drills, and call recording retention. It does not change application
code or database schema.

## Scope

- PostgreSQL logical backups created with `scripts/db-backup.ps1`.
- Restore drills into an isolated, empty database with `scripts/db-restore-check.ps1`.
- Recording files referenced by call/task rows, including local FreeSWITCH files
  and object storage copies.

## Safety Rules

- Never restore into the production `DATABASE_URL`.
- Restore only into an empty, isolated database created for the drill or incident.
- Stop API workers, schedulers, outbox consumers, and FreeSWITCH event workers
  before pointing any application process at a restored database.
- The restore script refuses to execute `psql` unless `-ConfirmRestore` is set.
  Use `-DryRun` first and inspect the redacted target URL.
- These scripts do not drop databases, truncate tables, or delete files. If a
  database must be recreated, do that with the managed database console or an
  explicit DBA runbook outside these scripts.
- Treat dump files as sensitive production data. Encrypt them at rest and avoid
  pasting full connection URLs into shared logs.
- The default `backups/postgres` path is inside the repository workspace. Do not
  commit dump files; move them to encrypted off-host storage or use a local
  exclude rule for operator machines.

## Backup Frequency

- Run a full logical PostgreSQL backup daily during the lowest traffic window.
- Run an extra backup before migrations, bulk imports, or risky operational work.
- For production RPO below 24 hours, enable managed PostgreSQL PITR/WAL archival
  or snapshots in addition to this logical backup script.
- Retain at least 7 daily backups, 4 weekly backups, and 3 monthly backups unless
  a stricter compliance policy applies.
- Store backups off-host in encrypted storage. A backup that only lives on the
  application server is not a recovery plan.

Example dry-run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1 `
  -DryRun `
  -DatabaseUrl "postgresql://backup_user:secret@db.example.com:5432/ai_call"
```

Example real backup:

```powershell
$env:DATABASE_URL = "postgresql://backup_user:secret@db.example.com:5432/ai_call"
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-backup.ps1
```

The default output directory is `backups/postgres`, and filenames include a UTC
timestamp such as `ai-call-postgres-20260707T030000Z.sql`.

## Restore Drill

Run a restore drill at least monthly and after major schema changes.

1. Pick the backup file and verify its SHA256 against the backup manifest.
2. Create a new empty restore database. Do not reuse production.
3. Run a dry-run and inspect the redacted target URL and commands:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-restore-check.ps1 `
  -DryRun `
  -BackupFile "backups\postgres\ai-call-postgres-20260707T030000Z.sql" `
  -TargetDatabaseUrl "postgresql://restore_user:secret@localhost:5432/ai_call_restore"
```

4. Run the restore only after checking the target again:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\db-restore-check.ps1 `
  -BackupFile "backups\postgres\ai-call-postgres-20260707T030000Z.sql" `
  -TargetDatabaseUrl "postgresql://restore_user:secret@localhost:5432/ai_call_restore" `
  -ConfirmRestore
```

5. Review core table counts printed by the script:

```sql
SELECT 'tenants' AS table_name, COUNT(*)::bigint AS row_count FROM "tenants"
UNION ALL
SELECT 'outbound_tasks' AS table_name, COUNT(*)::bigint AS row_count FROM "outbound_tasks"
UNION ALL
SELECT 'call_attempts' AS table_name, COUNT(*)::bigint AS row_count FROM "call_attempts"
UNION ALL
SELECT 'outbox_events' AS table_name, COUNT(*)::bigint AS row_count FROM "outbox_events"
ORDER BY table_name;
```

6. Compare counts with the backup-time manifest or production read-only counts
   taken at backup time. Differences must be understood before declaring success.
7. Start the API against the restore database in an isolated environment and run
   a read-only smoke check. Do not allow outbound calls from the drill.
8. Record the drill date, backup filename, restore duration, row-count summary,
   issues found, and the measured RTO.

## Recordings and Object Storage

- PostgreSQL rows can reference recordings through fields such as `recording_url`;
  the audio files are not inside the SQL dump.
- If recordings are local, include `freeswitch/recordings/` in a separate file
  backup job. Keep file timestamps and paths stable so restored database rows can
  still resolve their recordings.
- If recordings are in object storage, enable bucket versioning, lifecycle policy,
  encryption, and cross-zone or cross-region replication where available.
- During every drill, sample several restored `recording_url` values and verify
  the corresponding object or local file exists and is readable.
- Keep object storage credentials and bucket policy backups in the secrets and
  infrastructure runbooks, not in SQL dumps.

## RPO and RTO Targets

- Recommended database RPO: 15 minutes with managed PITR/WAL archival. If only
  daily logical dumps exist, the practical RPO is up to 24 hours.
- Recommended recording RPO: 1 hour or better for active call recordings; match
  stricter customer or compliance commitments when present.
- Recommended RTO: 60 to 120 minutes for a single-tenant restore into a prepared
  database environment.
- Revisit these targets after the first full restore drill. The measured restore
  time is the number to trust.

## Incident Restore Checklist

- Freeze writes: stop schedulers, task dispatch, outbox workers, and event workers.
- Identify the restore point and confirm whether recordings need separate restore.
- Restore PostgreSQL into a new database and run core table checks.
- Restore or reconnect recording storage before customer-facing read paths are
  enabled.
- Point one isolated application instance at the restored database and run smoke
  checks.
- Switch production traffic only after database, recordings, auth, and outbound
  call safety checks pass.
