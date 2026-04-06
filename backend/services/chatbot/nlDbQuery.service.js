import pool from '../../config/database.js';
import { buildFirSummaryMarkdown, fetchCaseSummary } from './firSummary.service.js';
import { generateDbResultAnalysis, generateSqlFromText } from './ollama.service.js';
import { executeReadOnlyQuery, formatDbResultAsMarkdown, validateReadOnlySql } from './dbQuery.service.js';
import {
  buildCdrInsights,
  buildIldInsights,
  buildIpdrInsights,
  buildSdrInsights,
  buildTowerInsights
} from './deterministicAnalysis.service.js';

const includesAny = (text, words) => words.some((w) => text.includes(w));

const t = (lang, key) => {
  const dict = {
    en: {
      heading: '### SHAKTI SAHAYATA AI\n\n**Database Query Result**',
      noTarget: 'Please provide FIR number or Case ID for this query.',
      notFound: 'No matching case/data found for the request.',
      recentCases: 'Recent cases',
      noCases: 'No cases found in the database.',
      datasetCounts: 'Dataset counts',
      topImei: 'Top IMEI',
      topContacts: 'Top contacts by interaction count',
      dailyTrend: 'Daily communication trend',
      longCalls: 'Longest calls',
      basedOnContext: 'Resolved context used'
    },
    hi: {
      heading: '### SHAKTI SAHAYATA AI\n\n**Database Query Result (Hindi mode)**',
      noTarget: 'Is query ke liye FIR number ya Case ID dein.',
      notFound: 'Request ke hisab se koi case/data nahi mila.',
      recentCases: 'Recent cases',
      noCases: 'Database me koi cases nahi mile.',
      datasetCounts: 'Dataset counts',
      topImei: 'Top IMEI',
      topContacts: 'Top contacts by interaction count',
      dailyTrend: 'Daily communication trend',
      longCalls: 'Longest calls',
      basedOnContext: 'Resolved context used'
    },
    gu: {
      heading: '### SHAKTI SAHAYATA AI\n\n**Database Query Result (Gujarati mode)**',
      noTarget: 'Aa query mate FIR number ke Case ID apo.',
      notFound: 'Request pramane case/data malyu nathi.',
      recentCases: 'Recent cases',
      noCases: 'Database ma koi cases nathi malya.',
      datasetCounts: 'Dataset counts',
      topImei: 'Top IMEI',
      topContacts: 'Top contacts by interaction count',
      dailyTrend: 'Daily communication trend',
      longCalls: 'Longest calls',
      basedOnContext: 'Resolved context used'
    }
  };
  return (dict[lang] || dict.en)[key] || key;
};

const formatTable = (title, columns, rows) => {
  const lines = [title, '', `| ${columns.join(' | ')} |`, `| ${columns.map(() => '---').join(' | ')} |`];
  for (const row of rows) lines.push(`| ${columns.map((col) => String(row[col] ?? '-')).join(' | ')} |`);
  return lines.join('\n');
};

const buildChartSpec = ({ type, title, xKey, yKey, data }) => ({
  type,
  title,
  xKey,
  yKey,
  data: Array.isArray(data) ? data : []
});

const resolveCase = async ({ fir, caseId }) => {
  if (caseId) {
    const byId = await pool.query(
      `SELECT id, case_name, fir_number, case_type, status, created_at FROM cases WHERE id = $1 LIMIT 1`,
      [Number(caseId)]
    );
    if (byId.rows[0]) return byId.rows[0];
  }

  if (!fir) return null;
  const byFir = await pool.query(String.raw`
      SELECT id, case_name, fir_number, case_type, status, created_at
      FROM cases
      WHERE
        TRIM(COALESCE(fir_number, '')) = $1
        OR REGEXP_REPLACE(COALESCE(fir_number, ''), '\D', '', 'g') = REGEXP_REPLACE($1, '\D', '', 'g')
      ORDER BY created_at DESC
      LIMIT 1
    `, [String(fir)]);
  return byFir.rows[0] || null;
};

