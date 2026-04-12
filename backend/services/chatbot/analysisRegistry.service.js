import pool from '../../config/database.js';
import { getCaseModuleSummary } from './caseContext.service.js';
import {
  getOrBuildCaseMemorySnapshot,
  normalizeFileIds
} from './caseMemorySnapshot.service.js';
import { getMetricDefinition } from './metricRegistry.service.js';

const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');
const formatDuration = (value) => `${Math.round(Number(value || 0))}s`;

const buildScopedClause = (caseId, fileIds = [], startIndex = 1) => {
  const params = [Number(caseId)];
  let clause = `case_id = $${startIndex}`;

  const normalizedFileIds = normalizeFileIds(fileIds);
  if (normalizedFileIds.length > 0) {
    params.push(normalizedFileIds);
    clause += ` AND file_id = ANY($${startIndex + 1}::int[])`;
  }

  return { clause, params, fileIds: normalizedFileIds };
};

const parseSearchTerm = (message = '', workspaceContext = null) => {
  const currentSearch = String(workspaceContext?.searchState?.query || workspaceContext?.filters?.search || '').trim();
  if (currentSearch) return { term: currentSearch, source: 'workspace' };

  const text = String(message || '').trim();
  const quoted = text.match(/"([^"]{2,})"/);
  if (quoted?.[1]) return { term: quoted[1].trim(), source: 'quoted' };

  const email = text.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  if (email?.[0]) return { term: email[0], source: 'email' };

  const ip = text.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
  if (ip?.[0]) return { term: ip[0], source: 'ip' };

  const phone = text.match(/\b(?:91[-\s]?)?[6-9]\d{9}\b/);
  if (phone?.[0]) return { term: phone[0].replace(/\D/g, '').slice(-10), source: 'phone' };

  const recordPhrase = text.match(/\b(?:find|show|search|lookup|look up|get)\b[\s:]+(.{2,80})$/i);
  if (recordPhrase?.[1]) return { term: recordPhrase[1].trim(), source: 'phrase' };

  return null;
};

const shouldRunRecordQuery = (message = '', workspaceContext = null) => {
  const text = String(message || '').toLowerCase();
  if (workspaceContext?.view === 'records' && parseSearchTerm(message, workspaceContext)) return true;
  return /\b(find|show|search|lookup|look up|get)\b/.test(text)
    && /\b(record|records|calls|sessions|rows|subscriber|number|email|ip|party)\b/.test(text)
    && Boolean(parseSearchTerm(message, workspaceContext));
};

const buildRecordSearchPattern = (term = '') => `%${String(term || '').trim()}%`;

const formatPreviewLines = (rows = [], formatter) =>
  rows.length > 0 ? rows.map((row, index) => `${index + 1}. ${formatter(row)}`) : ['No verified rows matched the current record query.'];

const buildSummaryFromFacts = (title, lines = [], facts = {}, artifacts = {}, sources = {}) => {
  const markdown = [`**${title}**`, '', ...lines].join('\n');
  return {
    markdown,
    facts,
    insights: {},
    artifacts: {
      ...artifacts,
      summaryMarkdown: markdown
    },
    sources
  };
};

const buildGenericRecordQuery = async ({ table, caseId, fileIds = [], term, selectSql, orderSql, whereSql, formatter, limit = 5 }) => {
  const scoped = buildScopedClause(caseId, fileIds);
  const pattern = buildRecordSearchPattern(term);
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 5)));
  const result = await pool.query(
    `
      SELECT ${selectSql}
      FROM ${table}
      WHERE ${scoped.clause}
        AND (${whereSql.replaceAll('$TERM', `$${scoped.params.length + 1}`)})
      ${orderSql}
      LIMIT ${safeLimit}
    `,
    [...scoped.params, pattern]
  );

  return {
    resultCount: result.rows.length,
    preview: result.rows,
    lines: formatPreviewLines(result.rows, formatter)
  };
};

const formatTrafficVolume = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 B';
  if (numeric >= 1024 ** 3) return `${(numeric / (1024 ** 3)).toFixed(2)} GB`;
  if (numeric >= 1024 ** 2) return `${(numeric / (1024 ** 2)).toFixed(2)} MB`;
  if (numeric >= 1024) return `${(numeric / 1024).toFixed(2)} KB`;
  return `${Math.round(numeric)} B`;
};

