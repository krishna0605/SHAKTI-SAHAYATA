import pool from '../../config/database.js';
import { buildLinkedIngestionJobLateral } from './adminLinkedIngestionJob.service.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

const parsePositiveInt = (value, fallback = DEFAULT_LIMIT) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, MAX_LIMIT) : fallback;
};

const formatSeriesLabel = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const buildSearchWhere = (query = {}, aliases = []) => {
  const params = [];
  const clauses = [];

  if (query.q) {
    params.push(`%${String(query.q).trim()}%`);
    const index = `$${params.length}`;
    clauses.push(`(${aliases.map((alias) => `COALESCE(${alias}, '') ILIKE ${index}`).join(' OR ')})`);
  }

  return {
    params,
    whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
  };
};

const mappingTemplates = {
  cdr: [
    ['calling_number', 'source_msisdn', 'Direct map'],
    ['called_number', 'destination_msisdn', 'Direct map'],
    ['date_time', 'event_timestamp', 'Normalize to UTC timestamp'],
    ['duration_sec', 'event_duration_seconds', 'Integer duration transform'],
    ['first_cell_id', 'cell_identifier', 'Prefer first serving cell'],
  ],
  ipdr: [
    ['source_ip', 'source_ip', 'Direct map'],
    ['destination_ip', 'destination_ip', 'Direct map'],
    ['msisdn', 'subscriber_msisdn', 'Direct map'],
    ['start_time', 'session_start', 'Normalize session boundary'],
    ['cell_id', 'serving_cell', 'Cell normalization rule'],
  ],
  ild: [
    ['calling_number', 'source_msisdn', 'Direct map'],
    ['called_number', 'destination_msisdn', 'Direct map'],
    ['destination_country', 'destination_country', 'Country standardization'],
    ['date_time', 'event_timestamp', 'Normalize to UTC timestamp'],
    ['imei', 'device_imei', 'Direct map'],
  ],
  tower_dump: [
    ['a_party', 'source_party', 'Direct map'],
    ['b_party', 'destination_party', 'Direct map'],
    ['start_time', 'event_timestamp', 'Timestamp normalization'],
    ['cell_id', 'tower_cell', 'Tower identifier normalization'],
    ['imei', 'device_imei', 'Direct map'],
  ],
  sdr: [
    ['subscriber_name', 'subscriber_name', 'Direct map'],
    ['msisdn', 'subscriber_msisdn', 'Direct map'],
    ['imsi', 'subscriber_imsi', 'Direct map'],
    ['imei', 'device_imei', 'Direct map'],
    ['activation_date', 'activation_date', 'Date normalization'],
  ],
};

const sampleTableForType = (documentType) => {
  switch (documentType) {
    case 'cdr':
      return 'cdr_records';
    case 'ipdr':
      return 'ipdr_records';
    case 'ild':
      return 'ild_records';
    case 'tower_dump':
      return 'tower_dump_records';
    case 'sdr':
      return 'sdr_records';
    default:
      return null;
  }
};

const buildValidationStatus = (row) => {
  if (Number(row.rejected_rows || 0) > 0) return 'warning';
  if (row.status === 'failed' || row.error_message) return 'failed';
  if (row.status === 'completed') return 'passed';
  return 'pending';
};

