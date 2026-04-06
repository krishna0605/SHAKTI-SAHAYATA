import pool from '../../config/database.js';

const formatTable = (title, columns, rows) => {
  const lines = [title, '', `| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${columns.map((col) => String(row[col] ?? '-')).join(' | ')} |`);
  return lines.join('\n');
};

const ENABLE_DETERMINISTIC_CACHE =
  String(process.env.CHATBOT_DETERMINISTIC_CACHE || '').trim().toLowerCase() !== 'false';
const DETERMINISTIC_CACHE_TTL_MS = Math.max(
  1000,
  Math.min(10 * 60 * 1000, Number(process.env.CHATBOT_DETERMINISTIC_CACHE_TTL_MS || 20000))
);
const DETERMINISTIC_CACHE_MAX = Math.max(
  5,
  Math.min(200, Number(process.env.CHATBOT_DETERMINISTIC_CACHE_MAX || 60))
);

const deterministicCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;
let cacheSets = 0;
const cacheGet = (key) => {
  if (!ENABLE_DETERMINISTIC_CACHE) return null;
  const hit = deterministicCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > DETERMINISTIC_CACHE_TTL_MS) {
    deterministicCache.delete(key);
    return null;
  }
  cacheHits += 1;
  return hit.value;
};

const cacheSet = (key, value) => {
  if (!ENABLE_DETERMINISTIC_CACHE) return;
  cacheSets += 1;
  deterministicCache.set(key, { at: Date.now(), value });
  if (deterministicCache.size <= DETERMINISTIC_CACHE_MAX) return;
  const entries = Array.from(deterministicCache.entries()).sort((a, b) => a[1].at - b[1].at);
  while (deterministicCache.size > DETERMINISTIC_CACHE_MAX && entries.length > 0) {
    const [k] = entries.shift();
    deterministicCache.delete(k);
  }
};

export const getDeterministicCacheStats = () => ({
  enabled: ENABLE_DETERMINISTIC_CACHE,
  ttlMs: DETERMINISTIC_CACHE_TTL_MS,
  maxEntries: DETERMINISTIC_CACHE_MAX,
  size: deterministicCache.size,
  hits: cacheHits,
  misses: cacheMisses,
  sets: cacheSets
});

