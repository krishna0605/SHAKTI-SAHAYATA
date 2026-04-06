import pool from '../../config/database.js';
import { digitsOnly, formatNumber } from './text.utils.js';
import { t } from './i18n.service.js';

const addLines = (lines, items) => {
  lines.push(...items);
};

export const buildFirSummaryMarkdown = ({
  firNumber,
  caseRow,
  datasetCounts,
  cdrStats,
  topImeiRows,
  ipdrStats,
  language,
  label
} = {}) => {
  const lang = language || 'en';
  const summaryLabel = label
    || (firNumber ? `FIR ${firNumber}` : (caseRow?.case_name || (caseRow?.id ? `Case ${caseRow.id}` : 'Case')));
  const lines = [
    '### SHAKTI SAHAYATA AI',
    '',
    t(lang, {
      en: `${summaryLabel} summary (database-based):`,
      hi: `${summaryLabel} summary (database-based):`,
      gu: `${summaryLabel} summary (database-based):`
    }),
    '',
    `| ${t(lang, { en: 'Field', hi: 'Field', gu: 'Field' })} | ${t(lang, { en: 'Value', hi: 'Value', gu: 'Value' })} |`,
    '| --- | --- |',
    `| Case ID | ${caseRow.id ?? '-'} |`,
    `| Case Name | ${caseRow.case_name || '-'} |`,
    `| Case Number | ${caseRow.case_number || '-'} |`,
    `| FIR Number | ${caseRow.fir_number || '-'} |`,
    `| Case Type | ${caseRow.case_type || '-'} |`,
    `| Operator | ${caseRow.operator || '-'} |`,
    `| Investigating Officer | ${caseRow.investigating_officer_name || '-'} |`,
    `| Status | ${caseRow.status || '-'} |`,
    `| Description | ${caseRow.description || '-'} |`,
    ''
  ];

  if (datasetCounts) {
    addLines(lines, [
      `#### ${t(lang, { en: 'Dataset Counts', hi: 'Dataset Counts', gu: 'Dataset Counts' })}`,
      '',
      `| ${t(lang, { en: 'Dataset', hi: 'Dataset', gu: 'Dataset' })} | ${t(lang, { en: 'Rows', hi: 'Rows', gu: 'Rows' })} |`,
      '| --- | ---: |',
      `| CDR | ${formatNumber(datasetCounts.cdr_count)} |`,
      `| IPDR | ${formatNumber(datasetCounts.ipdr_count)} |`,
      `| ILD | ${formatNumber(datasetCounts.ild_count)} |`,
      `| SDR | ${formatNumber(datasetCounts.sdr_count)} |`,
      `| Tower Dump | ${formatNumber(datasetCounts.tower_count)} |`,
      ''
    ]);
  }

  if (cdrStats) {
    addLines(lines, [
      `#### ${t(lang, { en: 'CDR Summary', hi: 'CDR Summary', gu: 'CDR Summary' })}`,
      '',
      `| ${t(lang, { en: 'Metric', hi: 'Metric', gu: 'Metric' })} | ${t(lang, { en: 'Value', hi: 'Value', gu: 'Value' })} |`,
      '| --- | --- |',
      `| ${t(lang, { en: 'Total CDR Records', hi: 'Total CDR Records', gu: 'Total CDR Records' })} | ${formatNumber(cdrStats.total_records)} |`,
      `| ${t(lang, { en: 'Unique A Party', hi: 'Unique A Party', gu: 'Unique A Party' })} | ${formatNumber(cdrStats.unique_a_party)} |`,
      `| ${t(lang, { en: 'Unique B Party', hi: 'Unique B Party', gu: 'Unique B Party' })} | ${formatNumber(cdrStats.unique_b_party)} |`,
      `| ${t(lang, { en: 'Unique IMEI', hi: 'Unique IMEI', gu: 'Unique IMEI' })} | ${formatNumber(cdrStats.unique_imei)} |`,
      `| ${t(lang, { en: 'Date Range Start', hi: 'Date Range Start', gu: 'Date Range Start' })} | ${cdrStats.min_call_date || '-'} |`,
      `| ${t(lang, { en: 'Date Range End', hi: 'Date Range End', gu: 'Date Range End' })} | ${cdrStats.max_call_date || '-'} |`,
      `| ${t(lang, { en: 'Total Duration (sec)', hi: 'Total Duration (sec)', gu: 'Total Duration (sec)' })} | ${formatNumber(cdrStats.total_duration_sec)} |`,
      ''
    ]);
  }

  if (Array.isArray(topImeiRows) && topImeiRows.length > 0) {
    addLines(lines, [
      `#### ${t(lang, { en: 'Top IMEI (CDR)', hi: 'Top IMEI (CDR)', gu: 'Top IMEI (CDR)' })}`,
      '',
      '| IMEI | Count |',
      '| --- | ---: |',
      ...topImeiRows.map((row) => `| ${row.imei || '-'} | ${formatNumber(row.count)} |`),
      ''
    ]);
  }

  if (ipdrStats) {
    addLines(lines, [
      `#### ${t(lang, { en: 'IPDR Summary', hi: 'IPDR Summary', gu: 'IPDR Summary' })}`,
      '',
      `| ${t(lang, { en: 'Metric', hi: 'Metric', gu: 'Metric' })} | ${t(lang, { en: 'Value', hi: 'Value', gu: 'Value' })} |`,
      '| --- | --- |',
      `| ${t(lang, { en: 'Total IPDR Records', hi: 'Total IPDR Records', gu: 'Total IPDR Records' })} | ${formatNumber(ipdrStats.total_records)} |`,
      `| ${t(lang, { en: 'Unique MSISDN', hi: 'Unique MSISDN', gu: 'Unique MSISDN' })} | ${formatNumber(ipdrStats.unique_msisdn)} |`,
      `| ${t(lang, { en: 'Unique IMEI', hi: 'Unique IMEI', gu: 'Unique IMEI' })} | ${formatNumber(ipdrStats.unique_imei)} |`,
      `| ${t(lang, { en: 'Unique IMSI', hi: 'Unique IMSI', gu: 'Unique IMSI' })} | ${formatNumber(ipdrStats.unique_imsi)} |`,
      `| ${t(lang, { en: 'Unique Source IP', hi: 'Unique Source IP', gu: 'Unique Source IP' })} | ${formatNumber(ipdrStats.unique_source_ip)} |`,
      ''
    ]);
  }

  addLines(lines, [t(lang, {
    en: '_Note: This response is generated from backend database queries (read-only)._',
    hi: '_Note: This response is generated from backend database queries (read-only)._',
    gu: '_Note: This response is generated from backend database queries (read-only)._'
  })]);
  if (!caseRow.fir_number && caseRow.case_name) {
    addLines(lines, [t(lang, {
      en: '_Match source: `cases.case_name` was used because `cases.fir_number` is empty._',
      hi: '_Match source: `cases.case_name` was used because `cases.fir_number` is empty._',
      gu: '_Match source: `cases.case_name` was used because `cases.fir_number` is empty._'
    })]);
  }
  return lines.join('\n');
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
    c.created_at,
    c.investigation_details,
    u.full_name AS investigating_officer_name
  FROM cases c
  LEFT JOIN users u ON c.created_by_user_id = u.id
`;

export const fetchCaseSummary = async ({ firNumber, caseId, query } = {}) => {
  let caseResult = { rows: [] };

  if (caseId) {
    caseResult = await pool.query(
      `${baseCaseSelect} WHERE c.id = $1 LIMIT 1`,
      [Number(caseId)]
    );
  } else if (firNumber) {
    const firDigits = digitsOnly(firNumber);
    caseResult = await pool.query(
      String.raw`
        ${baseCaseSelect}
        WHERE
          TRIM(COALESCE(c.fir_number, '')) = $1
          OR REGEXP_REPLACE(COALESCE(c.fir_number, ''), '\D', '', 'g') = $2
          OR REGEXP_REPLACE(COALESCE(c.case_name, ''), '\D', '', 'g') = $2
          OR LOWER(COALESCE(c.case_name, '')) LIKE $3
        ORDER BY c.created_at DESC
        LIMIT 1
      `,
      [String(firNumber), firDigits, `%fir%${firDigits}%`]
    );
  } else if (query) {
    const q = String(query || '').trim();
    if (q.length >= 3) {
      const digits = digitsOnly(q);
      caseResult = await pool.query(
        String.raw`
          ${baseCaseSelect}
          WHERE
            LOWER(COALESCE(c.case_name, '')) LIKE $1
            OR LOWER(COALESCE(c.case_number, '')) LIKE $1
            OR LOWER(COALESCE(c.description, '')) LIKE $1
            ${digits ? 'OR REGEXP_REPLACE(COALESCE(c.case_number, \'\'), \'\\D\', \'\', \'g\') = $2' : ''}
          ORDER BY c.created_at DESC
          LIMIT 1
        `,
        digits ? [`%${q.toLowerCase()}%`, digits] : [`%${q.toLowerCase()}%`]
      );
    }
  }

  const caseRow = caseResult.rows[0];
  if (!caseRow) return null;

  const [
    countsResult,
    cdrStatsResult,
    topImeiResult,
    ipdrStatsResult
  ] = await Promise.all([
    pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM cdr_records c WHERE c.case_id = $1) AS cdr_count,
          (SELECT COUNT(*)::int FROM ipdr_records i WHERE i.case_id = $1) AS ipdr_count,
          (SELECT COUNT(*)::int FROM ild_records il WHERE il.case_id = $1) AS ild_count,
          (SELECT COUNT(*)::int FROM sdr_records s WHERE s.case_id = $1) AS sdr_count,
          (SELECT COUNT(*)::int FROM tower_dump_records t WHERE t.case_id = $1) AS tower_count
      `,
      [caseRow.id]
    ),
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(DISTINCT NULLIF(calling_number, ''))::int AS unique_a_party,
          COUNT(DISTINCT NULLIF(called_number, ''))::int AS unique_b_party,
          COUNT(DISTINCT NULLIF(imei_a, ''))::int AS unique_imei,
          MIN(COALESCE(call_date, date_time::text)) AS min_call_date,
          MAX(COALESCE(call_date, date_time::text)) AS max_call_date,
          COALESCE(SUM(COALESCE(duration_sec, duration, 0)), 0)::bigint AS total_duration_sec
        FROM cdr_records
        WHERE case_id = $1
      `,
      [caseRow.id]
    ),
    pool.query(
      `
        SELECT imei_a AS imei, COUNT(*)::int AS count
        FROM cdr_records
        WHERE case_id = $1
          AND imei_a IS NOT NULL
          AND TRIM(imei_a) <> ''
        GROUP BY imei_a
        ORDER BY COUNT(*) DESC, imei_a ASC
        LIMIT 10
      `,
      [caseRow.id]
    ),
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_records,
          COUNT(DISTINCT NULLIF(msisdn, ''))::int AS unique_msisdn,
          COUNT(DISTINCT NULLIF(imei, ''))::int AS unique_imei,
          COUNT(DISTINCT NULLIF(imsi, ''))::int AS unique_imsi,
          COUNT(DISTINCT NULLIF(source_ip, ''))::int AS unique_source_ip
        FROM ipdr_records
        WHERE case_id = $1
      `,
      [caseRow.id]
    )
  ]);

  const datasetCounts = countsResult.rows[0] || null;
  const cdrCount = Number(datasetCounts?.cdr_count || 0);
  const ipdrCount = Number(datasetCounts?.ipdr_count || 0);

  return {
    caseRow,
    datasetCounts,
    cdrStats: cdrCount > 0 ? cdrStatsResult.rows[0] : null,
    topImeiRows: cdrCount > 0 ? topImeiResult.rows : [],
    ipdrStats: ipdrCount > 0 ? ipdrStatsResult.rows[0] : null
  };
};

