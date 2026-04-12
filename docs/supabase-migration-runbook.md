# SHAKTI Supabase Migration Runbook

This repository now contains the application-side scaffolding for a managed Supabase rollout:

- Supabase-backed auth for officer and admin sign-in
- Supabase-backed storage for managed uploads and signed downloads
- Supabase-aware backend bootstrap flows
- Supabase migration SQL for the additive schema changes
- Migration cleanup inventory, quarantine, and delete-safe reporting

This runbook covers the operational steps still required to move a live environment from the legacy Docker Postgres flow to Supabase.

## 1. Provision Supabase

Create a Supabase project and capture:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_DB_URL_POOLER`
- `SUPABASE_DB_URL_DIRECT`
- `SUPABASE_JWKS_URL`

Create private storage buckets:

- `case-evidence`
- `admin-exports`
- `legacy-quarantine`

Recommended pilot settings:

- Disable email confirmations for the pilot if you want officer signup to complete in one flow.
- Keep storage buckets private.
- Do not expose the service role key to frontend clients.

## 2. Configure Local Development

Populate the new variables in [.env.example](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/.env.example:1) and your local `.env`.

Key runtime files:

- [backend/config/supabase.js](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/backend/config/supabase.js:1)
- [docker-compose.yml](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/docker-compose.yml:1)
- [docker-compose.dev.yml](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/docker-compose.dev.yml:1)
- [supabase/config.toml](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/supabase/config.toml:1)

Available scripts:

- `npm run supabase:start`
- `npm run supabase:stop`
- `npm run supabase:db:push`

## 3. Apply Database Changes

1. Import the existing SHAKTI baseline schema into Supabase.
2. Apply the additive migration in [supabase/migrations/20260412_add_supabase_migration_support.sql](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/supabase/migrations/20260412_add_supabase_migration_support.sql:1).
3. Verify the new schema objects exist:
   - `users.auth_user_id`
   - `admin_accounts.auth_user_id`
   - `uploaded_files.storage_*`
   - `ingestion_jobs.storage_*`
   - `migration_cleanup_reports`
   - `migration_cleanup_items`

Reference schema locations:

- [database/schema.sql](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/database/schema.sql:914)
- [supabase/migrations/20260412_add_supabase_migration_support.sql](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/supabase/migrations/20260412_add_supabase_migration_support.sql:1)

## 4. Migrate Auth

Officer and admin auth now support Supabase bootstrap flows:

- [backend/routes/auth.js](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/backend/routes/auth.js:398)
- [backend/routes/admin/auth.js](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/backend/routes/admin/auth.js:484)

Required live-data steps:

1. Create Supabase Auth users for current officers and admins.
2. Backfill `users.auth_user_id`.
3. Backfill `admin_accounts.auth_user_id`.
4. Leave legacy refresh/session tables in place during pilot rollback readiness.
5. After cutover verification, stop using legacy JWT refresh flows operationally.

## 5. Migrate Storage

Managed storage endpoints are now in:

- [backend/routes/files.js](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/backend/routes/files.js:328)
- [frontend/src/components/lib/apis.ts](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/frontend/src/components/lib/apis.ts:146)

Live migration steps:

1. Export or inventory current `backend/uploads`.
2. Upload retained evidence to `case-evidence`.
3. Upload quarantined legacy artifacts to `legacy-quarantine`.
4. Backfill `uploaded_files.storage_bucket` and `uploaded_files.storage_object_path`.
5. Validate signed download access for officer and admin flows.

## 6. Run Cleanup Inventory

The migration cleanup layer is available in:

- [backend/services/admin/adminMigrationCleanup.service.js](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/backend/services/admin/adminMigrationCleanup.service.js:1)
- [backend/routes/admin/migrationCleanup.js](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/backend/routes/admin/migrationCleanup.js:1)
- [frontend/src/admin/pages/AdminMigrationCleanupPage.tsx](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/frontend/src/admin/pages/AdminMigrationCleanupPage.tsx:1)

Recommended execution order:

1. Run inventory.
2. Review bootstrap identities, orphaned uploads, runtime artifacts, and restore workspaces.
3. Quarantine only after the report looks correct.
4. Delete only after Supabase parity checks pass and rollback bundles exist.

## 7. Cut Over Runtime Services

Supabase-aware runtime configuration is now wired into:

- [backend/config/database.js](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/backend/config/database.js:1)
- [backend/middleware/auth.js](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/backend/middleware/auth.js:1)
- [backend/middleware/admin/authenticateAdminToken.js](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/backend/middleware/admin/authenticateAdminToken.js:1)
- [frontend/src/lib/supabase.ts](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/frontend/src/lib/supabase.ts:1)
- [frontend/src/lib/apiClient.ts](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/frontend/src/lib/apiClient.ts:1)
- [frontend/src/admin/lib/adminApiClient.ts](/C:/Users/ADMIN/Desktop/kavish/old new porject/shakti/frontend/src/admin/lib/adminApiClient.ts:1)

Cutover sequence:

1. Freeze writes on the legacy environment.
2. Run final DB/file delta sync.
3. Point backend and AI services to Supabase Postgres.
4. Point officer and admin frontends to Supabase Auth.
5. Run smoke tests for login, signup, upload, download, dashboard, and cleanup reporting.

## 8. Verification Checklist

- Officer login succeeds through Supabase Auth.
- Admin login succeeds through Supabase Auth plus backend recent-auth.
- `GET /api/auth/bootstrap` returns the expected officer payload.
- `GET /api/admin/auth/bootstrap` returns the expected admin payload.
- `POST /api/files/upload-session` and `POST /api/files/complete-upload` succeed.
- `GET /api/files/:id/download-url` returns a valid signed URL for authorized users.
- Cleanup inventory reports expected keep/quarantine/delete-later counts.
- AI service can query Supabase Postgres successfully.

## 9. Rollback

Do not delete legacy assets until all of the following are true:

- Supabase DB row counts are reconciled
- Supabase storage parity checks are complete
- Cleanup report has been reviewed
- Rollback DB snapshot exists
- Rollback file archive exists

Keep the quarantine archive and DB snapshot for the full retention window before hard-deleting legacy artifacts.