const findCaseCandidatesByFir = async (fir, limit = 5) => {
  const raw = String(fir || '').trim();
  if (!raw) return [];

  const result = await pool.query(String.raw`
      SELECT id, case_name, case_number, fir_number, case_type, status, created_at
      FROM cases
      WHERE
        TRIM(COALESCE(fir_number, '')) = $1
        OR REGEXP_REPLACE(COALESCE(fir_number, ''), '\D', '', 'g') = REGEXP_REPLACE($1, '\D', '', 'g')
      ORDER BY created_at DESC, id DESC
      LIMIT $2
    `, [raw, Math.max(1, Math.min(10, Number(limit) || 5))]);

  return result.rows || [];
};

const buildCaseDisambiguationMarkdown = (lang, fir, candidates = []) => {
  if (!Array.isArray(candidates) || candidates.length === 0) return `${t(lang, 'heading')}\n\n${t(lang, 'notFound')}`;

  const body = formatTable(
    `Multiple cases found for FIR ${fir}. Please select a Case ID:`,
    ['id', 'case_name', 'case_number', 'fir_number', 'case_type', 'status', 'created_at'],
    candidates
  );

  return [
    t(lang, 'heading'),
    '',
    body,
    '',
    'Next step: reply with `case <id>` (example: `case 19`) or open that case in Dashboard and retry.'
  ].join('\n');
};

const buildContextNote = (lang, ctx) => {
  const parts = [];
  if (ctx.fir) parts.push(`FIR=${ctx.fir}`);
  if (ctx.caseId) parts.push(`CaseID=${ctx.caseId}`);
  if (ctx.module) parts.push(`Module=${ctx.module}`);
  if (parts.length === 0) return '';
  return `\n\n_${t(lang, 'basedOnContext')}: ${parts.join(', ')}_`;
};

const buildCaseListResponse = async (lang, caseLimit) => {
  const full = await pool.query(
    `
      SELECT
        id,
        case_name,
        case_number,
        fir_number,
        description,
        operator,
        case_type,
        status,
        priority,
        created_at,
        updated_at
      FROM cases
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    `,
    [caseLimit]
  );

  if (full.rows.length === 0) {
    return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${t(lang, 'noCases')}`, sql: null, rowCount: 0 };
  }

  const body = formatTable(
    `${t(lang, 'recentCases')} (latest ${Math.min(caseLimit, full.rows.length)})`,
    ['id', 'case_name', 'case_number', 'fir_number', 'case_type', 'status', 'created_at'],
    full.rows
  );
  return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${body}`, sql: null, rowCount: full.rows.length };
};

const buildCaseCreationGuidance = (lang) => {
  const msg = {
    en: [
      '### SHAKTI SAHAYATA AI',
      '',
      '**Next step**',
      '- Create a case from the SHAKTI UI: `Cases â†’ Create Case`.',
      '- Then upload datasets (CDR/IPDR/ILD/SDR/Tower) into that case.',
      '',
      '_Note: Chatbot DB access is read-only, so it will not run INSERT/UPDATE._'
    ].join('\n'),
    hi: [
      '### SHAKTI SAHAYATA AI',
      '',
      '**Next step**',
      '- SHAKTI UI se case create kijiye: `Cases â†’ Create Case`.',
      '- Phir us case me datasets (CDR/IPDR/ILD/SDR/Tower) upload kijiye.',
      '',
      '_Note: Chatbot DB access read-only hai; ye INSERT/UPDATE run nahi karta._'
    ].join('\n'),
    gu: [
      '### SHAKTI SAHAYATA AI',
      '',
      '**Next step**',
      '- SHAKTI UI mathi case create karo: `Cases â†’ Create Case`.',
      '- Pachhi aa case ma datasets (CDR/IPDR/ILD/SDR/Tower) upload karo.',
      '',
      '_Note: Chatbot DB access read-only chhe; aa INSERT/UPDATE run nathi kartu._'
    ].join('\n')
  };
  return { handled: true, mode: 'chat_guidance', response: msg[lang] || msg.en, sql: null };
};