export const buildCdrInsights = async ({ caseId, topN = 10, days = 30 } = {}) => {
  const cid = Number(caseId);
  if (!Number.isFinite(cid) || cid <= 0) return { markdown: '', chartSpecs: [] };

  const cacheKey = `cdr:${cid}:${Number(topN) || 10}:${Number(days) || 30}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  if (ENABLE_DETERMINISTIC_CACHE) cacheMisses += 1;

  const result = { markdown: '', chartSpecs: [] };

  const [topContacts, topImei, hourly, daily, longest] = await Promise.all([
    pool.query(
      `
        SELECT number, COUNT(*)::int AS count
        FROM (
          SELECT NULLIF(calling_number, '') AS number FROM cdr_records WHERE case_id = $1
          UNION ALL
          SELECT NULLIF(called_number, '') AS number FROM cdr_records WHERE case_id = $1
        ) x
        WHERE number IS NOT NULL
        GROUP BY number
        ORDER BY COUNT(*) DESC, number ASC
        LIMIT $2
      `,
      [cid, Math.max(1, Math.min(50, Number(topN) || 10))]
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
        LIMIT $2
      `,
      [cid, Math.max(1, Math.min(50, Number(topN) || 10))]
    ),
    pool.query(
      `
        SELECT
          EXTRACT(HOUR FROM date_time)::int AS hour,
          COUNT(*)::int AS calls
        FROM cdr_records
        WHERE case_id = $1
          AND date_time IS NOT NULL
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      [cid]
    ),
    pool.query(
      `
        SELECT call_date, COUNT(*)::int AS calls
        FROM cdr_records
        WHERE case_id = $1
          AND call_date >= CURRENT_DATE - $2::int
        GROUP BY call_date
        ORDER BY call_date ASC
      `,
      [cid, Math.max(1, Math.min(120, Number(days) || 30))]
    ),
    pool.query(
      `
        SELECT call_date, calling_number AS a_party, called_number AS b_party, COALESCE(duration_sec, duration, 0) AS duration_sec, imei_a AS imei
        FROM cdr_records
        WHERE case_id = $1
          AND COALESCE(duration_sec, duration) IS NOT NULL
        ORDER BY COALESCE(duration_sec, duration, 0) DESC, call_date DESC
        LIMIT $2
      `,
      [cid, Math.max(1, Math.min(50, Number(topN) || 10))]
    )
  ]);

  const parts = ['**Analysis (Deterministic)**'];
  if (topContacts.rows?.length) parts.push('', formatTable('Top contacts by interaction count', ['number', 'count'], topContacts.rows));
  if (topImei.rows?.length) parts.push('', formatTable('Top IMEI', ['imei', 'count'], topImei.rows));
  if (daily.rows?.length) parts.push('', formatTable(`Daily communication trend (last ${days} days)`, ['call_date', 'calls'], daily.rows.slice().reverse()));
  if (hourly.rows?.length) parts.push('', formatTable('Hourly call activity', ['hour', 'calls'], hourly.rows));
  if (longest.rows?.length) parts.push('', formatTable('Longest calls', ['call_date', 'a_party', 'b_party', 'duration_sec', 'imei'], longest.rows));

  result.markdown = parts.join('\n');

  if (daily.rows?.length) {
    result.chartSpecs.push({
      type: 'line',
      title: `Daily Communication Trend (last ${days} days)`,
      xKey: 'call_date',
      yKey: 'calls',
      data: daily.rows
    });
  }
  if (hourly.rows?.length) {
    result.chartSpecs.push({
      type: 'bar',
      title: 'Hourly Call Activity',
      xKey: 'hour',
      yKey: 'calls',
      data: hourly.rows
    });
  }

  cacheSet(cacheKey, result);
  return result;
};

export const buildIpdrInsights = async ({ caseId, topN = 10 } = {}) => {
  const cid = Number(caseId);
  if (!Number.isFinite(cid) || cid <= 0) return { markdown: '', chartSpecs: [] };
  const limit = Math.max(1, Math.min(50, Number(topN) || 10));

  const cacheKey = `ipdr:${cid}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  if (ENABLE_DETERMINISTIC_CACHE) cacheMisses += 1;

  const [topSrc, topDst, topApn, topRat] = await Promise.all([
    pool.query(
      `
        SELECT ip, COUNT(*)::int AS count
        FROM (
          SELECT NULLIF(source_ip, '') AS ip FROM ipdr_records WHERE case_id = $1
          UNION ALL
          SELECT NULLIF(public_ip, '') AS ip FROM ipdr_records WHERE case_id = $1
        ) x
        WHERE ip IS NOT NULL
        GROUP BY ip
        ORDER BY COUNT(*) DESC, ip ASC
        LIMIT $2
      `,
      [cid, limit]
    ),
    pool.query(
      `
        SELECT ip, COUNT(*)::int AS count
        FROM (
          SELECT NULLIF(destination_ip, '') AS ip FROM ipdr_records WHERE case_id = $1
        ) x
        WHERE ip IS NOT NULL
        GROUP BY ip
        ORDER BY COUNT(*) DESC, ip ASC
        LIMIT $2
      `,
      [cid, limit]
    ),
    pool.query(
      `
        SELECT protocol AS apn, COUNT(*)::int AS count
        FROM ipdr_records
        WHERE case_id = $1
          AND protocol IS NOT NULL
          AND TRIM(protocol) <> ''
        GROUP BY protocol
        ORDER BY COUNT(*) DESC, protocol ASC
        LIMIT $2
      `,
      [cid, limit]
    ),
    pool.query(
      `
        SELECT rat_type AS rat, COUNT(*)::int AS count
        FROM ipdr_records
        WHERE case_id = $1
          AND rat_type IS NOT NULL
          AND TRIM(rat_type) <> ''
        GROUP BY rat_type
        ORDER BY COUNT(*) DESC, rat_type ASC
        LIMIT $2
      `,
      [cid, limit]
    )
  ]);

  const parts = ['**Analysis (Deterministic)**'];
  if (topSrc.rows?.length) parts.push('', formatTable('Top Source IP', ['ip', 'count'], topSrc.rows));
  if (topDst.rows?.length) parts.push('', formatTable('Top Destination IP', ['ip', 'count'], topDst.rows));
  if (topApn.rows?.length) parts.push('', formatTable('Top Protocol', ['apn', 'count'], topApn.rows));
  if (topRat.rows?.length) parts.push('', formatTable('Top RAT Type', ['rat', 'count'], topRat.rows));

  const chartSpecs = [];
  if (topSrc.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top Source IP', xKey: 'ip', yKey: 'count', data: topSrc.rows });
  if (topDst.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top Destination IP', xKey: 'ip', yKey: 'count', data: topDst.rows });
  if (topApn.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top APN', xKey: 'apn', yKey: 'count', data: topApn.rows });
  if (topRat.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top RAT', xKey: 'rat', yKey: 'count', data: topRat.rows });

  const payload = { markdown: parts.join('\n'), chartSpecs };
  cacheSet(cacheKey, payload);
  return payload;
};

export const buildIldInsights = async ({ caseId, topN = 10 } = {}) => {
  const cid = Number(caseId);
  if (!Number.isFinite(cid) || cid <= 0) return { markdown: '', chartSpecs: [] };
  const limit = Math.max(1, Math.min(50, Number(topN) || 10));

  const cacheKey = `ild:${cid}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  if (ENABLE_DETERMINISTIC_CACHE) cacheMisses += 1;

  const [topCalling, topCalled, longest] = await Promise.all([
    pool.query(
      `
        SELECT calling_number AS number, COUNT(*)::int AS count
        FROM ild_records
        WHERE case_id = $1
          AND calling_number IS NOT NULL
          AND TRIM(calling_number) <> ''
        GROUP BY calling_number
        ORDER BY COUNT(*) DESC, calling_number ASC
        LIMIT $2
      `,
      [cid, limit]
    ),
    pool.query(
      `
        SELECT called_number AS number, COUNT(*)::int AS count
        FROM ild_records
        WHERE case_id = $1
          AND called_number IS NOT NULL
          AND TRIM(called_number) <> ''
        GROUP BY called_number
        ORDER BY COUNT(*) DESC, called_number ASC
        LIMIT $2
      `,
      [cid, limit]
    ),
    pool.query(
      `
        SELECT call_date, calling_number, called_number, COALESCE(duration_sec, duration, 0) AS call_duration_sec
        FROM ild_records
        WHERE case_id = $1
          AND COALESCE(duration_sec, duration) IS NOT NULL
        ORDER BY COALESCE(duration_sec, duration, 0) DESC
        LIMIT $2
      `,
      [cid, limit]
    )
  ]);

  const parts = ['**Analysis (Deterministic)**'];
  if (topCalling.rows?.length) parts.push('', formatTable('Top Calling Party', ['number', 'count'], topCalling.rows));
  if (topCalled.rows?.length) parts.push('', formatTable('Top Called Party', ['number', 'count'], topCalled.rows));
  if (longest.rows?.length) {
    parts.push(
      '',
      formatTable(
        'Longest ILD calls',
        ['call_date', 'calling_number', 'called_number', 'call_duration_sec'],
        longest.rows
      )
    );
  }

  const chartSpecs = [];
  if (topCalling.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top Calling Party', xKey: 'number', yKey: 'count', data: topCalling.rows });
  if (topCalled.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top Called Party', xKey: 'number', yKey: 'count', data: topCalled.rows });

  const payload = { markdown: parts.join('\n'), chartSpecs };
  cacheSet(cacheKey, payload);
  return payload;
};

export const buildTowerInsights = async ({ caseId, topN = 10 } = {}) => {
  const cid = Number(caseId);
  if (!Number.isFinite(cid) || cid <= 0) return { markdown: '', chartSpecs: [] };
  const limit = Math.max(1, Math.min(50, Number(topN) || 10));

  const cacheKey = `tower:${cid}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  if (ENABLE_DETERMINISTIC_CACHE) cacheMisses += 1;

  const [topCells, topImei] = await Promise.all([
    pool.query(
      `
        SELECT cell_id, COUNT(*)::int AS count
        FROM (
          SELECT NULLIF(first_cell_id, '') AS cell_id FROM tower_dump_records WHERE case_id = $1
          UNION ALL
          SELECT NULLIF(last_cell_id, '') AS cell_id FROM tower_dump_records WHERE case_id = $1
        ) x
        WHERE cell_id IS NOT NULL
        GROUP BY cell_id
        ORDER BY COUNT(*) DESC, cell_id ASC
        LIMIT $2
      `,
      [cid, limit]
    ),
    pool.query(
      `
        SELECT imei, COUNT(*)::int AS count
        FROM tower_dump_records
        WHERE case_id = $1
          AND imei IS NOT NULL
          AND TRIM(imei) <> ''
        GROUP BY imei
        ORDER BY COUNT(*) DESC, imei ASC
        LIMIT $2
      `,
      [cid, limit]
    )
  ]);

  const parts = ['**Analysis (Deterministic)**'];
  if (topCells.rows?.length) parts.push('', formatTable('Top Cell IDs', ['cell_id', 'count'], topCells.rows));
  if (topImei.rows?.length) parts.push('', formatTable('Top IMEI', ['imei', 'count'], topImei.rows));

  const chartSpecs = [];
  if (topCells.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top Cell IDs', xKey: 'cell_id', yKey: 'count', data: topCells.rows });
  if (topImei.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top IMEI', xKey: 'imei', yKey: 'count', data: topImei.rows });

  const payload = { markdown: parts.join('\n'), chartSpecs };
  cacheSet(cacheKey, payload);
  return payload;
};

export const buildSdrInsights = async ({ caseId, topN = 10 } = {}) => {
  const cid = Number(caseId);
  if (!Number.isFinite(cid) || cid <= 0) return { markdown: '', chartSpecs: [] };
  const limit = Math.max(1, Math.min(50, Number(topN) || 10));

  const cacheKey = `sdr:${cid}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;
  if (ENABLE_DETERMINISTIC_CACHE) cacheMisses += 1;

  const [topNumbers, topNames, byNationality] = await Promise.all([
    pool.query(
      `
        SELECT msisdn AS telephone_number, COUNT(*)::int AS count
        FROM sdr_records
        WHERE case_id = $1
          AND msisdn IS NOT NULL
          AND TRIM(msisdn) <> ''
        GROUP BY msisdn
        ORDER BY COUNT(*) DESC, msisdn ASC
        LIMIT $2
      `,
      [cid, limit]
    ),
    pool.query(
      `
        SELECT subscriber_name, COUNT(*)::int AS count
        FROM sdr_records
        WHERE case_id = $1
          AND subscriber_name IS NOT NULL
          AND TRIM(subscriber_name) <> ''
        GROUP BY subscriber_name
        ORDER BY COUNT(*) DESC, subscriber_name ASC
        LIMIT $2
      `,
      [cid, limit]
    ),
    pool.query(
      `
        SELECT nationality, COUNT(*)::int AS count
        FROM sdr_records
        WHERE case_id = $1
          AND nationality IS NOT NULL
          AND TRIM(nationality) <> ''
        GROUP BY nationality
        ORDER BY COUNT(*) DESC, nationality ASC
        LIMIT $2
      `,
      [cid, limit]
    )
  ]);

  const parts = ['**Analysis (Deterministic)**'];
  if (topNumbers.rows?.length) parts.push('', formatTable('Top Telephone Numbers', ['telephone_number', 'count'], topNumbers.rows));
  if (topNames.rows?.length) parts.push('', formatTable('Top Subscriber Names', ['subscriber_name', 'count'], topNames.rows));
  if (byNationality.rows?.length) parts.push('', formatTable('Nationality Breakdown', ['nationality', 'count'], byNationality.rows));

  const chartSpecs = [];
  if (topNumbers.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top Telephone Numbers', xKey: 'telephone_number', yKey: 'count', data: topNumbers.rows });
  if (topNames.rows?.length) chartSpecs.push({ type: 'bar', title: 'Top Subscriber Names', xKey: 'subscriber_name', yKey: 'count', data: topNames.rows });
  if (byNationality.rows?.length) chartSpecs.push({ type: 'bar', title: 'Nationality Breakdown', xKey: 'nationality', yKey: 'count', data: byNationality.rows });

  const payload = { markdown: parts.join('\n'), chartSpecs };
  cacheSet(cacheKey, payload);
  return payload;
};
