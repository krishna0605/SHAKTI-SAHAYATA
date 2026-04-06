import pool from '../../config/database.js';
import {
  buildCdrInsights,
  buildIldInsights,
  buildIpdrInsights,
  buildSdrInsights,
  buildTowerInsights
} from './deterministicAnalysis.service.js';

const MODULE_ORDER = ['cdr', 'ipdr', 'sdr', 'tower', 'ild', 'timeline'];
const MODULE_LABELS = {
  cdr: 'CDR',
  ipdr: 'IPDR',
  sdr: 'SDR',
  tower: 'Tower Dump',
  ild: 'ILD',
  timeline: 'Timeline'
};

const baseCaseSelect = `
  SELECT
    c.id,
    c.case_name,
    c.case_number,
    c.fir_number,
    c.description,
    c.operator,
    c.case_type,
    c.status,
    c.priority,
    c.created_at,
    c.updated_at,
    c.investigation_details,
    c.is_evidence_locked,
    c.start_date,
    c.end_date
  FROM cases c
`;

const unique = (items = []) => [...new Set(items.filter(Boolean))];
const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');
const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN') : 'N/A');
const normalizeText = (value) => String(value || '').trim();
const digitsOnly = (value) => String(value || '').replace(/\D+/g, '');
const isAdminRole = (role) => ['super_admin', 'station_admin'].includes(String(role || '').trim());

const buildAccessScope = (user, alias = 'c', startIndex = 1) => {
  if (!user?.userId || isAdminRole(user.role)) {
    return { clause: '', params: [], nextIndex: startIndex };
  }

  const userIdIndex = startIndex;
  return {
    clause: `
      WHERE (
        ${alias}.created_by_user_id = $${userIdIndex}
        OR EXISTS (
          SELECT 1
          FROM case_assignments ca
          WHERE ca.case_id = ${alias}.id
            AND ca.user_id = $${userIdIndex}
            AND ca.is_active = TRUE
        )
      )
    `,
    params: [Number(user.userId)],
    nextIndex: startIndex + 1
  };
};

const mergeWhereClause = (scopeClause = '', extraSql = '', extraParams = []) => {
  const trimmedScope = String(scopeClause || '').trim();
  if (!trimmedScope) {
    return {
      whereClause: extraSql ? `WHERE ${extraSql}` : '',
      params: extraParams
    };
  }

  if (!extraSql) {
    return { whereClause: scopeClause, params: extraParams };
  }

  return {
    whereClause: `${scopeClause}\n      AND (${extraSql})`,
    params: extraParams
  };
};

const mapCaseRow = (row, availability = null) => ({
  id: String(row.id),
  caseName: row.case_name,
  caseNumber: row.case_number || null,
  firNumber: row.fir_number || null,
  operator: row.operator || null,
  caseType: row.case_type || null,
  status: row.status || null,
  priority: row.priority || null,
  createdAt: row.created_at || null,
  updatedAt: row.updated_at || null,
  description: row.description || null,
  investigationDetails: row.investigation_details || null,
  isEvidenceLocked: Boolean(row.is_evidence_locked),
  hasFiles: Boolean(availability?.files),
  availability: availability || null
});

const buildAvailability = (datasetCounts = {}, fileCount = 0) => {
  const cdr = Number(datasetCounts.cdr || 0) > 0;
  const ipdr = Number(datasetCounts.ipdr || 0) > 0;
  const sdr = Number(datasetCounts.sdr || 0) > 0;
  const tower = Number(datasetCounts.tower || 0) > 0;
  const ild = Number(datasetCounts.ild || 0) > 0;
  const timeline = Number(datasetCounts.timeline || 0) > 0;

  return {
    files: Number(fileCount || 0) > 0,
    cdr,
    ipdr,
    sdr,
    tower,
    ild,
    timeline
  };
};

const buildDatasetCountShape = (row = {}) => ({
  cdr: Number(row.cdr_count || 0),
  ipdr: Number(row.ipdr_count || 0),
  sdr: Number(row.sdr_count || 0),
  tower: Number(row.tower_count || 0),
  ild: Number(row.ild_count || 0),
  timeline: Number(row.timeline_count || 0)
});

const buildSourceMetadata = (caseRow, fileRows = [], tables = []) => ({
  caseId: caseRow?.id ? String(caseRow.id) : null,
  tables: unique(['cases', ...tables]),
  files: (fileRows || []).map((file) => ({
    id: String(file.id),
    originalName: file.original_name || file.file_name || `File ${file.id}`,
    fileType: file.detected_type || file.file_type || null,
    parseStatus: file.parse_status || null,
    confidence: file.confidence ?? null
  }))
});

const renderAvailabilityList = (availability = {}) => {
  const available = MODULE_ORDER.filter((key) => availability[key]).map((key) => MODULE_LABELS[key]);
  const missing = MODULE_ORDER.filter((key) => !availability[key]).map((key) => MODULE_LABELS[key]);
  return { available, missing };
};