const isCaseListRequest = (text) =>
  includesAny(text, ['recent case', 'latest case', 'case list', 'all cases', 'show cases', 'get cases', 'list cases', 'actual cases', 'real cases'])
  || (includesAny(text, ['case', 'cases']) && includesAny(text, ['aapo', 'apo', 'aap', 'do', 'dikhavo', 'dikhao', 'dikha', 'batao', 'batavo', 'mujhe', 'mane', 'show', 'list', 'get', 'view']))
  || (includesAny(text, ['real-time', 'real time', 'actual', 'live']) && includesAny(text, ['data', 'query', 'queries', 'database', 'db']));

const isCaseCreationRequest = (text) =>
  includesAny(text, ['create case', 'new case', 'add case'])
  || (includesAny(text, ['case']) && includesAny(text, ['create', 'banavo', 'banao', 'new', 'navi', 'naya', 'navo']));

const isFirSummaryRequest = (text, fir) =>
  Boolean(fir) && includesAny(text, ['summary']) && includesAny(text, ['cdr', 'fir']);

const handleFirSummaryRequest = async (fir, lang) => {
  if (!fir) return { handled: false };
  const summary = await fetchCaseSummary({ firNumber: fir });
  if (!summary) return { handled: false };
  return { handled: true, mode: 'db_summary', response: buildFirSummaryMarkdown({ firNumber: fir, ...summary, language: lang }), rowCount: 1 };
};

const buildInsightResponse = (insights, context, lang) => ({
  handled: true,
  mode: 'db_analysis',
  response: `${t(lang, 'heading')}\n\n${insights.markdown}${buildContextNote(lang, context)}`,
  sql: null,
  chartSpecs: insights.chartSpecs || []
});

const insightHandlers = [
  {
    matches: (text) => includesAny(text, ['cdr', 'call']),
    run: ({ selectedCase, topN, days }) => buildCdrInsights({ caseId: selectedCase.id, topN, days })
  },
  {
    matches: (text) => includesAny(text, ['ipdr', 'ip']),
    run: ({ selectedCase, topN }) => buildIpdrInsights({ caseId: selectedCase.id, topN })
  },
  {
    matches: (text) => includesAny(text, ['ild']),
    run: ({ selectedCase, topN }) => buildIldInsights({ caseId: selectedCase.id, topN })
  },
  {
    matches: (text) => includesAny(text, ['tower', 'tower dump', 'cell']),
    run: ({ selectedCase, topN }) => buildTowerInsights({ caseId: selectedCase.id, topN })
  },
  {
    matches: (text) => includesAny(text, ['sdr', 'subscriber']),
    run: ({ selectedCase, topN }) => buildSdrInsights({ caseId: selectedCase.id, topN })
  }
];

const runInsightHandlers = async ({ text, selectedCase, topN, days, context, lang }) => {
  for (const handler of insightHandlers) {
    if (!handler.matches(text)) continue;
    try {
      const insights = await handler.run({ selectedCase, topN, days });
      if (insights?.markdown) return buildInsightResponse(insights, context, lang);
    } catch {
      // fall through
    }
  }

  return { handled: false };
};

const handleDeterministicInsights = async ({ text, selectedCase, wantsAnalysis, topN, days, context, lang }) => {
  if (!wantsAnalysis) return { handled: false };
  return runInsightHandlers({ text, selectedCase, topN, days, context, lang });
};

