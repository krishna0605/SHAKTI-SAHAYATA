-- Apply this after the baseline SHAKTI schema has been loaded into Supabase.
-- It adds the identity, storage, and cleanup metadata used by the
-- managed Supabase migration path.

ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS auth_user_id UUID,
    ADD COLUMN IF NOT EXISTS migration_cleanup_status VARCHAR(30) DEFAULT 'keep'
        CHECK (migration_cleanup_status IN ('keep', 'quarantine', 'delete_later', 'migrated', 'skipped')),
    ADD COLUMN IF NOT EXISTS migration_cleanup_reason TEXT,
    ADD COLUMN IF NOT EXISTS migration_quarantine_ref TEXT,
    ADD COLUMN IF NOT EXISTS migration_migrated_at TIMESTAMPTZ;

ALTER TABLE public.admin_accounts
    ADD COLUMN IF NOT EXISTS auth_user_id UUID,
    ADD COLUMN IF NOT EXISTS migration_cleanup_status VARCHAR(30) DEFAULT 'keep'
        CHECK (migration_cleanup_status IN ('keep', 'quarantine', 'delete_later', 'migrated', 'skipped')),
    ADD COLUMN IF NOT EXISTS migration_cleanup_reason TEXT,
    ADD COLUMN IF NOT EXISTS migration_quarantine_ref TEXT,
    ADD COLUMN IF NOT EXISTS migration_migrated_at TIMESTAMPTZ;

ALTER TABLE public.uploaded_files
    ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(30) DEFAULT 'local'
        CHECK (storage_provider IN ('local', 'supabase', 'quarantine')),
    ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
    ADD COLUMN IF NOT EXISTS storage_object_path TEXT,
    ADD COLUMN IF NOT EXISTS storage_object_version TEXT,
    ADD COLUMN IF NOT EXISTS storage_uploaded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS migration_cleanup_status VARCHAR(30) DEFAULT 'keep'
        CHECK (migration_cleanup_status IN ('keep', 'quarantine', 'delete_later', 'migrated', 'skipped')),
    ADD COLUMN IF NOT EXISTS migration_cleanup_reason TEXT,
    ADD COLUMN IF NOT EXISTS migration_quarantine_ref TEXT,
    ADD COLUMN IF NOT EXISTS migration_migrated_at TIMESTAMPTZ;

ALTER TABLE public.ingestion_jobs
    ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(30) DEFAULT 'local'
        CHECK (storage_provider IN ('local', 'supabase', 'quarantine')),
    ADD COLUMN IF NOT EXISTS storage_bucket TEXT,
    ADD COLUMN IF NOT EXISTS storage_object_path TEXT,
    ADD COLUMN IF NOT EXISTS storage_uploaded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS migration_cleanup_status VARCHAR(30) DEFAULT 'keep'
        CHECK (migration_cleanup_status IN ('keep', 'quarantine', 'delete_later', 'migrated', 'skipped')),
    ADD COLUMN IF NOT EXISTS migration_cleanup_reason TEXT,
    ADD COLUMN IF NOT EXISTS migration_quarantine_ref TEXT,
    ADD COLUMN IF NOT EXISTS migration_migrated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON public.users(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_accounts_auth_user_id ON public.admin_accounts(auth_user_id) WHERE auth_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_uploaded_files_storage_object ON public.uploaded_files(storage_bucket, storage_object_path);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_cleanup_status ON public.uploaded_files(migration_cleanup_status);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_storage_object ON public.ingestion_jobs(storage_bucket, storage_object_path);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_cleanup_status ON public.ingestion_jobs(migration_cleanup_status);

CREATE TABLE IF NOT EXISTS public.migration_cleanup_reports (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    generated_by_admin_id       INTEGER REFERENCES public.admin_accounts(id) ON DELETE SET NULL,
    status                      VARCHAR(30) NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'inventory_complete', 'quarantined', 'verified', 'delete_ready', 'archived')),
    classification_summary      JSONB NOT NULL DEFAULT '{}'::jsonb,
    totals_by_type              JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes                       TEXT,
    baseline_snapshot_ref       TEXT,
    quarantine_root             TEXT,
    rollback_bundle_ref         TEXT,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_migration_cleanup_reports_created_at ON public.migration_cleanup_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_migration_cleanup_reports_status ON public.migration_cleanup_reports(status);

CREATE TABLE IF NOT EXISTS public.migration_cleanup_items (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id                   UUID NOT NULL REFERENCES public.migration_cleanup_reports(id) ON DELETE CASCADE,
    item_type                   VARCHAR(40) NOT NULL,
    classification              VARCHAR(30) NOT NULL
                                CHECK (classification IN ('keep', 'quarantine', 'delete_later', 'migrated', 'skipped')),
    reason_code                 VARCHAR(80),
    reason_detail               TEXT,
    resource_id                 TEXT,
    linked_case_id              INTEGER REFERENCES public.cases(id) ON DELETE SET NULL,
    linked_file_id              INTEGER REFERENCES public.uploaded_files(id) ON DELETE SET NULL,
    linked_user_id              INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    linked_admin_account_id     INTEGER REFERENCES public.admin_accounts(id) ON DELETE SET NULL,
    source_path                 TEXT,
    quarantine_path             TEXT,
    metadata                    JSONB NOT NULL DEFAULT '{}'::jsonb,
    delete_eligible             BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at                  TIMESTAMPTZ,
    migrated_at                 TIMESTAMPTZ,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_migration_cleanup_items_report ON public.migration_cleanup_items(report_id);
CREATE INDEX IF NOT EXISTS idx_migration_cleanup_items_classification ON public.migration_cleanup_items(classification);
CREATE INDEX IF NOT EXISTS idx_migration_cleanup_items_item_type ON public.migration_cleanup_items(item_type);

ALTER TABLE public.officer_imports ALTER COLUMN imported_by DROP NOT NULL;
ALTER TABLE public.officer_imports ADD COLUMN IF NOT EXISTS imported_by_admin_account_id INTEGER REFERENCES public.admin_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.officer_imports ADD COLUMN IF NOT EXISTS skipped_count INTEGER DEFAULT 0;
ALTER TABLE public.officer_imports ADD COLUMN IF NOT EXISTS invalid_count INTEGER DEFAULT 0;
ALTER TABLE public.officer_imports ADD COLUMN IF NOT EXISTS duplicate_buckle_count INTEGER DEFAULT 0;
ALTER TABLE public.officer_imports ADD COLUMN IF NOT EXISTS missing_buckle_count INTEGER DEFAULT 0;
ALTER TABLE public.officer_imports ADD COLUMN IF NOT EXISTS validation_errors JSONB;
ALTER TABLE public.officer_imports ADD COLUMN IF NOT EXISTS import_mode VARCHAR(20) DEFAULT 'merge'
  CHECK (import_mode IN ('merge', 'full_sync'));
CREATE INDEX IF NOT EXISTS idx_officer_imports_admin_account ON public.officer_imports(imported_by_admin_account_id);
