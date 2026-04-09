import pool from '../../config/database.js';
import { buildLinkedIngestionJobLateral } from './adminLinkedIngestionJob.service.js';

const GOVERNANCE_ACTIONS = new Set([
  'place_legal_hold',
  'release_legal_hold',
  'quarantine',
  'release_quarantine',
  'recheck_integrity',
  'mark_duplicate',
]);

const ensureGovernanceRow = async (fileId) => {
  await pool.query(
    `
      INSERT INTO file_storage_governance (
        file_id,
        integrity_status,
        malware_scan_status,
        retention_class,
        orphaned
      )
      VALUES (
        $1,
        'pending',
        'pending',
        'standard',
        NOT EXISTS (SELECT 1 FROM uploaded_files uf WHERE uf.id = $1 AND uf.case_id IS NOT NULL)
      )
      ON CONFLICT (file_id) DO NOTHING
    `,
    [fileId],
  );
};

const fetchGovernanceTimeline = async (fileId) => {
  const result = await pool.query(
    `
      SELECT
        aal.id,
        aal.action,
        aal.created_at,
        aa.full_name AS actor_name,
        aa.email AS actor_email,
        COALESCE(aal.details, '{}'::jsonb) AS details
      FROM admin_action_logs aal
      LEFT JOIN admin_accounts aa ON aa.id = aal.admin_account_id
      WHERE aal.resource_type = 'file_governance'
        AND aal.resource_id = $1::text
      ORDER BY aal.created_at DESC, aal.id DESC
      LIMIT 20
    `,
    [fileId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    action: row.action,
    createdAt: row.created_at,
    actorName: row.actor_name || 'Unknown admin',
    actorEmail: row.actor_email || null,
    details: row.details || {},
  }));
};

const fetchAssetRecord = async (fileId) => {
  const result = await pool.query(
    `
      SELECT
        uf.id AS file_id,
        COALESCE(uf.original_name, uf.file_name) AS file_name,
        uf.case_id AS linked_case_id,
        c.case_name AS linked_case_name,
        c.case_number AS linked_case_number,
        COALESCE(fc.detected_type, fc.expected_type, uf.file_type, 'unknown') AS file_type,
        COALESCE(ij.file_size_bytes, uf.file_size) AS size_bytes,
        uploader.full_name AS uploaded_by,
        uf.uploaded_at,
        ij.file_checksum AS checksum,
        COALESCE(gov.retention_class, CASE WHEN c.is_evidence_locked THEN 'legal_hold_review' ELSE 'standard' END) AS retention_class,
        COALESCE(gov.retention_expires_at, NULL) AS retention_expires_at,
        COALESCE(gov.integrity_status, CASE WHEN ij.file_checksum IS NOT NULL THEN 'verified' ELSE 'unknown' END) AS integrity_status,
        gov.integrity_verified_at,
        COALESCE(gov.malware_scan_status, CASE WHEN ij.status = 'quarantined' THEN 'quarantined' ELSE 'unknown' END) AS malware_scan_status,
        gov.malware_scanned_at,
        ij.id AS linked_job_id,
        ij.storage_path,
        COALESCE(gov.legal_hold, c.is_evidence_locked, FALSE) AS legal_hold,
        gov.legal_hold_reason,
        gov.legal_hold_set_at,
        COALESCE(gov.quarantined, CASE WHEN ij.status = 'quarantined' THEN TRUE ELSE FALSE END) AS quarantined,
        gov.quarantine_reason,
        gov.quarantined_at,
        COALESCE(gov.orphaned, uf.case_id IS NULL) AS orphaned,
        gov.duplicate_of_file_id,
        gov.last_governance_action,
        gov.last_governance_action_at
      FROM uploaded_files uf
      LEFT JOIN cases c ON c.id = uf.case_id
      LEFT JOIN users uploader ON uploader.id = uf.uploaded_by
      LEFT JOIN file_classifications fc ON fc.file_id = uf.id
      ${buildLinkedIngestionJobLateral('uf', 'ij')}
      LEFT JOIN file_storage_governance gov ON gov.file_id = uf.id
      WHERE uf.id = $1
      LIMIT 1
    `,
    [fileId],
  );

  return result.rows[0] || null;
};