export const findCaseCandidates = async ({ firNumber, caseId, query } = {}) => {
  if (caseId) {
    const result = await pool.query(
      `SELECT id, case_name, fir_number, created_at FROM cases WHERE id = $1 LIMIT 1`,
      [Number(caseId)]
    );
    return result.rows;
  }

  if (firNumber) {
    const firDigits = digitsOnly(firNumber);
    if (!firDigits) return [];
    const result = await pool.query(
      String.raw`
        SELECT id, case_name, fir_number, created_at
        FROM cases
        WHERE
          REGEXP_REPLACE(COALESCE(fir_number, ''), '\D', '', 'g') = $1
          OR REGEXP_REPLACE(COALESCE(case_name, ''), '\D', '', 'g') = $1
          OR LOWER(COALESCE(case_name, '')) LIKE $2
        ORDER BY created_at DESC, id DESC
        LIMIT 5
      `,
      [firDigits, `%fir%${firDigits}%`]
    );
    return result.rows;
  }

  if (query) {
    const q = String(query || '').trim();
    if (q.length < 3) return [];
    const result = await pool.query(
      String.raw`
        SELECT id, case_name, fir_number, created_at
        FROM cases
        WHERE
          LOWER(COALESCE(case_name, '')) LIKE $1
          OR LOWER(COALESCE(case_number, '')) LIKE $1
          OR LOWER(COALESCE(description, '')) LIKE $1
        ORDER BY created_at DESC, id DESC
        LIMIT 5
      `,
      [`%${q.toLowerCase()}%`]
    );
    return result.rows;
  }

  return [];
};