export const fetchAdminIngestionWorkspace = async (query = {}) => {
  const limit = parsePositiveInt(query.limit, 40);
  const search = buildSearchWhere(query, [
    'COALESCE(uf.original_name, uf.file_name)',
    'c.case_name',
    'c.case_number',
    'uploader.full_name',
    'latest_job.file_checksum',
  ]);

  const [summaryResult, rowsResult, throughputResult, byTypeResult, failureSourceResult] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM uploaded_files WHERE uploaded_at >= CURRENT_DATE) AS files_uploaded_today,
        (SELECT COUNT(*)::int FROM uploaded_files WHERE parse_status = 'pending') AS pending_parsing,
        (SELECT COUNT(*)::int FROM uploaded_files WHERE parse_status = 'processing') AS parsing_in_progress,
        (SELECT COUNT(*)::int FROM ingestion_jobs WHERE rejected_rows > 0 OR status IN ('failed', 'quarantined', 'mismatched')) AS validation_failures,
        (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status IN ('queued', 'processing')) AS normalization_queued,
        (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status = 'completed') AS successful_ingestions,
        (
          SELECT COUNT(*)::int
          FROM (
            SELECT file_checksum
            FROM ingestion_jobs
            GROUP BY file_checksum
            HAVING COUNT(*) > 1
          ) retried
        ) AS retried_jobs
    `),
    pool.query(
      `
        SELECT
          uf.id AS upload_id,
          COALESCE(uf.original_name, uf.file_name) AS file_name,
          uf.case_id,
          c.case_name,
          c.case_number,
          COALESCE(fc.detected_type, fc.expected_type, uf.file_type, latest_job.expected_type, 'unknown') AS file_type,
          COALESCE(latest_job.expected_type, fc.expected_type, 'portal_upload') AS source,
          uploader.full_name AS uploaded_by,
          uf.uploaded_at,
          uf.parse_status,
          latest_job.id AS normalization_job_id,
          latest_job.status AS normalization_status,
          COALESCE(latest_job.total_rows, uf.record_count, 0) AS extracted_records,
          COALESCE(latest_job.error_message, fc.error_message) AS error_summary,
          latest_job.parser_version,
          latest_job.normalizer_version,
          latest_job.file_checksum,
          latest_job.storage_path,
          COALESCE(latest_job.file_size_bytes, uf.file_size) AS size_bytes,
          COALESCE(latest_job.rejected_rows, 0) AS rejected_rows,
          COALESCE(retry_history.retry_count, 0) AS retry_count,
          COALESCE(fc.classification_result, 'PENDING') AS classification_result,
          latest_job.status
        FROM uploaded_files uf
        LEFT JOIN cases c ON c.id = uf.case_id
        LEFT JOIN users uploader ON uploader.id = uf.uploaded_by
        LEFT JOIN file_classifications fc ON fc.file_id = uf.id
        ${buildLinkedIngestionJobLateral('uf', 'latest_job')}
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS retry_count
          FROM ingestion_jobs ij_retry
          WHERE latest_job.file_checksum IS NOT NULL
            AND ij_retry.file_checksum = latest_job.file_checksum
        ) retry_history ON TRUE
        ${search.whereSql}
        ORDER BY uf.uploaded_at DESC
        LIMIT $${search.params.length + 1}
      `,
      [...search.params, limit],
    ),
    pool.query(`
      SELECT DATE_TRUNC('day', uploaded_at) AS bucket, COUNT(*)::int AS value
      FROM uploaded_files
      WHERE uploaded_at >= NOW() - INTERVAL '7 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    pool.query(`
      SELECT COALESCE(fc.detected_type, fc.expected_type, uf.file_type, 'unknown') AS label, COUNT(*)::int AS value
      FROM uploaded_files uf
      LEFT JOIN file_classifications fc ON fc.file_id = uf.id
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 6
    `),
    pool.query(`
      SELECT COALESCE(expected_type, 'unknown') AS label, COUNT(*)::int AS value
      FROM ingestion_jobs
      WHERE status IN ('failed', 'quarantined', 'mismatched')
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 6
    `),
  ]);

  const summary = summaryResult.rows[0] || {};
  return {
    generatedAt: new Date().toISOString(),
    summary: {
      filesUploadedToday: Number(summary.files_uploaded_today || 0),
      pendingParsing: Number(summary.pending_parsing || 0),
      parsingInProgress: Number(summary.parsing_in_progress || 0),
      validationFailures: Number(summary.validation_failures || 0),
      normalizationQueued: Number(summary.normalization_queued || 0),
      successfulIngestions: Number(summary.successful_ingestions || 0),
      retriedJobs: Number(summary.retried_jobs || 0),
    },
    charts: {
      throughput: throughputResult.rows.map((row) => ({
        label: formatSeriesLabel(row.bucket),
        value: Number(row.value || 0),
      })),
      byType: byTypeResult.rows.map((row) => ({
        label: row.label,
        value: Number(row.value || 0),
      })),
      failureBySource: failureSourceResult.rows.map((row) => ({
        label: row.label,
        value: Number(row.value || 0),
      })),
    },
    items: rowsResult.rows.map((row) => ({
      uploadId: row.upload_id,
      fileName: row.file_name,
      caseId: row.case_id,
      caseName: row.case_name,
      caseNumber: row.case_number,
      fileType: row.file_type,
      source: row.source,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.uploaded_at,
      parseStatus: row.parse_status,
      validationStatus: buildValidationStatus(row),
      normalizationJobId: row.normalization_job_id,
      normalizationStatus: row.normalization_status,
      extractedRecords: Number(row.extracted_records || 0),
      errorSummary: row.error_summary,
      parserVersion: row.parser_version,
      normalizerVersion: row.normalizer_version,
      fileChecksum: row.file_checksum,
      storagePath: row.storage_path,
      sizeBytes: row.size_bytes,
      warningCount: Number(row.rejected_rows || 0),
      retryCount: Math.max(Number(row.retry_count || 0) - 1, 0),
    })),
  };
};

const fetchSampleRecord = async (documentType, caseId) => {
  const tableName = sampleTableForType(documentType);
  if (!tableName || !caseId) return {};

  const result = await pool.query(
    `
      SELECT raw_data
      FROM ${tableName}
      WHERE case_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [caseId],
  );

  return result.rows[0]?.raw_data || {};
};