const buildOverviewSummary = (knowledge) => {
  const { case: caseInfo, files, datasetCounts, availability } = knowledge;
  const { available, missing } = renderAvailabilityList(availability);
  const hasOnlyMetadata = !availability.files && available.length === 0;
  const followUpPrompt =
    'What do you want to know about this case: overview, files, CDR, IPDR, SDR, tower, ILD, or timeline?';

  const lines = [
    `**Case Overview: ${caseInfo.caseName || `Case ${caseInfo.id}`}**`,
    '',
    `- Case ID: ${caseInfo.id}`,
    `- Case Name: ${caseInfo.caseName || 'N/A'}`,
    `- Case Number: ${caseInfo.caseNumber || 'N/A'}`,
    `- FIR Number: ${caseInfo.firNumber || 'N/A'}`,
    `- Operator: ${caseInfo.operator || 'N/A'}`,
    `- Case Type: ${caseInfo.caseType || 'N/A'}`,
    `- Status: ${caseInfo.status || 'N/A'}`,
    `- Created: ${formatDateTime(caseInfo.createdAt)}`,
    `- Uploaded Files: ${formatNumber(files.totalUploadedFiles)}`,
    `- Description: ${caseInfo.description || caseInfo.investigationDetails || 'No investigation notes yet.'}`,
    '',
    `- Available modules: ${available.length ? available.join(', ') : 'None yet'}`,
    `- Missing modules: ${missing.length ? missing.join(', ') : 'None'}`,
    `- Timeline availability: ${availability.timeline ? `Available (${formatNumber(datasetCounts.timeline)} events)` : 'No timeline data yet'}`
  ];

  if (hasOnlyMetadata) {
    lines.push('', 'This case currently has metadata only. Upload files to unlock deeper analysis and module summaries.');
  }

  lines.push('', followUpPrompt);

  return {
    module: 'overview',
    empty: false,
    followUpPrompt,
    availableModules: available,
    missingModules: missing,
    facts: {
      caseId: caseInfo.id,
      caseName: caseInfo.caseName,
      caseNumber: caseInfo.caseNumber,
      firNumber: caseInfo.firNumber,
      operator: caseInfo.operator,
      caseType: caseInfo.caseType,
      status: caseInfo.status,
      createdAt: caseInfo.createdAt,
      uploadedFiles: files.totalUploadedFiles,
      datasetCounts
    },
    markdown: lines.join('\n')
  };
};

const buildFilesSummary = (knowledge) => {
  const { case: caseInfo, files } = knowledge;

  if (!files.totalUploadedFiles) {
    return {
      module: 'files',
      empty: true,
      facts: { totalUploadedFiles: 0, latestUploadAt: null, items: [] },
      markdown: `This case exists, but no files have been uploaded yet for ${caseInfo.caseName || `Case ${caseInfo.id}`}. Upload files to unlock deeper module insights.`
    };
  }

  const lines = [
    `**Files for ${caseInfo.caseName || `Case ${caseInfo.id}`}**`,
    '',
    `- Total uploaded files: ${formatNumber(files.totalUploadedFiles)}`,
    `- Latest upload: ${formatDateTime(files.latestUploadAt)}`,
    ''
  ];

  files.items.forEach((file, index) => {
    lines.push(
      `${index + 1}. ${file.originalName}`,
      `   Declared type: ${file.fileType || 'unknown'} | Detected type: ${file.detectedType || 'unknown'} | Confidence: ${file.confidence ?? 'n/a'} | Parse status: ${file.parseStatus || 'unknown'} | Records: ${formatNumber(file.recordCount || 0)}`
    );
  });

  return {
    module: 'files',
    empty: false,
    facts: files,
    markdown: lines.join('\n')
  };
};

const buildEmptyModuleSummary = (module, message, nextAction) => ({
  module,
  empty: true,
  facts: {},
  markdown: `${message}\n\nNext step: ${nextAction}`
});