export const buildMissingCaseResponse = ({ label, candidates = [], language = 'en' } = {}) => {
  const lang = language || 'en';
  const lines = [
    '### SHAKTI SAHAYATA AI',
    '',
    t(lang, {
      en: `${label || 'Case'} not found in direct lookup.`,
      hi: `${label || 'Case'} not found in direct lookup.`,
      gu: `${label || 'Case'} not found in direct lookup.`
    }),
    '',
    t(lang, { en: 'Please verify:', hi: 'Please verify:', gu: 'Please verify:' }),
    `1. ${t(lang, {
      en: '`cases.fir_number` / `case_name` / `description` value',
      hi: '`cases.fir_number` / `case_name` / `description` value',
      gu: '`cases.fir_number` / `case_name` / `description` value'
    })}`,
    `2. ${t(lang, {
      en: 'Case exists before checking CDR records',
      hi: 'CDR records check karne se pehle case exist hona chahiye',
      gu: 'CDR records check karta pehla case exist hovu joie'
    })}`,
    `3. ${t(lang, {
      en: 'Correct backend/database is running',
      hi: 'Sahi backend/database run thai rahyu chhe',
      gu: 'Sachu backend/database run thai rahyu chhe'
    })}`
  ];

  if (candidates.length > 0) {
    addLines(lines, [
      '',
      '#### Possible Matches',
      '',
      '| Case ID | FIR Number | Case Name |',
      '| ---: | --- | --- |',
      ...candidates.map((row) => `| ${row.id ?? '-'} | ${row.fir_number || '-'} | ${row.case_name || '-'} |`)
    ]);
  }

  return lines.join('\n');
};