const buildCommonValueSummary = async ({ table, caseId, fileIds = [], valueSql, tables = [] }) => {
  const normalizedSelection = normalizeFileIds(fileIds);
  let effectiveFileIds = normalizedSelection;

  if (effectiveFileIds.length <= 1) {
    const fileResult = await pool.query(
      `SELECT DISTINCT file_id FROM ${table} WHERE case_id = $1 AND file_id IS NOT NULL ORDER BY file_id ASC`,
      [Number(caseId)]
    );
    effectiveFileIds = normalizeFileIds(fileResult.rows.map((row) => row.file_id));
  }

  if (effectiveFileIds.length <= 1) {
    return {
      hasMultipleFiles: false,
      fileIds: effectiveFileIds,
      common: [],
      sources: { tables }
    };
  }

  const result = await pool.query(
    `
      SELECT file_id, ${valueSql} AS value
      FROM ${table}
      WHERE case_id = $1
        AND file_id = ANY($2::int[])
        AND NULLIF(${valueSql}, '') IS NOT NULL
      GROUP BY file_id, ${valueSql}
      ORDER BY file_id ASC
    `,
    [Number(caseId), effectiveFileIds]
  );

  const grouped = new Map();
  for (const row of result.rows || []) {
    const fileId = Number(row.file_id);
    const value = String(row.value || '').trim();
    if (!value) continue;
    if (!grouped.has(fileId)) grouped.set(fileId, new Set());
    grouped.get(fileId).add(value);
  }

  if (grouped.size <= 1) {
    return {
      hasMultipleFiles: false,
      fileIds: effectiveFileIds,
      common: [],
      sources: { tables }
    };
  }

  const sets = [...grouped.values()];
  let common = [...sets[0]];
  for (let index = 1; index < sets.length; index += 1) {
    common = common.filter((value) => sets[index].has(value));
  }

  return {
    hasMultipleFiles: true,
    fileIds: effectiveFileIds,
    common: common.slice(0, 50),
    sources: { tables }
  };
};