const handlePreCaseRequests = async ({ text, lang, caseLimit, fir }) => {
  if (isCaseListRequest(text)) {
    return buildCaseListResponse(lang, caseLimit);
  }

  if (isCaseCreationRequest(text)) {
    return buildCaseCreationGuidance(lang);
  }

  if (isFirSummaryRequest(text, fir)) {
    const summaryResponse = await handleFirSummaryRequest(fir, lang);
    if (summaryResponse.handled) return summaryResponse;
  }

  return null;
};

const resolveCaseAndMaybeRespond = async ({ fir, caseId, text, lang }) => {
  const selectedCase = await resolveCase({ fir, caseId });
  const needsTarget = includesAny(text, ['cdr', 'ipdr', 'ild', 'sdr', 'record', 'records', 'imei', 'contact', 'trend']);

  if (!selectedCase && needsTarget) {
    return { handled: true, response: { handled: true, mode: 'chat_guidance', response: `${t(lang, 'heading')}\n\n${t(lang, 'noTarget')}`, rowCount: 0 } };
  }
  if (!selectedCase) return { handled: false, response: null, selectedCase: null };

  if (fir && !caseId) {
    const candidates = await findCaseCandidatesByFir(fir, 6);
    if (candidates.length >= 2) {
      return {
        handled: true,
        response: {
          handled: true,
          mode: 'chat_guidance',
          response: buildCaseDisambiguationMarkdown(lang, fir, candidates),
          sql: null,
          rowCount: candidates.length
        }
      };
    }
  }

  return { handled: false, response: null, selectedCase };
};

const handleCaseScopedRequests = async ({ text, selectedCase, wantsAnalysis, topN, days, context, lang }) => {
  const handlers = [
    () => handleDeterministicInsights({ text, selectedCase, wantsAnalysis, topN, days, context, lang }),
    () => handleCountsRequest({ text, selectedCase, context, lang }),
    () => handleTopImeiRequest({ text, selectedCase, topN, context, lang }),
    () => handleTopContactsRequest({ text, selectedCase, topN, context, lang }),
    () => handleHourlyRequest({ text, selectedCase, context, lang }),
    () => handleTrendRequest({ text, selectedCase, days, context, lang }),
    () => handleLongCallsRequest({ text, selectedCase, topN, context, lang })
  ];

  for (const handler of handlers) {
    const result = await handler();
    if (result.handled) return result;
  }

  return { handled: false };
};