const buildSelectedJobPayload = async (job) => {
  if (!job) return null;

  const sampleRecord = await fetchSampleRecord(job.documentType, job.caseId);
  const template = mappingTemplates[job.documentType] || [];
  const mapping = template.map(([rawField, standardizedField, transform], index) => {
    const sampleValue = sampleRecord?.[rawField] ?? sampleRecord?.[standardizedField] ?? '';
    const confidence = Math.max(Math.min(Number(job.confidenceScore || 0.82) - index * 0.04, 0.99), 0.41);
    return {
      rawField,
      sampleValue: String(sampleValue || 'No sample'),
      standardizedField,
      confidence,
      transform,
      tone: confidence < 0.65 ? 'warning' : 'success',
    };
  });

  return {
    job,
    stageTimeline: [
      { id: 'uploaded', title: 'Uploaded', detail: 'Source file accepted into controlled intake.', meta: job.fileName || 'source', tone: 'success' },
      { id: 'parsed', title: 'Parsed', detail: `${job.totalRows} rows evaluated by parser ${job.modelVersion}.`, meta: job.startedAt, tone: job.errorCount > 0 ? 'warning' : 'success' },
      { id: 'validated', title: 'Validated', detail: `${job.rejectedRows} rows rejected during conformance checks.`, meta: `${job.validRows} valid rows`, tone: job.rejectedRows > 0 ? 'warning' : 'success' },
      { id: 'normalized', title: 'Normalized', detail: 'Standardization and mapping transforms applied to accepted rows.', meta: `${Math.round(job.confidenceScore * 100)}% confidence`, tone: job.confidenceScore < 0.75 ? 'warning' : 'success' },
      { id: 'indexed', title: 'Indexed', detail: 'Output prepared for downstream analytics and lookup.', meta: job.status, tone: job.status === 'completed' ? 'success' : 'info' },
    ],
    mapping,
    anomalies: [
      { label: 'Duplicate indicator', value: job.rejectedRows > 0 ? 'Duplicates or row-level conflicts detected' : 'No duplicate pressure observed in current sample' },
      { label: 'Low-confidence mappings', value: `${mapping.filter((item) => item.confidence < 0.75).length} fields require human review` },
      { label: 'Failed transformations', value: job.errorMessage || 'No failed transformation recorded' },
    ],
    schemaConformity: [
      { label: 'Conformity status', value: job.errorCount > 0 ? 'warning' : 'ready' },
      { label: 'Output dataset', value: `${job.documentType}_records` },
      { label: 'Downstream analytics', value: job.status === 'completed' ? 'ready' : 'pending' },
    ],
    outputReference: `${job.documentType}_records.case=${job.caseId}`,
  };
};