const buildCdrScopedSummary = async ({ caseId, fileIds = [], view = 'overview' }) => {
  const scoped = buildScopedClause(caseId, fileIds);
  const [
    statsResult,
    callTypesResult,
    hourlyResult,
    topBResult,
    topLocationResult,
    roamingResult,
    topImeiResult,
    topImsiResult,
    smsAnalysisResult,
    regularCallersResult,
    internationalCallsResult,
    dailyFirstLastResult,
    homeLocationResult,
    workLocationResult,
    commonNumbers,
    commonImei,
    commonImsi,
    commonLocations
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(DISTINCT NULLIF(calling_number, ''))::int AS unique_a_parties,
          COUNT(DISTINCT NULLIF(called_number, ''))::int AS unique_b_parties,
          ROUND(COALESCE(AVG(NULLIF(duration_sec, 0)), 0))::int AS avg_duration_sec,
          COALESCE(SUM(duration_sec), 0)::int AS total_duration_sec
        FROM cdr_records
        WHERE ${scoped.clause}
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(call_type, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM cdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 8
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT
          COALESCE(EXTRACT(HOUR FROM date_time AT TIME ZONE 'Asia/Kolkata')::int, NULLIF(SPLIT_PART(call_time, ':', 1), '')::int, 0) AS hour,
          COUNT(*)::int AS count
        FROM cdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY hour ASC
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(called_number, ''), 'Unknown') AS label, COUNT(*)::int AS count, COALESCE(SUM(duration_sec), 0)::int AS duration_sec
        FROM cdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, duration_sec DESC, label ASC
        LIMIT 5
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(first_cell_id, ''), NULLIF(last_cell_id, ''), 'Unknown') AS label, COUNT(*)::int AS count, COALESCE(SUM(duration_sec), 0)::int AS duration_sec
        FROM cdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, duration_sec DESC, label ASC
        LIMIT 6
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(roaming, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM cdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 6
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(imei_a, ''), NULLIF(imei_b, ''), NULLIF(raw_data->>'imei', ''), NULLIF(raw_data->>'imei_a', ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM cdr_records
        WHERE ${scoped.clause}
          AND COALESCE(NULLIF(imei_a, ''), NULLIF(imei_b, ''), NULLIF(raw_data->>'imei', ''), NULLIF(raw_data->>'imei_a', '')) IS NOT NULL
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 10
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT NULLIF(raw_data->>'imsi', '') AS label, COUNT(*)::int AS count
        FROM cdr_records
        WHERE ${scoped.clause}
          AND NULLIF(raw_data->>'imsi', '') IS NOT NULL
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 10
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE UPPER(COALESCE(call_type, '')) LIKE '%SMS%' OR UPPER(COALESCE(call_type, '')) LIKE '%SMO%')::int AS sent,
          COUNT(*) FILTER (WHERE UPPER(COALESCE(call_type, '')) LIKE '%SMT%' OR UPPER(COALESCE(call_type, '')) LIKE '%DSM%')::int AS received
        FROM cdr_records
        WHERE ${scoped.clause}
          AND (
            UPPER(COALESCE(call_type, '')) LIKE '%SMS%'
            OR UPPER(COALESCE(call_type, '')) LIKE '%SMO%'
            OR UPPER(COALESCE(call_type, '')) LIKE '%SMT%'
            OR UPPER(COALESCE(call_type, '')) LIKE '%DSM%'
          )
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(called_number, ''), 'Unknown') AS phone, COUNT(*)::int AS count, COUNT(DISTINCT NULLIF(call_date, ''))::int AS days_active
        FROM cdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        HAVING COUNT(*) >= 3
        ORDER BY count DESC, days_active DESC, phone ASC
        LIMIT 25
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(called_number, ''), 'Unknown') AS number, call_date AS date, call_time AS time, COALESCE(duration_sec, 0)::int AS duration_sec
        FROM cdr_records
        WHERE ${scoped.clause}
          AND COALESCE(NULLIF(called_number, ''), '') <> ''
          AND NOT (
            REGEXP_REPLACE(called_number, '[^0-9+]', '', 'g') ~ '^(\\+91|91[6-9][0-9]{9}|[6-9][0-9]{9})$'
          )
        ORDER BY duration_sec DESC, date_time DESC NULLS LAST
        LIMIT 25
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT
          call_date AS label,
          MIN(NULLIF(call_time, '')) AS first_call_time,
          MAX(NULLIF(call_time, '')) AS last_call_time
        FROM cdr_records
        WHERE ${scoped.clause}
          AND NULLIF(call_date, '') IS NOT NULL
        GROUP BY 1
        ORDER BY label DESC
        LIMIT 30
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(first_cell_id, ''), 'Unknown') AS cell_id, COUNT(*)::int AS count
        FROM cdr_records
        WHERE ${scoped.clause}
          AND COALESCE(NULLIF(first_cell_id, ''), '') <> ''
          AND (
            COALESCE(EXTRACT(HOUR FROM date_time AT TIME ZONE 'Asia/Kolkata')::int, NULLIF(SPLIT_PART(call_time, ':', 1), '')::int, -1) >= 22
            OR COALESCE(EXTRACT(HOUR FROM date_time AT TIME ZONE 'Asia/Kolkata')::int, NULLIF(SPLIT_PART(call_time, ':', 1), '')::int, -1) < 6
          )
        GROUP BY 1
        ORDER BY count DESC, cell_id ASC
        LIMIT 5
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(first_cell_id, ''), 'Unknown') AS cell_id, COUNT(*)::int AS count
        FROM cdr_records
        WHERE ${scoped.clause}
          AND COALESCE(NULLIF(first_cell_id, ''), '') <> ''
          AND COALESCE(EXTRACT(HOUR FROM date_time AT TIME ZONE 'Asia/Kolkata')::int, NULLIF(SPLIT_PART(call_time, ':', 1), '')::int, -1) BETWEEN 9 AND 18
        GROUP BY 1
        ORDER BY count DESC, cell_id ASC
        LIMIT 5
      `,
      scoped.params
    ),
    buildCommonValueSummary({
      table: 'cdr_records',
      caseId,
      fileIds,
      valueSql: 'COALESCE(NULLIF(called_number, \'\'), NULLIF(raw_data->>\'b_party\', \'\'))',
      tables: ['cdr_records']
    }),
    buildCommonValueSummary({
      table: 'cdr_records',
      caseId,
      fileIds,
      valueSql: 'COALESCE(NULLIF(imei_a, \'\'), NULLIF(imei_b, \'\'), NULLIF(raw_data->>\'imei\', \'\'), NULLIF(raw_data->>\'imei_a\', \'\'))',
      tables: ['cdr_records']
    }),
    buildCommonValueSummary({
      table: 'cdr_records',
      caseId,
      fileIds,
      valueSql: 'NULLIF(raw_data->>\'imsi\', \'\')',
      tables: ['cdr_records']
    }),
    buildCommonValueSummary({
      table: 'cdr_records',
      caseId,
      fileIds,
      valueSql: 'COALESCE(NULLIF(first_cell_id, \'\'), NULLIF(last_cell_id, \'\'))',
      tables: ['cdr_records']
    })
  ]);

  const smsStats = smsAnalysisResult.rows[0] || {};
  const facts = {
    ...(statsResult.rows[0] || {}),
    callTypeDistribution: callTypesResult.rows || [],
    hourlyActivity: (hourlyResult.rows || []).map((row) => ({ hour: String(row.hour).padStart(2, '0'), count: Number(row.count || 0) })),
    topBParties: topBResult.rows || [],
    topLocations: topLocationResult.rows || [],
    roamingSummary: roamingResult.rows || [],
    max_imei_numbers: topImeiResult.rows || [],
    max_imsi_numbers: topImsiResult.rows || [],
    max_b_parties: topBResult.rows || [],
    sms_analysis: {
      total: Number(smsStats.total || 0),
      sent: Number(smsStats.sent || 0),
      received: Number(smsStats.received || 0)
    },
    night_activity: {
      total_records: Number((hourlyResult.rows || []).filter((row) => Number(row.hour) >= 20 || Number(row.hour) < 7).reduce((sum, row) => sum + Number(row.count || 0), 0)),
      peak_hours: (hourlyResult.rows || []).filter((row) => Number(row.hour) >= 20 || Number(row.hour) < 7)
    },
    regular_callers: regularCallersResult.rows || [],
    international_calls: internationalCallsResult.rows || [],
    daily_first_last_call: dailyFirstLastResult.rows || [],
    home_and_work: {
      topHome: homeLocationResult.rows || [],
      topWork: workLocationResult.rows || []
    },
    common_numbers: commonNumbers,
    common_imei_numbers: commonImei,
    common_imsi_numbers: commonImsi,
    common_locations: commonLocations,
    location_summary: {
      top_cell_ids: topLocationResult.rows || []
    }
  };

  const lines = [
    `- Total records: ${formatNumber(facts.total_records)}`,
    `- Unique A-Parties: ${formatNumber(facts.unique_a_parties)}`,
    `- Unique B-Parties: ${formatNumber(facts.unique_b_parties)}`,
    `- Average duration: ${formatDuration(facts.avg_duration_sec)}`,
    `- Call types: ${facts.callTypeDistribution.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
  ];
  if (view === 'advanced') {
    lines.push(`- Top B-Parties: ${facts.topBParties.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`);
    lines.push(`- Top locations: ${facts.topLocations.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`);
    lines.push(`- Common IMEI numbers: ${facts.common_imei_numbers?.hasMultipleFiles ? (facts.common_imei_numbers.common.join(', ') || 'None found') : 'Requires multiple files'}`);
    lines.push(`- Common IMSI numbers: ${facts.common_imsi_numbers?.hasMultipleFiles ? (facts.common_imsi_numbers.common.join(', ') || 'None found') : 'Requires multiple files'}`);
  }
  if (view === 'location' || view === 'roaming') {
    lines.push(`- Roaming summary: ${facts.roamingSummary.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`);
  }

  return buildSummaryFromFacts('CDR Scoped Snapshot', lines, facts, { view }, { tables: ['cdr_records'] });
};