const handleCountsRequest = async ({ text, selectedCase, context, lang }) => {
  if (!includesAny(text, ['record count', 'dataset', 'module count', 'counts', 'how many'])) return { handled: false };
  const sql = `
        SELECT
          $1::int AS case_id,
          (SELECT COUNT(*)::int FROM cdr_records c WHERE c.case_id = $1) AS cdr_count,
          (SELECT COUNT(*)::int FROM ipdr_records i WHERE i.case_id = $1) AS ipdr_count,
          (SELECT COUNT(*)::int FROM ild_records il WHERE il.case_id = $1) AS ild_count,
          (SELECT COUNT(*)::int FROM sdr_records s WHERE s.case_id = $1) AS sdr_count
      `;
  const counts = await pool.query(sql, [selectedCase.id]);
  const body = formatTable(
    `${t(lang, 'datasetCounts')} for case ${selectedCase.id}`,
    ['case_id', 'cdr_count', 'ipdr_count', 'ild_count', 'sdr_count'],
    counts.rows
  );
  return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${body}${buildContextNote(lang, context)}`, sql, rowCount: counts.rows.length };
};

const handleTopImeiRequest = async ({ text, selectedCase, topN, context, lang }) => {
  if (!includesAny(text, ['top imei', 'imei top', 'top device'])) return { handled: false };
  const sql = `
        SELECT imei_a AS imei, COUNT(*)::int AS count
        FROM cdr_records
        WHERE case_id = $1
          AND imei_a IS NOT NULL
          AND TRIM(imei_a) <> ''
        GROUP BY imei_a
        ORDER BY COUNT(*) DESC, imei_a ASC
        LIMIT $2
      `;
  const result = await pool.query(sql, [selectedCase.id, topN]);
  if (result.rows.length === 0) return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${t(lang, 'notFound')}`, sql, rowCount: 0 };
  const body = formatTable(`${t(lang, 'topImei')} for case ${selectedCase.id}`, ['imei', 'count'], result.rows);
  return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${body}${buildContextNote(lang, context)}`, sql, rowCount: result.rows.length };
};

const handleTopContactsRequest = async ({ text, selectedCase, topN, context, lang }) => {
  if (!includesAny(text, ['top contact', 'frequent number', 'top number', 'most contacted'])) return { handled: false };
  const sql = `
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
      `;
  const result = await pool.query(sql, [selectedCase.id, topN]);
  if (result.rows.length === 0) return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${t(lang, 'notFound')}`, sql, rowCount: 0 };
  const body = formatTable(`${t(lang, 'topContacts')} (${selectedCase.id})`, ['number', 'count'], result.rows);
  return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${body}${buildContextNote(lang, context)}`, sql, rowCount: result.rows.length };
};

const handleHourlyRequest = async ({ text, selectedCase, context, lang }) => {
  if (!(includesAny(text, ['hourly', 'hour-wise', 'hour wise', 'by hour', 'hours']) && includesAny(text, ['call', 'activity', 'cdr']))) {
    return { handled: false };
  }
  const sql = `
      SELECT
        EXTRACT(HOUR FROM date_time)::int AS hour,
        COUNT(*)::int AS calls
      FROM cdr_records
      WHERE case_id = $1
        AND date_time IS NOT NULL
      GROUP BY 1
      ORDER BY 1 ASC
    `;
  const result = await pool.query(sql, [selectedCase.id]);
  if (result.rows.length === 0) {
    return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${t(lang, 'notFound')}`, sql, rowCount: 0 };
  }

  const body = formatTable(`Hourly Call Activity (case ${selectedCase.id})`, ['hour', 'calls'], result.rows);
  const chartSpec = buildChartSpec({
    type: 'bar',
    title: 'Hourly Call Activity',
    xKey: 'hour',
    yKey: 'calls',
    data: result.rows
  });

  return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${body}${buildContextNote(lang, context)}`, sql, chartSpec, chartSpecs: chartSpec ? [chartSpec] : [], rowCount: result.rows.length };
};

const handleTrendRequest = async ({ text, selectedCase, days, context, lang }) => {
  if (!includesAny(text, ['trend', 'daily', 'timeline', 'pattern', 'last'])) return { handled: false };
  const sql = `
        SELECT call_date, COUNT(*)::int AS calls
        FROM cdr_records
        WHERE case_id = $1
          AND call_date >= CURRENT_DATE - $2::int
        GROUP BY call_date
        ORDER BY call_date DESC
        LIMIT $2
      `;
  const result = await pool.query(sql, [selectedCase.id, days]);
  if (result.rows.length === 0) return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${t(lang, 'notFound')}`, sql, rowCount: 0 };
  const body = formatTable(`${t(lang, 'dailyTrend')} (last ${days} days)`, ['call_date', 'calls'], result.rows);
  const chartSpec = buildChartSpec({
    type: 'line',
    title: `Daily Communication Trend (last ${days} days)`,
    xKey: 'call_date',
    yKey: 'calls',
    data: result.rows.slice().reverse()
  });
  return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${body}${buildContextNote(lang, context)}`, sql, chartSpec, chartSpecs: chartSpec ? [chartSpec] : [], rowCount: result.rows.length };
};

const handleLongCallsRequest = async ({ text, selectedCase, topN, context, lang }) => {
  if (!includesAny(text, ['long call', 'high duration', 'longest'])) return { handled: false };
  const sql = `
        SELECT call_date, calling_number AS a_party, called_number AS b_party, COALESCE(duration_sec, duration, 0) AS duration_sec, imei_a AS imei
        FROM cdr_records
        WHERE case_id = $1
          AND COALESCE(duration_sec, duration) IS NOT NULL
        ORDER BY COALESCE(duration_sec, duration, 0) DESC, call_date DESC
        LIMIT $2
      `;
  const result = await pool.query(sql, [selectedCase.id, topN]);
  if (result.rows.length === 0) return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${t(lang, 'notFound')}`, sql, rowCount: 0 };
  const body = formatTable(`${t(lang, 'longCalls')} (${selectedCase.id})`, ['call_date', 'a_party', 'b_party', 'duration_sec', 'imei'], result.rows);
  return { handled: true, mode: 'db', response: `${t(lang, 'heading')}\n\n${body}${buildContextNote(lang, context)}`, sql, rowCount: result.rows.length };
};