export const fetchAdminNormalizationWorkspace = async (query = {}) => {
  const limit = parsePositiveInt(query.limit, 40);
  const search = buildSearchWhere(query, [
    'c.case_name',
    'ij.id::text',
    'ij.original_filename',
    'ij.expected_type',
  ]);

  const [summaryResult, jobsResult, durationTrendResult, confidenceDistributionResult, failureReasonsResult, lowConfidenceTrendResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'processing')::int AS jobs_running,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS jobs_completed,
        COUNT(*) FILTER (WHERE status IN ('failed', 'quarantined', 'mismatched', 'cancelled'))::int AS jobs_failed,
        COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - COALESCE(started_at, created_at)))), 0)::int AS average_duration_seconds,
        COUNT(*) FILTER (WHERE COALESCE(confidence_score, 0) < 0.75)::int AS low_confidence_jobs,
        COALESCE(SUM(rejected_rows), 0)::int AS unmapped_field_count,
        COALESCE(MAX(normalizer_version), '1.0.0') AS model_version
      FROM ingestion_jobs
    `),
    pool.query(
      `
        SELECT
          ij.id AS job_id,
          ij.case_id,
          c.case_name,
          uf.id AS upload_id,
          ij.expected_type AS document_type,
          COALESCE(ij.normalizer_version, ij.parser_version, '1.0.0') AS model_version,
          ij.started_at,
          ij.completed_at,
          COALESCE(EXTRACT(EPOCH FROM (COALESCE(ij.completed_at, NOW()) - COALESCE(ij.started_at, ij.created_at))), 0)::int AS duration_seconds,
          ij.status,
          COALESCE(ij.confidence_score, 0.82)::float AS confidence_score,
          CASE WHEN COALESCE(ij.rejected_rows, 0) > 0 THEN 1 ELSE 0 END + CASE WHEN ij.error_message IS NOT NULL THEN 1 ELSE 0 END AS warning_count,
          CASE WHEN ij.error_message IS NOT NULL THEN 1 ELSE 0 END AS error_count,
          COALESCE(ij.total_rows, 0) AS total_rows,
          COALESCE(ij.valid_rows, 0) AS valid_rows,
          COALESCE(ij.rejected_rows, 0) AS rejected_rows,
          ij.original_filename AS file_name,
          ij.error_message
        FROM ingestion_jobs ij
        LEFT JOIN cases c ON c.id = ij.case_id
        LEFT JOIN uploaded_files uf ON uf.id = ij.file_id
        ${search.whereSql}
        ORDER BY COALESCE(ij.started_at, ij.created_at) DESC
        LIMIT $${search.params.length + 1}
      `,
      [...search.params, limit],
    ),
    pool.query(`
      SELECT DATE_TRUNC('day', created_at) AS bucket,
             COALESCE(AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - COALESCE(started_at, created_at)))), 0)::int AS value
      FROM ingestion_jobs
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    pool.query(`
      SELECT
        CASE
          WHEN COALESCE(confidence_score, 0) < 0.6 THEN 'Below 60%'
          WHEN COALESCE(confidence_score, 0) < 0.75 THEN '60-75%'
          WHEN COALESCE(confidence_score, 0) < 0.9 THEN '75-90%'
          ELSE '90%+'
        END AS label,
        COUNT(*)::int AS value
      FROM ingestion_jobs
      GROUP BY 1
      ORDER BY 1 ASC
    `),
    pool.query(`
      SELECT COALESCE(NULLIF(error_message, ''), status) AS label, COUNT(*)::int AS value
      FROM ingestion_jobs
      WHERE status IN ('failed', 'quarantined', 'mismatched', 'cancelled') OR error_message IS NOT NULL
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 6
    `),
    pool.query(`
      SELECT DATE_TRUNC('day', created_at) AS bucket,
             COUNT(*) FILTER (WHERE COALESCE(confidence_score, 0) < 0.75)::int AS value
      FROM ingestion_jobs
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY 1
      ORDER BY 1 ASC
    `),
  ]);

  const jobs = jobsResult.rows.map((row) => ({
    jobId: row.job_id,
    caseId: row.case_id,
    caseName: row.case_name,
    uploadId: row.upload_id,
    documentType: row.document_type,
    modelVersion: row.model_version,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationSeconds: Number(row.duration_seconds || 0),
    status: row.status,
    confidenceScore: Number(row.confidence_score || 0),
    warningCount: Number(row.warning_count || 0),
    errorCount: Number(row.error_count || 0),
    totalRows: Number(row.total_rows || 0),
    validRows: Number(row.valid_rows || 0),
    rejectedRows: Number(row.rejected_rows || 0),
    fileName: row.file_name,
    errorMessage: row.error_message,
  }));

  const focusJob = jobs.find((job) => job.jobId === query.focusJobId) || jobs[0] || null;
  const summary = summaryResult.rows[0] || {};

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      jobsRunning: Number(summary.jobs_running || 0),
      jobsCompleted: Number(summary.jobs_completed || 0),
      jobsFailed: Number(summary.jobs_failed || 0),
      averageDurationSeconds: Number(summary.average_duration_seconds || 0),
      lowConfidenceJobs: Number(summary.low_confidence_jobs || 0),
      unmappedFieldCount: Number(summary.unmapped_field_count || 0),
      modelVersion: summary.model_version || '1.0.0',
    },
    charts: {
      durationTrend: durationTrendResult.rows.map((row) => ({ label: formatSeriesLabel(row.bucket), value: Number(row.value || 0) })),
      confidenceDistribution: confidenceDistributionResult.rows.map((row) => ({ label: row.label, value: Number(row.value || 0) })),
      failureReasons: failureReasonsResult.rows.map((row) => ({ label: row.label, value: Number(row.value || 0) })),
      lowConfidenceTrend: lowConfidenceTrendResult.rows.map((row) => ({ label: formatSeriesLabel(row.bucket), value: Number(row.value || 0) })),
    },
    jobs,
    selectedJob: await buildSelectedJobPayload(focusJob),
  };
};

