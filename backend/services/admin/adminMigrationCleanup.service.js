import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pool from '../../config/database.js';

const LEGACY_UPLOAD_DIR = path.resolve(process.cwd(), 'backend', 'uploads');
const OPS_RUNTIME_DIR = path.resolve(process.cwd(), 'ops', 'runtime');
const BACKEND_RUNTIME_DIR = path.resolve(process.cwd(), 'backend', 'runtime');
const OPS_RESTORES_DIR = path.resolve(process.cwd(), 'ops', 'restores');
const QUARANTINE_ROOT = path.resolve(process.cwd(), 'ops', 'quarantine');

const safeRelPath = (absolutePath) => path.relative(process.cwd(), absolutePath).replace(/\\/g, '/');

const readDirSafe = async (dir) => {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

const classifyUploadRecord = (row) => {
  if (!row.case_id) {
    return { classification: 'quarantine', reason: 'orphaned_upload' };
  }
  if (row.duplicate_of_file_id) {
    return { classification: 'quarantine', reason: 'duplicate_upload' };
  }
  if (row.quarantined) {
    return { classification: 'quarantine', reason: 'governance_quarantined' };
  }
  return { classification: 'keep', reason: 'linked_case_evidence' };
};

const buildSummary = (items) => items.reduce((summary, item) => {
  summary[item.classification] = (summary[item.classification] || 0) + 1;
  summary.byType[item.entityType] = (summary.byType[item.entityType] || 0) + 1;
  return summary;
}, { keep: 0, quarantine: 0, delete_later: 0, byType: {} });

const insertReport = async ({ adminAccountId, items, summary }) => {
  const reportId = crypto.randomUUID();
  await pool.query(
    `
      INSERT INTO migration_cleanup_reports (
        id,
        generated_by_admin_id,
        status,
        classification_summary,
        totals_by_type
      )
      VALUES ($1, $2, 'inventory_complete', $3::jsonb, $4::jsonb)
    `,
    [
      reportId,
      adminAccountId || null,
      JSON.stringify(summary),
      JSON.stringify(summary.byType || {}),
    ]
  );

  for (const item of items) {
    await pool.query(
      `
        INSERT INTO migration_cleanup_items (
          report_id,
          item_type,
          resource_id,
          linked_case_id,
          source_path,
          classification,
          reason_code,
          reason_detail,
          metadata,
          delete_eligible
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
      `,
      [
        reportId,
        item.entityType,
        item.entityId,
        item.caseId || null,
        item.sourcePath || null,
        item.classification,
        item.reason,
        item.reason,
        JSON.stringify(item.details || {}),
        Boolean(item.deleteEligible),
      ]
    );
  }

  return reportId;
};

export const generateMigrationCleanupReport = async ({ adminAccountId } = {}) => {
  const [uploadRows, bootstrapRows, adminRows, runtimeFiles, backendRuntimeFiles, restoreDirs, localUploadEntries] = await Promise.all([
    pool.query(
      `
        SELECT
          uf.id,
          uf.case_id,
          uf.file_name,
          uf.original_name,
          uf.storage_object_path,
          uf.storage_bucket,
          COALESCE(gov.quarantined, FALSE) AS quarantined,
          gov.duplicate_of_file_id
        FROM uploaded_files uf
        LEFT JOIN file_storage_governance gov ON gov.file_id = uf.id
        ORDER BY uf.id DESC
      `
    ),
    pool.query(
      `
        SELECT id, buckle_id, full_name, email, is_active
        FROM officers
        WHERE buckle_id BETWEEN 'BK-1001' AND 'BK-1050'
        ORDER BY buckle_id
      `
    ),
    pool.query(
      `
        SELECT id, email, full_name, role, auth_user_id
        FROM admin_accounts
        WHERE email = COALESCE(NULLIF($1, ''), email)
        ORDER BY id DESC
      `,
      [String(process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase()]
    ),
    readDirSafe(OPS_RUNTIME_DIR),
    readDirSafe(BACKEND_RUNTIME_DIR),
    readDirSafe(OPS_RESTORES_DIR),
    readDirSafe(LEGACY_UPLOAD_DIR),
  ]);

  const trackedFileNames = new Set(uploadRows.rows.map((row) => row.file_name).filter(Boolean));
  const items = [];

  for (const row of uploadRows.rows) {
    const classification = classifyUploadRecord(row);
    items.push({
      entityType: 'uploaded_file',
      entityId: String(row.id),
      caseId: row.case_id,
      sourcePath: row.storage_object_path || row.file_name,
      classification: classification.classification,
      reason: classification.reason,
      details: {
        originalName: row.original_name,
        storageBucket: row.storage_bucket || null,
      },
      deleteEligible: classification.classification !== 'keep',
    });
  }

  for (const row of bootstrapRows.rows) {
    items.push({
      entityType: 'bootstrap_officer',
      entityId: String(row.id),
      classification: 'delete_later',
      reason: 'bootstrap_identity_review',
      details: {
        buckleId: row.buckle_id,
        fullName: row.full_name,
        email: row.email,
        isActive: row.is_active,
      },
      deleteEligible: false,
    });
  }

  for (const row of adminRows.rows) {
    items.push({
      entityType: 'bootstrap_admin',
      entityId: String(row.id),
      classification: row.auth_user_id ? 'keep' : 'delete_later',
      reason: row.auth_user_id ? 'mapped_supabase_admin' : 'bootstrap_admin_review',
      details: {
        email: row.email,
        fullName: row.full_name,
        role: row.role,
        authUserId: row.auth_user_id || null,
      },
      deleteEligible: false,
    });
  }

  for (const entry of localUploadEntries.filter((item) => item.isFile())) {
    if (trackedFileNames.has(entry.name)) continue;
    items.push({
      entityType: 'legacy_local_upload',
      entityId: entry.name,
      sourcePath: safeRelPath(path.join(LEGACY_UPLOAD_DIR, entry.name)),
      classification: 'quarantine',
      reason: 'untracked_local_upload',
      details: { directory: 'backend/uploads' },
      deleteEligible: true,
    });
  }

  for (const entry of runtimeFiles.filter((item) => item.isFile())) {
    items.push({
      entityType: 'runtime_artifact',
      entityId: entry.name,
      sourcePath: safeRelPath(path.join(OPS_RUNTIME_DIR, entry.name)),
      classification: 'delete_later',
      reason: 'legacy_runtime_artifact',
      details: { directory: 'ops/runtime' },
      deleteEligible: true,
    });
  }

  for (const entry of backendRuntimeFiles.filter((item) => item.isFile())) {
    items.push({
      entityType: 'runtime_artifact',
      entityId: entry.name,
      sourcePath: safeRelPath(path.join(BACKEND_RUNTIME_DIR, entry.name)),
      classification: 'delete_later',
      reason: 'legacy_backend_runtime_artifact',
      details: { directory: 'backend/runtime' },
      deleteEligible: true,
    });
  }

  for (const entry of restoreDirs.filter((item) => item.isDirectory())) {
    items.push({
      entityType: 'restore_workspace',
      entityId: entry.name,
      sourcePath: safeRelPath(path.join(OPS_RESTORES_DIR, entry.name)),
      classification: 'delete_later',
      reason: 'stale_restore_workspace',
      details: { directory: 'ops/restores' },
      deleteEligible: true,
    });
  }

  const summary = buildSummary(items);
  const reportId = await insertReport({ adminAccountId, items, summary });
  return fetchMigrationCleanupReport({ reportId });
};

export const fetchMigrationCleanupReport = async ({ reportId = null } = {}) => {
  const reportResult = await pool.query(
    `
      SELECT id, status, classification_summary, totals_by_type, created_at, updated_at
      FROM migration_cleanup_reports
      ${reportId ? 'WHERE id = $1' : 'ORDER BY created_at DESC LIMIT 1'}
    `,
    reportId ? [reportId] : []
  );

  const report = reportResult.rows[0];
  if (!report) return null;

  const itemsResult = await pool.query(
    `
      SELECT
        id,
        item_type,
        resource_id,
        linked_case_id,
        source_path,
        classification,
        reason_code,
        reason_detail,
        metadata,
        quarantine_path,
        delete_eligible,
        deleted_at,
        migrated_at,
        created_at,
        updated_at
      FROM migration_cleanup_items
      WHERE report_id = $1
      ORDER BY classification, item_type, created_at DESC, id DESC
    `,
    [report.id]
  );

  return {
    reportId: report.id,
    status: report.status,
    createdAt: report.created_at,
    completedAt: report.updated_at,
    summary: report.classification_summary || {},
    totalsByType: report.totals_by_type || {},
    items: itemsResult.rows.map((row) => ({
      id: row.id,
      entityType: row.item_type,
      entityId: row.resource_id,
      caseId: row.linked_case_id,
      sourcePath: row.source_path,
      classification: row.classification,
      reason: row.reason_code || row.reason_detail,
      details: row.metadata || {},
      quarantineStatus: row.quarantine_path ? 'quarantined' : 'pending',
      quarantineRef: row.quarantine_path,
      deleteEligible: Boolean(row.delete_eligible),
      deletedAt: row.deleted_at,
      migratedAt: row.migrated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
  };
};

export const quarantineMigrationCleanupItems = async ({ reportId, adminAccountId }) => {
  const report = await fetchMigrationCleanupReport({ reportId });
  if (!report) {
    throw new Error('Cleanup report not found');
  }

  await fs.mkdir(QUARANTINE_ROOT, { recursive: true });

  for (const item of report.items.filter((entry) => entry.classification === 'quarantine' && entry.quarantineStatus === 'pending')) {
    let quarantineRef = item.quarantineRef;
    if (item.entityType === 'legacy_local_upload' && item.sourcePath) {
      const source = path.resolve(process.cwd(), item.sourcePath);
      const destinationDir = path.join(QUARANTINE_ROOT, reportId);
      await fs.mkdir(destinationDir, { recursive: true });
      const destination = path.join(destinationDir, path.basename(source));
      try {
        await fs.rename(source, destination);
        quarantineRef = safeRelPath(destination);
      } catch {
        quarantineRef = quarantineRef || 'metadata-only';
      }
    } else {
      quarantineRef = quarantineRef || 'metadata-only';
    }

    await pool.query(
      `
        UPDATE migration_cleanup_items
        SET
          quarantine_path = $2,
          updated_at = NOW()
        WHERE id = $1
      `,
      [item.id, quarantineRef]
    );
  }

  await pool.query(
    `
      UPDATE migration_cleanup_reports
      SET
        status = 'quarantined',
        updated_at = NOW()
      WHERE id = $1
    `,
    [reportId]
  );

  return fetchMigrationCleanupReport({ reportId });
};

export const deleteMigrationCleanupArtifacts = async ({ reportId }) => {
  const report = await fetchMigrationCleanupReport({ reportId });
  if (!report) {
    throw new Error('Cleanup report not found');
  }

  for (const item of report.items.filter((entry) => entry.deleteEligible && !entry.deletedAt)) {
    if (!item.sourcePath) continue;
    const target = path.resolve(process.cwd(), item.sourcePath);
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }

    await pool.query(
      `
        UPDATE migration_cleanup_items
        SET
          deleted_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
      `,
      [item.id]
    );
  }

  await pool.query(
    `
      UPDATE migration_cleanup_reports
      SET
        status = 'archived',
        updated_at = NOW()
      WHERE id = $1
    `,
    [reportId]
  );

  return fetchMigrationCleanupReport({ reportId });
};