const moduleSummaryQueries = {
  async cdr(caseId) {
    const [statsResult, topBResult, topLocationResult, topImeiResult, callTypesResult, trendResult, deterministic] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*)::int AS total_records,
            COUNT(DISTINCT NULLIF(calling_number, ''))::int AS unique_a_parties,
            COUNT(DISTINCT NULLIF(called_number, ''))::int AS unique_b_parties,
            COUNT(DISTINCT NULLIF(imei_a, ''))::int AS unique_imei,
            MIN(COALESCE(date_time::text, call_date)) AS start_date,
            MAX(COALESCE(date_time::text, call_date)) AS end_date,
            COALESCE(SUM(COALESCE(duration_sec, duration, 0)), 0)::bigint AS total_duration_sec,
            COALESCE(AVG(NULLIF(COALESCE(duration_sec, duration, 0), 0)), 0)::numeric(12,2) AS avg_duration_sec
          FROM cdr_records
          WHERE case_id = $1
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(called_number, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM cdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT
            COALESCE(NULLIF(first_cell_id, ''), NULLIF(last_cell_id, ''), NULLIF(cell_id_a, ''), NULLIF(cell_id_b, ''), 'Unknown') AS label,
            COUNT(*)::int AS count
          FROM cdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(imei_a, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM cdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(call_type, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM cdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 8
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT call_date AS label, COUNT(*)::int AS count
          FROM cdr_records
          WHERE case_id = $1
            AND call_date IS NOT NULL
            AND TRIM(call_date) <> ''
          GROUP BY 1
          ORDER BY count DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      buildCdrInsights({ caseId, topN: 5, days: 30 })
    ]);

    const stats = statsResult.rows[0] || {};
    const markdown = [
      '**CDR Summary**',
      '',
      `- Total records: ${formatNumber(stats.total_records)}`,
      `- Unique A-Parties: ${formatNumber(stats.unique_a_parties)}`,
      `- Unique B-Parties: ${formatNumber(stats.unique_b_parties)}`,
      `- Unique IMEI: ${formatNumber(stats.unique_imei)}`,
      `- Date range: ${stats.start_date || 'N/A'} to ${stats.end_date || 'N/A'}`,
      `- Total duration: ${formatNumber(stats.total_duration_sec)} sec`,
      `- Average duration: ${Number(stats.avg_duration_sec || 0).toFixed(2)} sec`,
      `- Call types: ${callTypesResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- Top 5 B-Parties: ${topBResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- Top locations: ${topLocationResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- Top IMEI: ${topImeiResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- Activity peaks: ${trendResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
    ].join('\n');

    return {
      module: 'cdr',
      empty: false,
      facts: {
        ...stats,
        topBParties: topBResult.rows,
        topLocations: topLocationResult.rows,
        topImei: topImeiResult.rows,
        callTypeDistribution: callTypesResult.rows,
        topDays: trendResult.rows
      },
      chartSpecs: deterministic.chartSpecs || [],
      markdown: deterministic.markdown ? `${markdown}\n\n${deterministic.markdown}` : markdown
    };
  },
  async ipdr(caseId) {
    const [statsResult, topMsisdnResult, topImeiResult, topImsiResult, topIpResult, deterministic] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*)::int AS total_records,
            COUNT(DISTINCT NULLIF(msisdn, ''))::int AS unique_msisdn,
            COUNT(DISTINCT NULLIF(imei, ''))::int AS unique_imei,
            COUNT(DISTINCT NULLIF(imsi, ''))::int AS unique_imsi,
            COUNT(DISTINCT COALESCE(NULLIF(source_ip, ''), NULLIF(public_ip, ''), NULLIF(private_ip, '')))::int AS unique_source_ip,
            COUNT(*) FILTER (WHERE COALESCE(total_volume, 0) > 0)::int AS records_with_volume
          FROM ipdr_records
          WHERE case_id = $1
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(msisdn, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM ipdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(imei, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM ipdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(imsi, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM ipdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(source_ip, ''), NULLIF(public_ip, ''), NULLIF(private_ip, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM ipdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      buildIpdrInsights({ caseId, topN: 5 })
    ]);

    const stats = statsResult.rows[0] || {};
    const markdown = [
      '**IPDR Summary**',
      '',
      `- Total records: ${formatNumber(stats.total_records)}`,
      `- Unique MSISDN: ${formatNumber(stats.unique_msisdn)}`,
      `- Unique IMEI: ${formatNumber(stats.unique_imei)}`,
      `- Unique IMSI: ${formatNumber(stats.unique_imsi)}`,
      `- Unique source IP: ${formatNumber(stats.unique_source_ip)}`,
      `- Enrichment availability: ${Number(stats.records_with_volume || 0) > 0 ? 'Traffic volume fields available' : 'Limited enrichment fields available'}`,
      `- Top MSISDN: ${topMsisdnResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- Top IMEI: ${topImeiResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- Top IMSI: ${topImsiResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- Top source IP findings: ${topIpResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
    ].join('\n');

    return {
      module: 'ipdr',
      empty: false,
      facts: {
        ...stats,
        topMsisdn: topMsisdnResult.rows,
        topImei: topImeiResult.rows,
        topImsi: topImsiResult.rows,
        topSourceIps: topIpResult.rows
      },
      chartSpecs: deterministic.chartSpecs || [],
      markdown: deterministic.markdown ? `${markdown}\n\n${deterministic.markdown}` : markdown
    };
  },
  async sdr(caseId) {
    const [statsResult, topNamesResult, topNumbersResult, deterministic] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*)::int AS total_records,
            COUNT(*) FILTER (WHERE NULLIF(subscriber_name, '') IS NOT NULL)::int AS subscriber_name_rows,
            COUNT(*) FILTER (WHERE NULLIF(msisdn, '') IS NOT NULL)::int AS msisdn_rows,
            COUNT(*) FILTER (WHERE NULLIF(imsi, '') IS NOT NULL)::int AS imsi_rows,
            COUNT(*) FILTER (WHERE NULLIF(imei, '') IS NOT NULL)::int AS imei_rows,
            COUNT(*) FILTER (WHERE NULLIF(address, '') IS NOT NULL)::int AS address_rows,
            COUNT(*) FILTER (WHERE NULLIF(id_proof_number, '') IS NOT NULL)::int AS id_proof_rows,
            COUNT(*) FILTER (WHERE NULLIF(email, '') IS NOT NULL)::int AS email_rows
          FROM sdr_records
          WHERE case_id = $1
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(subscriber_name, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM sdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(msisdn, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM sdr_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      buildSdrInsights({ caseId, topN: 5 })
    ]);

    const stats = statsResult.rows[0] || {};
    const markdown = [
      '**Subscriber Detail Summary**',
      '',
      `- Total subscriber rows: ${formatNumber(stats.total_records)}`,
      `- Name coverage: ${formatNumber(stats.subscriber_name_rows)}`,
      `- MSISDN coverage: ${formatNumber(stats.msisdn_rows)}`,
      `- IMSI coverage: ${formatNumber(stats.imsi_rows)}`,
      `- IMEI coverage: ${formatNumber(stats.imei_rows)}`,
      `- Address coverage: ${formatNumber(stats.address_rows)}`,
      `- ID proof coverage: ${formatNumber(stats.id_proof_rows)}`,
      `- Email coverage: ${formatNumber(stats.email_rows)}`,
      `- Top subscriber names: ${topNamesResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- Top phone numbers: ${topNumbersResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
    ].join('\n');

    return {
      module: 'sdr',
      empty: false,
      facts: {
        ...stats,
        topSubscriberNames: topNamesResult.rows,
        topPhoneNumbers: topNumbersResult.rows
      },
      chartSpecs: deterministic.chartSpecs || [],
      markdown: deterministic.markdown ? `${markdown}\n\n${deterministic.markdown}` : markdown
    };
  },
  async tower(caseId) {
    const [statsResult, topCellsResult, topNumbersResult, deterministic] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*)::int AS total_records,
            COUNT(DISTINCT NULLIF(a_party, ''))::int AS unique_a_parties,
            COUNT(DISTINCT NULLIF(b_party, ''))::int AS unique_b_parties,
            COUNT(DISTINCT COALESCE(NULLIF(cell_id, ''), NULLIF(first_cell_id, ''), NULLIF(last_cell_id, '')))::int AS unique_towers,
            MIN(start_time)::text AS start_date,
            MAX(start_time)::text AS end_date
          FROM tower_dump_records
          WHERE case_id = $1
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(cell_id, ''), NULLIF(first_cell_id, ''), NULLIF(last_cell_id, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM tower_dump_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(a_party, ''), NULLIF(b_party, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM tower_dump_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      buildTowerInsights({ caseId, topN: 5 })
    ]);

    const stats = statsResult.rows[0] || {};
    const markdown = [
      '**Tower Dump Summary**',
      '',
      `- Total records: ${formatNumber(stats.total_records)}`,
      `- Unique A-Parties: ${formatNumber(stats.unique_a_parties)}`,
      `- Unique B-Parties: ${formatNumber(stats.unique_b_parties)}`,
      `- Unique towers/cells: ${formatNumber(stats.unique_towers)}`,
      `- Time range: ${stats.start_date || 'N/A'} to ${stats.end_date || 'N/A'}`,
      `- Major cell concentrations: ${topCellsResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- High-volume parties: ${topNumbersResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
    ].join('\n');

    return {
      module: 'tower',
      empty: false,
      facts: {
        ...stats,
        topCells: topCellsResult.rows,
        topParties: topNumbersResult.rows
      },
      chartSpecs: deterministic.chartSpecs || [],
      markdown: deterministic.markdown ? `${markdown}\n\n${deterministic.markdown}` : markdown
    };
  },
  async ild(caseId) {
    const [statsResult, topCalledResult, topCountryResult, deterministic] = await Promise.all([
      pool.query(
        `
          SELECT
            COUNT(*)::int AS total_records,
            MIN(COALESCE(date_time::text, call_date)) AS start_date,
            MAX(COALESCE(date_time::text, call_date)) AS end_date,
            COALESCE(SUM(COALESCE(duration_sec, duration, 0)), 0)::bigint AS total_duration_sec
          FROM ild_records
          WHERE case_id = $1
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(called_number, ''), NULLIF(called_party, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM ild_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      pool.query(
        `
          SELECT COALESCE(NULLIF(destination_country, ''), NULLIF(country_code, ''), 'Unknown') AS label, COUNT(*)::int AS count
          FROM ild_records
          WHERE case_id = $1
          GROUP BY 1
          ORDER BY COUNT(*) DESC, label ASC
          LIMIT 5
        `,
        [caseId]
      ),
      buildIldInsights({ caseId, topN: 5 })
    ]);

    const stats = statsResult.rows[0] || {};
    const markdown = [
      '**ILD Summary**',
      '',
      `- Total records: ${formatNumber(stats.total_records)}`,
      `- Date range: ${stats.start_date || 'N/A'} to ${stats.end_date || 'N/A'}`,
      `- Total duration: ${formatNumber(stats.total_duration_sec)} sec`,
      `- Top international contacts: ${topCalledResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`,
      `- Country concentration: ${topCountryResult.rows.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
    ].join('\n');

    return {
      module: 'ild',
      empty: false,
      facts: {
        ...stats,
        topCalledParties: topCalledResult.rows,
        topCountries: topCountryResult.rows
      },
      chartSpecs: deterministic.chartSpecs || [],
      markdown: deterministic.markdown ? `${markdown}\n\n${deterministic.markdown}` : markdown
    };
  },
  async timeline(caseId) {
    const result = await pool.query(
      `
        WITH timeline AS (
          SELECT 'cdr'::text AS source, date_time AS event_time FROM cdr_records WHERE case_id = $1
          UNION ALL
          SELECT 'ipdr'::text AS source, NULL::timestamptz AS event_time FROM ipdr_records WHERE case_id = $1
          UNION ALL
          SELECT 'sdr'::text AS source, NULL::timestamptz AS event_time FROM sdr_records WHERE case_id = $1
          UNION ALL
          SELECT 'tower'::text AS source, start_time AS event_time FROM tower_dump_records WHERE case_id = $1
          UNION ALL
          SELECT 'ild'::text AS source, date_time AS event_time FROM ild_records WHERE case_id = $1
        )
        SELECT
          COUNT(*)::int AS event_count,
          MIN(event_time)::text AS earliest_event,
          MAX(event_time)::text AS latest_event
        FROM timeline
      `,
      [caseId]
    );

    const sourceRows = await pool.query(
      `
        SELECT source, COUNT(*)::int AS count
        FROM (
          SELECT 'cdr'::text AS source FROM cdr_records WHERE case_id = $1
          UNION ALL
          SELECT 'ipdr'::text AS source FROM ipdr_records WHERE case_id = $1
          UNION ALL
          SELECT 'sdr'::text AS source FROM sdr_records WHERE case_id = $1
          UNION ALL
          SELECT 'tower'::text AS source FROM tower_dump_records WHERE case_id = $1
          UNION ALL
          SELECT 'ild'::text AS source FROM ild_records WHERE case_id = $1
        ) timeline
        GROUP BY source
        ORDER BY COUNT(*) DESC, source ASC
      `,
      [caseId]
    );

    const stats = result.rows[0] || {};
    return {
      module: 'timeline',
      empty: false,
      facts: {
        ...stats,
        sources: sourceRows.rows
      },
      markdown: [
        '**Timeline Summary**',
        '',
        `- Event count: ${formatNumber(stats.event_count)}`,
        `- Earliest event: ${stats.earliest_event || 'Timestamp not available yet'}`,
        `- Latest event: ${stats.latest_event || 'Timestamp not available yet'}`,
        `- Contributing modules: ${sourceRows.rows.map((row) => `${MODULE_LABELS[row.source] || row.source} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
      ].join('\n')
    };
  }
};

export const searchCasesForChat = async ({ user, query, limit = 8 } = {}) => {
  const q = normalizeText(query);
  const clampedLimit = Math.max(1, Math.min(20, Number(limit || 8)));
  const scope = buildAccessScope(user);

  if (!q) {
    const result = await pool.query(
      `
        SELECT
          c.id,
          c.case_name,
          c.case_number,
          c.fir_number,
          c.operator,
          c.case_type,
          c.status,
          c.priority,
          c.created_at,
          c.updated_at,
          (SELECT COUNT(*)::int FROM uploaded_files uf WHERE uf.case_id = c.id) AS file_count
        FROM cases c
        ${scope.clause}
        ORDER BY COALESCE(c.updated_at, c.created_at) DESC, c.id DESC
        LIMIT $${scope.nextIndex}
      `,
      [...scope.params, clampedLimit]
    );

    return result.rows.map((row) => ({
      ...mapCaseRow(row, buildAvailability({}, row.file_count)),
      matchRank: 6
    }));
  }

  const prefix = `${q.toLowerCase()}%`;
  const contains = `%${q.toLowerCase()}%`;
  const digits = digitsOnly(q);
  const exactIdPlaceholder = digits ? `$${scope.nextIndex + 3}` : null;
  const limitPlaceholder = digits ? `$${scope.nextIndex + 4}` : `$${scope.nextIndex + 3}`;
  const whereExtra = [
    digits ? `CAST(c.id AS TEXT) = ${exactIdPlaceholder}` : '',
    `LOWER(COALESCE(c.case_number, '')) = LOWER($${scope.nextIndex})`,
    `LOWER(COALESCE(c.fir_number, '')) = LOWER($${scope.nextIndex})`,
    `LOWER(COALESCE(c.case_name, '')) = LOWER($${scope.nextIndex})`,
    `LOWER(COALESCE(c.case_number, '')) LIKE $${scope.nextIndex + 1}`,
    `LOWER(COALESCE(c.fir_number, '')) LIKE $${scope.nextIndex + 1}`,
    `LOWER(COALESCE(c.case_name, '')) LIKE $${scope.nextIndex + 1}`,
    `LOWER(COALESCE(c.case_number, '')) LIKE $${scope.nextIndex + 2}`,
    `LOWER(COALESCE(c.fir_number, '')) LIKE $${scope.nextIndex + 2}`,
    `LOWER(COALESCE(c.case_name, '')) LIKE $${scope.nextIndex + 2}`
  ].filter(Boolean).join(' OR ');

  const merged = mergeWhereClause(scope.clause, whereExtra, digits ? [q, prefix, contains, digits] : [q, prefix, contains]);
  const paramOffset = scope.nextIndex;
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.case_name,
        c.case_number,
        c.fir_number,
        c.operator,
        c.case_type,
        c.status,
        c.priority,
        c.created_at,
        c.updated_at,
        (SELECT COUNT(*)::int FROM uploaded_files uf WHERE uf.case_id = c.id) AS file_count,
        CASE
          ${digits ? `WHEN CAST(c.id AS TEXT) = ${exactIdPlaceholder} THEN 1` : ''}
          WHEN LOWER(COALESCE(c.case_number, '')) = LOWER($${paramOffset}) OR LOWER(COALESCE(c.fir_number, '')) = LOWER($${paramOffset}) THEN 2
          WHEN LOWER(COALESCE(c.case_name, '')) = LOWER($${paramOffset}) THEN 3
          WHEN LOWER(COALESCE(c.case_number, '')) LIKE $${paramOffset + 1} OR LOWER(COALESCE(c.fir_number, '')) LIKE $${paramOffset + 1} OR LOWER(COALESCE(c.case_name, '')) LIKE $${paramOffset + 1} THEN 4
          ELSE 5
        END AS match_rank
      FROM cases c
      ${merged.whereClause}
      ORDER BY match_rank ASC, COALESCE(c.updated_at, c.created_at) DESC, c.id DESC
      LIMIT ${limitPlaceholder}
    `,
    [...scope.params, ...merged.params, clampedLimit]
  );

  return result.rows.map((row) => ({
    ...mapCaseRow(row, buildAvailability({}, row.file_count)),
    matchRank: Number(row.match_rank || 5)
  }));
};

export const resolveCaseReference = async ({ user, caseId, firNumber, reference } = {}) => {
  const normalizedCaseId = Number(caseId);
  const scope = buildAccessScope(user);

  if (Number.isFinite(normalizedCaseId) && normalizedCaseId > 0) {
    const merged = mergeWhereClause(scope.clause, `c.id = $${scope.nextIndex}`, [normalizedCaseId]);
    const result = await pool.query(`${baseCaseSelect} ${merged.whereClause} LIMIT 1`, [...scope.params, ...merged.params]);
    return {
      caseRow: result.rows[0] || null,
      ambiguous: false,
      candidates: result.rows.slice(0, 1)
    };
  }

  const ref = normalizeText(reference || firNumber).replace(/^@+/, '');
  if (!ref) {
    return { caseRow: null, ambiguous: false, candidates: [] };
  }

  const results = await searchCasesForChat({ user, query: ref, limit: 5 });
  if (results.length === 0) {
    return { caseRow: null, ambiguous: false, candidates: [] };
  }

  const bestRank = Number(results[0].matchRank || 5);
  const topMatches = results.filter((row) => Number(row.matchRank || 5) === bestRank);
  const ambiguous = topMatches.length > 1 && bestRank <= 3;
  const selected = ambiguous ? null : topMatches[0];

  return {
    caseRow: selected
      ? {
          id: Number(selected.id),
          case_name: selected.caseName,
          case_number: selected.caseNumber,
          fir_number: selected.firNumber,
          operator: selected.operator,
          case_type: selected.caseType,
          status: selected.status,
          created_at: selected.createdAt,
          updated_at: selected.updatedAt
        }
      : null,
    ambiguous,
    candidates: topMatches
  };
};

export const fetchCaseKnowledge = async (caseId, { user } = {}) => {
  const normalizedCaseId = Number(caseId);
  if (!Number.isFinite(normalizedCaseId) || normalizedCaseId <= 0) return null;

  const scope = buildAccessScope(user);
  const merged = mergeWhereClause(scope.clause, `c.id = $${scope.nextIndex}`, [normalizedCaseId]);
  const caseResult = await pool.query(`${baseCaseSelect} ${merged.whereClause} LIMIT 1`, [...scope.params, ...merged.params]);
  const caseRow = caseResult.rows[0];
  if (!caseRow) return null;

  const [countsResult, fileResult] = await Promise.all([
    pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM cdr_records WHERE case_id = $1) AS cdr_count,
          (SELECT COUNT(*)::int FROM ipdr_records WHERE case_id = $1) AS ipdr_count,
          (SELECT COUNT(*)::int FROM sdr_records WHERE case_id = $1) AS sdr_count,
          (SELECT COUNT(*)::int FROM tower_dump_records WHERE case_id = $1) AS tower_count,
          (SELECT COUNT(*)::int FROM ild_records WHERE case_id = $1) AS ild_count,
          (
            (SELECT COUNT(*)::int FROM cdr_records WHERE case_id = $1)
            + (SELECT COUNT(*)::int FROM ipdr_records WHERE case_id = $1)
            + (SELECT COUNT(*)::int FROM sdr_records WHERE case_id = $1)
            + (SELECT COUNT(*)::int FROM tower_dump_records WHERE case_id = $1)
            + (SELECT COUNT(*)::int FROM ild_records WHERE case_id = $1)
          )::int AS timeline_count
      `,
      [caseRow.id]
    ),
    pool.query(
      `
        SELECT
          uf.id,
          uf.file_name,
          uf.original_name,
          uf.file_type,
          uf.parse_status,
          uf.record_count,
          uf.uploaded_at,
          fc.detected_type,
          fc.confidence,
          fc.classification_result
        FROM uploaded_files uf
        LEFT JOIN file_classifications fc ON fc.file_id = uf.id
        WHERE uf.case_id = $1
        ORDER BY uf.uploaded_at DESC, uf.id DESC
        LIMIT 20
      `,
      [caseRow.id]
    )
  ]);

  const datasetCounts = buildDatasetCountShape(countsResult.rows[0]);
  const fileRows = fileResult.rows || [];
  const availability = buildAvailability(datasetCounts, fileRows.length);
  const mappedFiles = fileRows.map((file) => ({
    id: String(file.id),
    originalName: file.original_name || file.file_name || `File ${file.id}`,
    fileName: file.file_name || null,
    fileType: file.file_type || null,
    detectedType: file.detected_type || null,
    confidence: file.confidence ?? null,
    parseStatus: file.parse_status || null,
    recordCount: Number(file.record_count || 0),
    classificationResult: file.classification_result || null,
    uploadedAt: file.uploaded_at || null
  }));

  return {
    case: mapCaseRow(caseRow, availability),
    files: {
      totalUploadedFiles: fileRows.length,
      latestUploadAt: fileRows[0]?.uploaded_at || null,
      items: mappedFiles
    },
    datasetCounts,
    availability,
    sources: buildSourceMetadata(caseRow, fileRows, [
      'uploaded_files',
      'file_classifications',
      ...MODULE_ORDER.filter((key) => availability[key]).map((key) => {
        if (key === 'cdr') return 'cdr_records';
        if (key === 'ipdr') return 'ipdr_records';
        if (key === 'sdr') return 'sdr_records';
        if (key === 'tower') return 'tower_dump_records';
        if (key === 'ild') return 'ild_records';
        return null;
      })
    ])
  };
};

export const buildCaseKnowledgeContract = async (caseId, { user, focusModule = null } = {}) => {
  const knowledge = await fetchCaseKnowledge(caseId, { user });
  if (!knowledge) return null;

  const wantedModules = new Set(['overview']);
  if (!focusModule) {
    wantedModules.add('files');
    MODULE_ORDER.forEach((module) => wantedModules.add(module));
  } else if (focusModule === 'files') {
    wantedModules.add('files');
  } else if (focusModule !== 'overview') {
    wantedModules.add(focusModule);
  }

  const summaries = {
    overview: wantedModules.has('overview') ? buildOverviewSummary(knowledge) : null,
    files: wantedModules.has('files') ? buildFilesSummary(knowledge) : null,
    cdr: wantedModules.has('cdr') && knowledge.availability.cdr
      ? await moduleSummaryQueries.cdr(caseId)
      : (wantedModules.has('cdr') ? buildEmptyModuleSummary('cdr', 'This case has no CDR records yet.', 'Upload a CDR file or ask for another available module.') : null),
    ipdr: wantedModules.has('ipdr') && knowledge.availability.ipdr
      ? await moduleSummaryQueries.ipdr(caseId)
      : (wantedModules.has('ipdr') ? buildEmptyModuleSummary('ipdr', 'This case has no IPDR records yet.', 'Upload an IPDR file or ask for another available module.') : null),
    sdr: wantedModules.has('sdr') && knowledge.availability.sdr
      ? await moduleSummaryQueries.sdr(caseId)
      : (wantedModules.has('sdr') ? buildEmptyModuleSummary('sdr', 'This case has no subscriber detail records yet.', 'Upload an SDR file or ask for another available module.') : null),
    tower: wantedModules.has('tower') && knowledge.availability.tower
      ? await moduleSummaryQueries.tower(caseId)
      : (wantedModules.has('tower') ? buildEmptyModuleSummary('tower', 'This case has no Tower Dump records yet.', 'Upload a Tower Dump file or ask for another available module.') : null),
    ild: wantedModules.has('ild') && knowledge.availability.ild
      ? await moduleSummaryQueries.ild(caseId)
      : (wantedModules.has('ild') ? buildEmptyModuleSummary('ild', 'This case has no ILD records yet.', 'Upload an ILD file or ask for another available module.') : null),
    timeline: wantedModules.has('timeline') && knowledge.availability.timeline
      ? await moduleSummaryQueries.timeline(caseId)
      : (wantedModules.has('timeline') ? buildEmptyModuleSummary('timeline', 'This case has no timeline data yet.', 'Upload records with timestamps or ask for another available module.') : null)
  };

  return {
    version: 'case-knowledge-v1',
    ...knowledge,
    summaries
  };
};

export const getCaseModuleSummary = async (caseId, module = 'overview', { user } = {}) => {
  const knowledge = await fetchCaseKnowledge(caseId, { user });
  if (!knowledge) return null;

  if (module === 'overview') return buildOverviewSummary(knowledge);
  if (module === 'files') return buildFilesSummary(knowledge);
  if (!moduleSummaryQueries[module]) return null;

  if (!knowledge.availability[module]) {
    if (module === 'cdr') return buildEmptyModuleSummary('cdr', 'This case has no CDR records yet.', 'Upload a CDR file or ask for another available module.');
    if (module === 'ipdr') return buildEmptyModuleSummary('ipdr', 'This case has no IPDR records yet.', 'Upload an IPDR file or ask for another available module.');
    if (module === 'sdr') return buildEmptyModuleSummary('sdr', 'This case has no subscriber detail records yet.', 'Upload an SDR file or ask for another available module.');
    if (module === 'tower') return buildEmptyModuleSummary('tower', 'This case has no Tower Dump records yet.', 'Upload a Tower Dump file or ask for another available module.');
    if (module === 'ild') return buildEmptyModuleSummary('ild', 'This case has no ILD records yet.', 'Upload an ILD file or ask for another available module.');
    if (module === 'timeline') return buildEmptyModuleSummary('timeline', 'This case has no timeline data yet.', 'Upload records with timestamps or ask for another available module.');
  }

  return moduleSummaryQueries[module](caseId);
};

const sanitizePromptText = (value = '') =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const truncatePromptText = (value = '', maxLength = 900) => {
  const text = sanitizePromptText(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 14)).trimEnd()}\n...<truncated>`;
};

const buildSummarySnippet = (summary, maxLength = 900) => {
  if (!summary?.markdown) return '- No summary available.';
  return truncatePromptText(summary.markdown, maxLength);
};

const buildSummaryFactsBlock = (summary) => {
  const facts = summary?.facts;
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) return '';

  try {
    const json = JSON.stringify(facts, null, 2);
    if (!json || json === '{}') return '';
    return truncatePromptText(json, 700);
  } catch {
    return '';
  }
};

export const buildCaseContextPrompt = (knowledge, { compact = false, focusModule = null } = {}) => {
  if (!knowledge?.case) return '';

  const availableModules = MODULE_ORDER.filter((key) => knowledge.availability?.[key]).map((key) => MODULE_LABELS[key]);
  const fileSummary = (knowledge.files?.items || [])
    .slice(0, compact ? 3 : 5)
    .map((file) => `- ${file.originalName} | type=${file.detectedType || file.fileType || 'unknown'} | status=${file.parseStatus || 'unknown'} | confidence=${file.confidence ?? 'n/a'}`)
    .join('\n');
  const orderedSummaryEntries = [
    ['overview', 'OVERVIEW SUMMARY'],
    ['files', 'FILES SUMMARY'],
    ['cdr', 'CDR SUMMARY'],
    ['ipdr', 'IPDR SUMMARY'],
    ['sdr', 'SDR SUMMARY'],
    ['tower', 'TOWER DUMP SUMMARY'],
    ['ild', 'ILD SUMMARY'],
    ['timeline', 'TIMELINE SUMMARY']
  ].filter(([key]) => {
    if (!focusModule) return true;
    return key === 'overview' || key === focusModule || (focusModule === 'files' && key === 'files');
  });
  const summaryBlocks = knowledge.summaries
    ? [
        ...orderedSummaryEntries
      ].map(([key, label]) => {
        const summary = knowledge.summaries?.[key];
        if (!summary) return '';
        const factsBlock = buildSummaryFactsBlock(summary);
        const maxLength = compact
          ? (key === 'overview' ? 520 : 360)
          : (key === 'overview' ? 1200 : 900);

        return [
          `${label}:`,
          buildSummarySnippet(summary, maxLength),
          factsBlock ? '' : null,
          factsBlock ? 'STRUCTURED FACTS:' : null,
          factsBlock ? truncatePromptText(factsBlock, compact ? 420 : 700) : null
        ].filter(Boolean).join('\n');
      }).filter(Boolean).join('\n\n')
    : '';

  return [
    'ACTIVE CASE CONTEXT:',
    `- Case ID: ${knowledge.case.id}`,
    `- Case Name: ${knowledge.case.caseName || 'N/A'}`,
    `- Case Number: ${knowledge.case.caseNumber || 'N/A'}`,
    `- FIR Number: ${knowledge.case.firNumber || 'N/A'}`,
    `- Case Type: ${knowledge.case.caseType || 'N/A'}`,
    `- Operator: ${knowledge.case.operator || 'N/A'}`,
    `- Status: ${knowledge.case.status || 'N/A'}`,
    `- Description: ${knowledge.case.description || knowledge.case.investigationDetails || 'N/A'}`,
    '',
    'AVAILABLE DATASET COUNTS:',
    `- CDR: ${knowledge.datasetCounts?.cdr ?? 0}`,
    `- IPDR: ${knowledge.datasetCounts?.ipdr ?? 0}`,
    `- SDR: ${knowledge.datasetCounts?.sdr ?? 0}`,
    `- Tower Dump: ${knowledge.datasetCounts?.tower ?? 0}`,
    `- ILD: ${knowledge.datasetCounts?.ild ?? 0}`,
    `- Timeline: ${knowledge.datasetCounts?.timeline ?? 0}`,
    '',
    `ACTIVE MODULES: ${availableModules.join(', ') || 'Metadata only'}`,
    '',
    'RECENT FILES:',
    fileSummary || '- No uploaded files found for this case.',
    '',
    summaryBlocks ? 'CASE ANALYTICS KNOWLEDGE BASE:' : null,
    summaryBlocks || null,
    summaryBlocks ? '' : null,
    'RULES:',
    '- Only answer when the current user message explicitly tagged this case.',
    '- If the requested fact is not present in the provided case context, say so clearly.',
    '- Do not invent case facts.',
    '- Prefer deterministic case facts and module summaries over generic model knowledge.',
    '- If a case fact is explicitly present in the knowledge base above, answer from it directly instead of suggesting SQL.'
  ].filter(Boolean).join('\n');
};

export const buildCaseCitationBlock = ({ knowledge, tables = [] } = {}) => {
  if (!knowledge?.case) return '';

  const lines = [
    '**Sources**',
    `- Case: ${knowledge.case.caseName || `Case ${knowledge.case.id}`} (#${knowledge.case.id})`,
    `- Tables: ${unique([...(knowledge.sources?.tables || []), ...tables]).join(', ')}`
  ];

  if (knowledge.files?.items?.length) {
    lines.push('- Files used:');
    knowledge.files.items.slice(0, 5).forEach((file) => {
      lines.push(`- ${file.originalName} (${file.detectedType || file.fileType || 'unknown'}, confidence: ${file.confidence ?? 'n/a'})`);
    });
  }

  return lines.join('\n');
};