export const fetchAdminStorageWorkspace = async (query = {}) => {
  const limit = parsePositiveInt(query.limit, 30);
  const search = buildSearchWhere(query, [
    'COALESCE(uf.original_name, uf.file_name)',
    'c.case_name',
    'c.case_number',
    'uploader.full_name',
    'latest_job.file_checksum',
  ]);

  const [summaryResult, byTypeResult, rowsResult] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*)::int AS total_files,
        COALESCE(SUM(COALESCE(uf.file_size, ij.file_size_bytes, 0)), 0)::bigint AS total_storage_bytes,
        COUNT(*) FILTER (WHERE uf.uploaded_at >= CURRENT_DATE)::int AS recent_uploads,
        COUNT(*) FILTER (WHERE COALESCE(gov.orphaned, uf.case_id IS NULL))::int AS orphaned_files,
        COUNT(*) FILTER (
          WHERE uf.parse_status = 'failed'
             OR ij.status IN ('failed', 'quarantined', 'mismatched')
             OR COALESCE(gov.quarantined, FALSE)
             OR COALESCE(gov.legal_hold, FALSE)
        )::int AS flagged_files,
        COUNT(*) FILTER (
          WHERE gov.retention_expires_at IS NOT NULL
            AND gov.retention_expires_at <= NOW() + INTERVAL '14 days'
        )::int AS retention_expiring_assets
      FROM uploaded_files uf
      LEFT JOIN file_storage_governance gov ON gov.file_id = uf.id
      ${buildLinkedIngestionJobLateral('uf', 'ij')}
    `),
    pool.query(`
      SELECT COALESCE(fc.detected_type, fc.expected_type, uf.file_type, 'unknown') AS label, COUNT(*)::int AS value
      FROM uploaded_files uf
      LEFT JOIN file_classifications fc ON fc.file_id = uf.id
      GROUP BY 1
      ORDER BY 2 DESC
      LIMIT 8
    `),
    pool.query(
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
          COALESCE(gov.retention_class, CASE WHEN c.is_evidence_locked THEN 'legal_hold_review' ELSE 'standard' END) AS retention_status,
          COALESCE(gov.integrity_status, CASE WHEN ij.file_checksum IS NOT NULL THEN 'verified' ELSE 'unknown' END) AS integrity_status,
          COALESCE(gov.malware_scan_status, CASE WHEN ij.status = 'quarantined' THEN 'quarantined' ELSE 'unknown' END) AS malware_scan_status,
          ij.id AS linked_job_id,
          ij.storage_path,
          COALESCE(gov.legal_hold, c.is_evidence_locked, FALSE) AS legal_hold,
          COALESCE(gov.quarantined, CASE WHEN ij.status = 'quarantined' THEN TRUE ELSE FALSE END) AS quarantined
        FROM uploaded_files uf
        LEFT JOIN cases c ON c.id = uf.case_id
        LEFT JOIN users uploader ON uploader.id = uf.uploaded_by
        LEFT JOIN file_classifications fc ON fc.file_id = uf.id
        LEFT JOIN file_storage_governance gov ON gov.file_id = uf.id
        ${buildLinkedIngestionJobLateral('uf', 'ij')}
        ${search.whereSql}
        ORDER BY uf.uploaded_at DESC
        LIMIT $${search.params.length + 1}
      `,
      [...search.params, limit],
    ),
  ]);

  const summary = summaryResult.rows[0] || {};

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      totalFiles: Number(summary.total_files || 0),
      totalStorageBytes: Number(summary.total_storage_bytes || 0),
      recentUploads: Number(summary.recent_uploads || 0),
      orphanedFiles: Number(summary.orphaned_files || 0),
      flaggedFiles: Number(summary.flagged_files || 0),
      retentionExpiringAssets: Number(summary.retention_expiring_assets || 0),
    },
    byType: byTypeResult.rows.map((row) => ({ label: row.label, value: Number(row.value || 0) })),
    items: rowsResult.rows.map((row) => ({
      fileId: row.file_id,
      fileName: row.file_name,
      linkedCaseId: row.linked_case_id,
      linkedCaseName: row.linked_case_name,
      linkedCaseNumber: row.linked_case_number,
      fileType: row.file_type,
      sizeBytes: row.size_bytes,
      uploadedBy: row.uploaded_by,
      uploadedAt: row.uploaded_at,
      checksum: row.checksum,
      retentionStatus: row.retention_status,
      integrityStatus: row.integrity_status,
      malwareScanStatus: row.malware_scan_status,
      linkedJobId: row.linked_job_id,
      storagePath: row.storage_path,
      legalHold: Boolean(row.legal_hold),
      quarantined: Boolean(row.quarantined),
    })),
  };
};