const buildIpdrScopedSummary = async ({ caseId, fileIds = [], view = 'overview' }) => {
  const scoped = buildScopedClause(caseId, fileIds);
  const [
    statsResult,
    topIpResult,
    topMsisdnResult,
    topImeiResult,
    topImsiResult,
    topDestinationIpResult,
    commonMsisdn,
    commonImei
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(DISTINCT NULLIF(msisdn, ''))::int AS unique_msisdn,
          COUNT(DISTINCT NULLIF(imei, ''))::int AS unique_imei,
          COUNT(DISTINCT NULLIF(imsi, ''))::int AS unique_imsi,
          COALESCE(SUM(total_volume), 0)::bigint AS total_volume,
          COUNT(*) FILTER (WHERE COALESCE(total_volume, 0) > 0)::int AS records_with_volume
        FROM ipdr_records
        WHERE ${scoped.clause}
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(source_ip, ''), NULLIF(destination_ip, ''), NULLIF(public_ip, ''), NULLIF(private_ip, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM ipdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 6
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(msisdn, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM ipdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 5
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(imei, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM ipdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 8
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(imsi, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM ipdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 8
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(destination_ip, ''), NULLIF(public_ip, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM ipdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 6
      `,
      scoped.params
    ),
    buildCommonValueSummary({
      table: 'ipdr_records',
      caseId,
      fileIds,
      valueSql: 'NULLIF(msisdn, \'\')',
      tables: ['ipdr_records']
    }),
    buildCommonValueSummary({
      table: 'ipdr_records',
      caseId,
      fileIds,
      valueSql: 'NULLIF(imei, \'\')',
      tables: ['ipdr_records']
    })
  ]);

  const facts = {
    ...(statsResult.rows[0] || {}),
    topSourceIps: topIpResult.rows || [],
    topMsisdn: topMsisdnResult.rows || [],
    top_msisdn: topMsisdnResult.rows || [],
    max_imei_numbers: topImeiResult.rows || [],
    max_imsi_numbers: topImsiResult.rows || [],
    top_source_ips: topIpResult.rows || [],
    top_destination_ips: topDestinationIpResult.rows || [],
    data_volume: Number(statsResult.rows?.[0]?.total_volume || 0),
    common_msisdn: commonMsisdn,
    common_imei_numbers: commonImei
  };

  const lines = [
    `- Total sessions: ${formatNumber(facts.total_records)}`,
    `- Unique MSISDN: ${formatNumber(facts.unique_msisdn)}`,
    `- Unique IMEI: ${formatNumber(facts.unique_imei)}`,
    `- Unique IMSI: ${formatNumber(facts.unique_imsi)}`,
    `- Data volume: ${formatTrafficVolume(facts.total_volume)}`,
    `- Top source/destination IPs: ${facts.topSourceIps.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
  ];
  if (view === 'map' || view === 'charts' || view === 'advanced') {
    lines.push(`- Top MSISDN: ${facts.topMsisdn.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`);
    lines.push(`- Common IMEI numbers: ${facts.common_imei_numbers?.hasMultipleFiles ? (facts.common_imei_numbers.common.join(', ') || 'None found') : 'Requires multiple files'}`);
  }

  return buildSummaryFromFacts('IPDR Scoped Snapshot', lines, facts, { view }, { tables: ['ipdr_records'] });
};

const buildSdrScopedSummary = async ({ caseId, fileIds = [] }) => {
  const scoped = buildScopedClause(caseId, fileIds);
  const [statsResult, topNamesResult, topNumbersResult] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(*) FILTER (WHERE NULLIF(subscriber_name, '') IS NOT NULL)::int AS subscriber_name_rows,
          COUNT(*) FILTER (WHERE NULLIF(msisdn, '') IS NOT NULL)::int AS msisdn_rows,
          COUNT(*) FILTER (WHERE NULLIF(email, '') IS NOT NULL)::int AS email_rows
        FROM sdr_records
        WHERE ${scoped.clause}
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(subscriber_name, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM sdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 5
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(msisdn, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM sdr_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 5
      `,
      scoped.params
    )
  ]);

  const facts = {
    ...(statsResult.rows[0] || {}),
    topSubscriberNames: topNamesResult.rows || [],
    topPhoneNumbers: topNumbersResult.rows || []
  };

  return buildSummaryFromFacts(
    'SDR Scoped Snapshot',
    [
      `- Total records: ${formatNumber(facts.total_records)}`,
      `- Subscriber names available: ${formatNumber(facts.subscriber_name_rows)}`,
      `- MSISDN available: ${formatNumber(facts.msisdn_rows)}`,
      `- Email available: ${formatNumber(facts.email_rows)}`,
      `- Top subscriber names: ${facts.topSubscriberNames.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
    ],
    facts,
    {},
    { tables: ['sdr_records'] }
  );
};

const buildTowerScopedSummary = async ({ caseId, fileIds = [], view = 'overview' }) => {
  const scoped = buildScopedClause(caseId, fileIds);
  const [statsResult, topCellsResult, topPartiesResult] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(DISTINCT NULLIF(a_party, ''))::int AS unique_a_parties,
          COUNT(DISTINCT NULLIF(b_party, ''))::int AS unique_b_parties,
          COUNT(DISTINCT COALESCE(NULLIF(cell_id, ''), NULLIF(first_cell_id, ''), NULLIF(last_cell_id, '')))::int AS unique_towers
        FROM tower_dump_records
        WHERE ${scoped.clause}
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(cell_id, ''), NULLIF(first_cell_id, ''), NULLIF(last_cell_id, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM tower_dump_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 6
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(a_party, ''), NULLIF(b_party, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM tower_dump_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 6
      `,
      scoped.params
    )
  ]);

  const facts = {
    ...(statsResult.rows[0] || {}),
    topCells: topCellsResult.rows || [],
    topParties: topPartiesResult.rows || []
  };

  const lines = [
    `- Total records: ${formatNumber(facts.total_records)}`,
    `- Unique A-Parties: ${formatNumber(facts.unique_a_parties)}`,
    `- Unique B-Parties: ${formatNumber(facts.unique_b_parties)}`,
    `- Unique towers/cells: ${formatNumber(facts.unique_towers)}`,
    `- Top cells: ${facts.topCells.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
  ];
  if (view === 'network-graph' || view === 'party-graph' || view === 'charts') {
    lines.push(`- Top parties: ${facts.topParties.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`);
  }

  return buildSummaryFromFacts('Tower Dump Scoped Snapshot', lines, facts, { view }, { tables: ['tower_dump_records'] });
};

const buildIldScopedSummary = async ({ caseId, fileIds = [], view = 'overview' }) => {
  const scoped = buildScopedClause(caseId, fileIds);
  const [statsResult, topCalledResult, topCountryResult] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(DISTINCT NULLIF(calling_number, ''))::int AS unique_calling_numbers,
          COUNT(DISTINCT NULLIF(called_number, ''))::int AS unique_called_numbers,
          ROUND(COALESCE(AVG(NULLIF(duration_sec, 0)), 0))::int AS avg_duration_sec,
          COALESCE(SUM(duration_sec), 0)::int AS total_duration_sec
        FROM ild_records
        WHERE ${scoped.clause}
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(called_number, ''), NULLIF(international_num, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM ild_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 6
      `,
      scoped.params
    ),
    pool.query(
      `
        SELECT COALESCE(NULLIF(destination_country, ''), 'Unknown') AS label, COUNT(*)::int AS count
        FROM ild_records
        WHERE ${scoped.clause}
        GROUP BY 1
        ORDER BY count DESC, label ASC
        LIMIT 6
      `,
      scoped.params
    )
  ]);

  const facts = {
    ...(statsResult.rows[0] || {}),
    topCalledParties: topCalledResult.rows || [],
    topCountries: topCountryResult.rows || []
  };

  const lines = [
    `- Total records: ${formatNumber(facts.total_records)}`,
    `- Unique calling numbers: ${formatNumber(facts.unique_calling_numbers)}`,
    `- Unique called numbers: ${formatNumber(facts.unique_called_numbers)}`,
    `- Average duration: ${formatDuration(facts.avg_duration_sec)}`,
    `- Top countries: ${facts.topCountries.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`
  ];
  if (view === 'advanced' || view === 'charts') {
    lines.push(`- Top called parties: ${facts.topCalledParties.map((row) => `${row.label} (${formatNumber(row.count)})`).join(', ') || 'N/A'}`);
  }

  return buildSummaryFromFacts('ILD Scoped Snapshot', lines, facts, { view }, { tables: ['ild_records'] });
};

const buildSdrRecordQuery = async ({ caseId, fileIds = [], term, limit = 5 }) => {
  const scoped = buildScopedClause(caseId, fileIds);
  const pattern = buildRecordSearchPattern(term);
  const safeLimit = Math.max(1, Math.min(50, Number(limit || 5)));
  const result = await pool.query(
    `
      SELECT subscriber_name, msisdn, imsi, imei, email, address, id_proof_number, activation_date, file_id, created_at
      FROM sdr_records
      WHERE ${scoped.clause}
        AND (
          COALESCE(subscriber_name, '') ILIKE $${scoped.params.length + 1}
          OR COALESCE(msisdn, '') ILIKE $${scoped.params.length + 1}
          OR COALESCE(imsi, '') ILIKE $${scoped.params.length + 1}
          OR COALESCE(imei, '') ILIKE $${scoped.params.length + 1}
          OR COALESCE(email, '') ILIKE $${scoped.params.length + 1}
          OR COALESCE(address, '') ILIKE $${scoped.params.length + 1}
          OR COALESCE(id_proof_number, '') ILIKE $${scoped.params.length + 1}
          OR CAST(COALESCE(data, raw_data, '{}'::jsonb) AS text) ILIKE $${scoped.params.length + 1}
        )
      ORDER BY created_at DESC, subscriber_name ASC
      LIMIT ${safeLimit}
    `,
    [...scoped.params, pattern]
  );

  return {
    resultCount: result.rows.length,
    preview: result.rows,
    lines: formatPreviewLines(
      result.rows,
      (row) => `${row.subscriber_name || 'Unknown subscriber'} | MSISDN: ${row.msisdn || 'N/A'} | Email: ${row.email || 'N/A'} | File ID: ${row.file_id || 'N/A'}`
    )
  };
};

const mapSummarySnapshot = (snapshot, fallbackTitle = 'Scoped Summary') => ({
  markdown: snapshot?.artifacts?.summaryMarkdown || `**${fallbackTitle}**\n\nNo verified summary is available for this scope.`,
  facts: snapshot?.facts || {},
  insights: snapshot?.insights || {},
  artifacts: snapshot?.artifacts || {},
  sources: snapshot?.sources || {}
});

const buildSnapshotSummary = async ({
  caseId,
  module,
  view = 'overview',
  snapshotKind = 'module_summary',
  fileIds = [],
  filters = null,
  builder,
  ttlMs
}) => {
  const { snapshot, cache } = await getOrBuildCaseMemorySnapshot({
    caseId,
    module,
    view,
    snapshotKind,
    fileIds,
    filters,
    ttlMs,
    builder: async () => {
      const built = await builder();
      return {
        ...built,
        artifacts: {
          ...(built?.artifacts || {}),
          summaryMarkdown: built?.markdown || built?.artifacts?.summaryMarkdown || ''
        }
      };
    }
  });

  return {
    ...mapSummarySnapshot(snapshot),
    meta: {
      cache,
      snapshotKind,
      module,
      view,
      fileIds: normalizeFileIds(fileIds)
    }
  };
};

const buildModuleSummarySnapshot = async ({ caseId, module, view = 'overview', user, builder }) => {
  const summary = await getCaseModuleSummary(caseId, module, { user });
  if (summary?.markdown || summary?.facts) {
    return buildSnapshotSummary({
      caseId,
      module,
      view,
      snapshotKind: 'module_summary',
      builder: async () => ({
        markdown: summary?.markdown || '',
        facts: summary?.facts || {},
        insights: summary?.insights || {},
        artifacts: {
          module,
          view,
          summaryMarkdown: summary?.markdown || ''
        },
        sources: {
          tables: [module === 'tower' ? 'tower_dump_records' : `${module}_records`]
        }
      })
    });
  }

  return buildSnapshotSummary({
    caseId,
    module,
    view,
    snapshotKind: 'module_summary',
    builder
  });
};

const buildRecordSummary = ({ title, term, recordQuery, tables, limit = 5 }) => {
  const markdown = [
    `**${title}**`,
    '',
    `Query: ${term}`,
    `Matched rows: ${formatNumber(recordQuery?.resultCount || 0)}`,
    '',
    ...(recordQuery?.lines || ['No verified rows matched the current record query.'])
  ].join('\n');

  return {
    markdown,
    facts: {
      query: term,
      resultCount: recordQuery?.resultCount || 0,
      preview: recordQuery?.preview || []
    },
    insights: {},
    artifacts: {
      query: term,
      preview: recordQuery?.preview || [],
      limit: Math.max(1, Math.min(50, Number(limit || 5))),
      summaryMarkdown: markdown
    },
    sources: { tables }
  };
};

const createProvider = ({
  module,
  defaultView = 'overview',
  moduleTitle,
  buildScopedSummary,
  buildRecordQuery,
  tables
}) => ({
  module,
  buildCitations() {
    return { tables };
  },
  async buildCaseSummary(caseId, { user, view = defaultView } = {}) {
    return buildModuleSummarySnapshot({
      caseId,
      module,
      view,
      user,
      builder: async () => buildScopedSummary({ caseId, view })
    });
  },
  async buildFileSummary(caseId, fileId, { view = defaultView } = {}) {
    const normalizedFileIds = normalizeFileIds([fileId]);
    return buildSnapshotSummary({
      caseId,
      module,
      view,
      snapshotKind: 'file_summary',
      fileIds: normalizedFileIds,
      builder: async () => buildScopedSummary({ caseId, fileIds: normalizedFileIds, view })
    });
  },
  async buildViewBundle(context = {}) {
    const normalizedFileIds = normalizeFileIds(context?.workspaceContext?.selectedFileIds || context?.fileIds || []);
    const view = context?.view || context?.workspaceContext?.view || defaultView;
    const filters = context?.workspaceContext?.filters || context?.filters || null;

    return buildSnapshotSummary({
      caseId: context.caseId,
      module,
      view,
      snapshotKind: 'view_bundle',
      fileIds: normalizedFileIds,
      filters,
      builder: async () => buildScopedSummary({
        caseId: context.caseId,
        fileIds: normalizedFileIds,
        view,
        workspaceContext: context.workspaceContext || null
      })
    });
  },
  lookupFact(intent = {}, summary = null) {
    const metricKey = intent?.metricKey || intent?.key || null;
    if (!metricKey) return null;
    const metricDefinition = getMetricDefinition(metricKey);
    const factKeys = metricDefinition?.factKeys || [metricKey];
    for (const factKey of factKeys) {
      if (summary?.facts?.[factKey] !== undefined && summary?.facts?.[factKey] !== null) {
        return summary.facts[factKey];
      }
    }
    return null;
  },
  async runRecordQuery(context = {}) {
    const parsed = parseSearchTerm(context?.message || '', context?.workspaceContext || null);
    if (!parsed?.term) return null;

    const normalizedFileIds = normalizeFileIds(context?.workspaceContext?.selectedFileIds || context?.fileIds || []);
    const view = context?.view || context?.workspaceContext?.view || 'records';
    const filters = context?.workspaceContext?.filters || context?.filters || null;
    const limit = Math.max(1, Math.min(50, Number(context?.limit || context?.queryOptions?.limit || 5)));

    return buildSnapshotSummary({
      caseId: context.caseId,
      module,
      view,
      snapshotKind: 'record_query',
      fileIds: normalizedFileIds,
      filters: {
        ...(filters || {}),
        search: parsed.term
      },
      builder: async () => {
        const recordQuery = await buildRecordQuery({
          caseId: context.caseId,
          fileIds: normalizedFileIds,
          term: parsed.term,
          workspaceContext: context.workspaceContext || null,
          limit
        });

        return buildRecordSummary({
          title: `${moduleTitle} Record Search`,
          term: parsed.term,
          recordQuery,
          tables,
          limit
        });
      }
    });
  }
});

const providers = {
  cdr: createProvider({
    module: 'cdr',
    moduleTitle: 'CDR',
    buildScopedSummary: buildCdrScopedSummary,
    buildRecordQuery: (context) => buildGenericRecordQuery({
      table: 'cdr_records',
      caseId: context.caseId,
      fileIds: context.fileIds,
      term: context.term,
      limit: context.limit,
      selectSql: 'calling_number, called_number, call_type, duration_sec, date_time, file_id',
      orderSql: 'ORDER BY date_time DESC NULLS LAST, created_at DESC',
      whereSql: `
        COALESCE(calling_number, '') ILIKE $TERM
        OR COALESCE(called_number, '') ILIKE $TERM
        OR COALESCE(first_cell_id, '') ILIKE $TERM
        OR COALESCE(last_cell_id, '') ILIKE $TERM
        OR COALESCE(imei_a, '') ILIKE $TERM
        OR COALESCE(imei_b, '') ILIKE $TERM
      `,
      formatter: (row) => `${row.calling_number || 'Unknown'} -> ${row.called_number || 'Unknown'} | ${row.call_type || 'Unknown'} | ${formatDuration(row.duration_sec)} | File ID: ${row.file_id || 'N/A'}`
    }),
    tables: ['cdr_records']
  }),
  ipdr: createProvider({
    module: 'ipdr',
    moduleTitle: 'IPDR',
    buildScopedSummary: buildIpdrScopedSummary,
    buildRecordQuery: (context) => buildGenericRecordQuery({
      table: 'ipdr_records',
      caseId: context.caseId,
      fileIds: context.fileIds,
      term: context.term,
      limit: context.limit,
      selectSql: 'msisdn, source_ip, destination_ip, public_ip, private_ip, domain_name, url, file_id, created_at',
      orderSql: 'ORDER BY created_at DESC',
      whereSql: `
        COALESCE(msisdn, '') ILIKE $TERM
        OR COALESCE(imsi, '') ILIKE $TERM
        OR COALESCE(imei, '') ILIKE $TERM
        OR COALESCE(source_ip, '') ILIKE $TERM
        OR COALESCE(destination_ip, '') ILIKE $TERM
        OR COALESCE(public_ip, '') ILIKE $TERM
        OR COALESCE(private_ip, '') ILIKE $TERM
        OR COALESCE(domain_name, '') ILIKE $TERM
        OR COALESCE(url, '') ILIKE $TERM
      `,
      formatter: (row) => `${row.msisdn || 'Unknown'} | ${row.source_ip || row.private_ip || 'N/A'} -> ${row.destination_ip || row.public_ip || 'N/A'} | ${row.domain_name || row.url || 'N/A'} | File ID: ${row.file_id || 'N/A'}`
    }),
    tables: ['ipdr_records']
  }),
  sdr: createProvider({
    module: 'sdr',
    moduleTitle: 'SDR',
    defaultView: 'search',
    buildScopedSummary: buildSdrScopedSummary,
    buildRecordQuery: (context) => buildSdrRecordQuery({ ...context, limit: context.limit }),
    tables: ['sdr_records']
  }),
  tower: createProvider({
    module: 'tower',
    moduleTitle: 'Tower Dump',
    buildScopedSummary: buildTowerScopedSummary,
    buildRecordQuery: (context) => buildGenericRecordQuery({
      table: 'tower_dump_records',
      caseId: context.caseId,
      fileIds: context.fileIds,
      term: context.term,
      limit: context.limit,
      selectSql: 'a_party, b_party, cell_id, first_cell_id, last_cell_id, site_name, site_address, file_id, start_time',
      orderSql: 'ORDER BY start_time DESC NULLS LAST, created_at DESC',
      whereSql: `
        COALESCE(a_party, '') ILIKE $TERM
        OR COALESCE(b_party, '') ILIKE $TERM
        OR COALESCE(cell_id, '') ILIKE $TERM
        OR COALESCE(first_cell_id, '') ILIKE $TERM
        OR COALESCE(last_cell_id, '') ILIKE $TERM
        OR COALESCE(site_name, '') ILIKE $TERM
        OR COALESCE(site_address, '') ILIKE $TERM
        OR COALESCE(imei, '') ILIKE $TERM
        OR COALESCE(imsi, '') ILIKE $TERM
      `,
      formatter: (row) => `${row.a_party || 'Unknown'} <-> ${row.b_party || 'Unknown'} | Cell: ${row.cell_id || row.first_cell_id || row.last_cell_id || 'N/A'} | Site: ${row.site_name || row.site_address || 'N/A'} | File ID: ${row.file_id || 'N/A'}`
    }),
    tables: ['tower_dump_records']
  }),
  ild: createProvider({
    module: 'ild',
    moduleTitle: 'ILD',
    buildScopedSummary: buildIldScopedSummary,
    buildRecordQuery: (context) => buildGenericRecordQuery({
      table: 'ild_records',
      caseId: context.caseId,
      fileIds: context.fileIds,
      term: context.term,
      limit: context.limit,
      selectSql: 'calling_number, called_number, international_num, destination_country, duration_sec, file_id, date_time',
      orderSql: 'ORDER BY date_time DESC NULLS LAST, created_at DESC',
      whereSql: `
        COALESCE(calling_number, '') ILIKE $TERM
        OR COALESCE(called_number, '') ILIKE $TERM
        OR COALESCE(international_num, '') ILIKE $TERM
        OR COALESCE(destination_country, '') ILIKE $TERM
        OR COALESCE(calling_party, '') ILIKE $TERM
        OR COALESCE(called_party, '') ILIKE $TERM
        OR COALESCE(imei, '') ILIKE $TERM
        OR COALESCE(cell_id, '') ILIKE $TERM
      `,
      formatter: (row) => `${row.calling_number || 'Unknown'} -> ${row.called_number || row.international_num || 'Unknown'} | ${row.destination_country || 'N/A'} | ${formatDuration(row.duration_sec)} | File ID: ${row.file_id || 'N/A'}`
    }),
    tables: ['ild_records']
  })
};

export const getAnalysisProvider = (module) => providers[String(module || '').trim().toLowerCase()] || null;

export const getAnalysisRegistry = () => ({ ...providers });

export { parseSearchTerm, shouldRunRecordQuery };