const handleOllamaFallback = async ({ message, selectedCase, wantsAnalysis }) => {
  try {
    const generatedSql = await generateSqlFromText(message, { caseId: selectedCase.id, fir: selectedCase.fir_number });
    const validation = validateReadOnlySql(generatedSql);
    if (validation.ok) {
      const result = await executeReadOnlyQuery(validation.sql);
      const table = formatDbResultAsMarkdown(validation.sql, result);

      if (!wantsAnalysis) {
        return { handled: true, mode: 'db', response: table, sql: validation.sql, sqlRowCount: result.totalRows, sqlTruncated: result.truncated, rowCount: result.rows.length };
      }

      const analysis = await generateDbResultAnalysis({
        question: message,
        sql: validation.sql,
        columns: result.columns,
        rows: result.rows
      });
      return { handled: true, mode: 'db', response: `${table}\n\n${analysis}`, sql: validation.sql, sqlRowCount: result.totalRows, sqlTruncated: result.truncated, rowCount: result.rows.length };
    }
  } catch (error) {
    console.error('NLP SQL Fallback failed:', error);
  }

  return { handled: false };
};

const handleCaseFlow = async ({ fir, caseId, text, lang, wantsAnalysis, topN, days, context }) => {
  const caseResolution = await resolveCaseAndMaybeRespond({ fir, caseId, text, lang });
  if (caseResolution?.response) return { handled: true, response: caseResolution.response };
  if (!caseResolution?.selectedCase) return { handled: false, selectedCase: null };

  const scopedResponse = await handleCaseScopedRequests({
    text,
    selectedCase: caseResolution.selectedCase,
    wantsAnalysis,
    topN,
    days,
    context,
    lang
  });
  if (scopedResponse.handled) return { handled: true, response: scopedResponse, selectedCase: caseResolution.selectedCase };

  return { handled: false, selectedCase: caseResolution.selectedCase };
};

export const tryHandleNaturalLanguageDbRequest = async (message, context = {}) => {
  const text = String(message || '').toLowerCase();
  const lang = context.language || 'en';
  const fir = context.fir || null;
  const caseId = context.caseId || null;
  const topN = Math.max(1, Math.min(100, Number(context.topN || 10)));
  const days = Math.max(1, Math.min(120, Number(context.days || 30)));
  const caseLimit = Math.max(1, Math.min(200, Number(context.caseLimit || 50)));
  const wantsAnalysis = includesAny(text, ['analysis', 'analyze', 'insight', 'insights', 'summary', 'pattern', 'trends']);

  const preCase = await handlePreCaseRequests({ text, lang, caseLimit, fir });
  if (preCase) return preCase;

  const caseFlow = await handleCaseFlow({ fir, caseId, text, lang, wantsAnalysis, topN, days, context });
  if (caseFlow.handled) return caseFlow.response;
  if (!caseFlow.selectedCase) return { handled: false };

  // Fallback to Ollama-powered SQL generation
  return handleOllamaFallback({ message, selectedCase: caseFlow.selectedCase, wantsAnalysis });
};