export const fetchStorageAssetDetail = async ({ fileId, admin }) => {
  await ensureGovernanceRow(fileId);

  const [asset, timeline] = await Promise.all([
    fetchAssetRecord(fileId),
    fetchGovernanceTimeline(fileId),
  ]);

  if (!asset) return null;

  return {
    asset: {
      fileId: asset.file_id,
      fileName: asset.file_name,
      linkedCaseId: asset.linked_case_id,
      linkedCaseName: asset.linked_case_name,
      linkedCaseNumber: asset.linked_case_number,
      fileType: asset.file_type,
      sizeBytes: asset.size_bytes,
      uploadedBy: asset.uploaded_by,
      uploadedAt: asset.uploaded_at,
      checksum: asset.checksum,
      retentionClass: asset.retention_class,
      retentionExpiresAt: asset.retention_expires_at,
      integrityStatus: asset.integrity_status,
      integrityVerifiedAt: asset.integrity_verified_at,
      malwareScanStatus: asset.malware_scan_status,
      malwareScannedAt: asset.malware_scanned_at,
      linkedJobId: asset.linked_job_id,
      storagePath: asset.storage_path,
      legalHold: Boolean(asset.legal_hold),
      legalHoldReason: asset.legal_hold_reason,
      legalHoldSetAt: asset.legal_hold_set_at,
      quarantined: Boolean(asset.quarantined),
      quarantineReason: asset.quarantine_reason,
      quarantinedAt: asset.quarantined_at,
      orphaned: Boolean(asset.orphaned),
      duplicateOfFileId: asset.duplicate_of_file_id,
      lastGovernanceAction: asset.last_governance_action,
      lastGovernanceActionAt: asset.last_governance_action_at,
    },
    capabilities: {
      canManageGovernance: String(admin?.role || '') === 'it_admin',
      requiresRecentAuth: true,
    },
    governanceTimeline: timeline,
  };
};

export const applyStorageGovernanceAction = async ({
  fileId,
  action,
  adminAccountId,
  reason = null,
  duplicateOfFileId = null,
}) => {
  if (!GOVERNANCE_ACTIONS.has(action)) {
    throw new Error('Unsupported storage governance action');
  }

  await ensureGovernanceRow(fileId);

  switch (action) {
    case 'place_legal_hold':
      await pool.query(
        `
          UPDATE file_storage_governance
          SET
            legal_hold = TRUE,
            legal_hold_reason = $2,
            legal_hold_set_at = NOW(),
            legal_hold_set_by = $3,
            last_governance_action = 'place_legal_hold',
            last_governance_action_at = NOW(),
            last_governance_action_by = $3,
            updated_at = NOW()
          WHERE file_id = $1
        `,
        [fileId, reason || 'Governance review', adminAccountId],
      );
      break;
    case 'release_legal_hold':
      await pool.query(
        `
          UPDATE file_storage_governance
          SET
            legal_hold = FALSE,
            legal_hold_reason = NULL,
            last_governance_action = 'release_legal_hold',
            last_governance_action_at = NOW(),
            last_governance_action_by = $2,
            updated_at = NOW()
          WHERE file_id = $1
        `,
        [fileId, adminAccountId],
      );
      break;
    case 'quarantine':
      await pool.query(
        `
          UPDATE file_storage_governance
          SET
            quarantined = TRUE,
            quarantine_reason = $2,
            quarantined_at = NOW(),
            quarantined_by = $3,
            malware_scan_status = 'quarantined',
            malware_scanned_at = COALESCE(malware_scanned_at, NOW()),
            last_governance_action = 'quarantine',
            last_governance_action_at = NOW(),
            last_governance_action_by = $3,
            updated_at = NOW()
          WHERE file_id = $1
        `,
        [fileId, reason || 'Manual quarantine', adminAccountId],
      );
      break;
    case 'release_quarantine':
      await pool.query(
        `
          UPDATE file_storage_governance
          SET
            quarantined = FALSE,
            quarantine_reason = NULL,
            malware_scan_status = 'clean',
            malware_scanned_at = COALESCE(malware_scanned_at, NOW()),
            last_governance_action = 'release_quarantine',
            last_governance_action_at = NOW(),
            last_governance_action_by = $2,
            updated_at = NOW()
          WHERE file_id = $1
        `,
        [fileId, adminAccountId],
      );
      break;
    case 'recheck_integrity':
      await pool.query(
        `
          UPDATE file_storage_governance
          SET
            integrity_status = 'verified',
            integrity_verified_at = NOW(),
            last_governance_action = 'recheck_integrity',
            last_governance_action_at = NOW(),
            last_governance_action_by = $2,
            updated_at = NOW()
          WHERE file_id = $1
        `,
        [fileId, adminAccountId],
      );
      break;
    case 'mark_duplicate':
      if (!duplicateOfFileId) {
        throw new Error('duplicateOfFileId is required when marking a duplicate');
      }
      await pool.query(
        `
          UPDATE file_storage_governance
          SET
            duplicate_of_file_id = $2,
            last_governance_action = 'mark_duplicate',
            last_governance_action_at = NOW(),
            last_governance_action_by = $3,
            updated_at = NOW()
          WHERE file_id = $1
        `,
        [fileId, duplicateOfFileId, adminAccountId],
      );
      break;
  }

  return fetchStorageAssetDetail({
    fileId,
    admin: { role: 'it_admin' },
  });
};
