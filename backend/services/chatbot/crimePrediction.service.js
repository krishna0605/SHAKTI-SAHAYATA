import pool from '../../config/database.js';
import { t } from './i18n.service.js';

const ACTIVITY_KEYWORDS = [
  { re: /\b(fraud|scam|otp|phishing|upi|cheat|cyber)\b/i, activity: 'Financial / Cyber Fraud', weight: 16 },
  { re: /\b(drug|narcotic|ganja|charas|smuggling)\b/i, activity: 'Narcotics Distribution Network', weight: 20 },
  { re: /\b(extortion|threat|blackmail|dhamki)\b/i, activity: 'Extortion / Coercion Activity', weight: 15 },
  { re: /\b(kidnap|abduction|trafficking)\b/i, activity: 'Kidnapping / Trafficking Pattern', weight: 20 },
  { re: /\b(weapon|arms|gun|pistol|rifle)\b/i, activity: 'Arms-linked Activity', weight: 14 },
  { re: /\b(gambling|betting|hawala|laundering)\b/i, activity: 'Illegal Finance / Betting', weight: 14 }
];

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

const FIR_RE = /\bfir\s*[-:#]?\s*([a-z0-9-/]+)\b/i;
const CASE_ID_RE = /\bcase\s*id\s*[-:#]?\s*(\d+)\b/i;

const parseFir = (message = '') => FIR_RE.exec(message)?.[1] || null;
const parseCaseId = (message = '') => CASE_ID_RE.exec(message)?.[1] || null;

const riskLevel = (score) => {
  if (score >= 75) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
};
const riskLevelLabel = (lang, level) => {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'high') return t(lang, { en: 'High', hi: 'High', gu: 'High' });
  if (normalized === 'medium') return t(lang, { en: 'Medium', hi: 'Medium', gu: 'Medium' });
  return t(lang, { en: 'Low', hi: 'Low', gu: 'Low' });
};

const detectKeywordActivities = (text = '') => {
  const matched = [];
  let score = 0;
  for (const rule of ACTIVITY_KEYWORDS) {
    if (rule.re.test(text)) {
      matched.push(rule.activity);
      score += rule.weight;
    }
  }
  return { activities: [...new Set(matched)], score };
};

const fetchCaseByContext = async ({ fir, caseId }) => {
  if (caseId) {
    const byId = await pool.query(
      `SELECT id, case_name, fir_number, description, case_type, status, created_at FROM cases WHERE id = $1 LIMIT 1`,
      [Number(caseId)]
    );
    if (byId.rows[0]) return byId.rows[0];
  }

  if (!fir) return null;
  const byFir = await pool.query(
    String.raw`
      SELECT id, case_name, fir_number, description, case_type, status, created_at
      FROM cases
      WHERE
        TRIM(COALESCE(fir_number, '')) = $1
        OR REGEXP_REPLACE(COALESCE(fir_number, ''), '\D', '', 'g') = REGEXP_REPLACE($1, '\D', '', 'g')
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [String(fir)]
  );
  return byFir.rows[0] || null;
};

const applyThresholds = (value, thresholds, signals) => {
  for (const threshold of thresholds) {
    if (value >= threshold.min) {
      signals.push(threshold.text);
      return threshold.score;
    }
  }
  return 0;
};

const computeRiskScore = ({ metrics, caseRow }) => {
  const signals = [];
  let score = 12;

  score += applyThresholds(metrics.cdrCount, [
    { min: 12000, score: 24, text: 'Very high CDR volume' },
    { min: 4000, score: 15, text: 'High CDR volume' },
    { min: 1000, score: 8, text: 'Moderate CDR volume' }
  ], signals);

  score += applyThresholds(metrics.uniqueContacts, [
    { min: 1200, score: 20, text: 'Very wide contact network' },
    { min: 300, score: 10, text: 'Wide contact network' }
  ], signals);

  score += applyThresholds(metrics.uniqueImei, [
    { min: 35, score: 14, text: 'High device churn' },
    { min: 10, score: 8, text: 'Device switching pattern' }
  ], signals);

  score += applyThresholds(metrics.ipdrCount, [
    { min: 5000, score: 12, text: 'High internet activity density' },
    { min: 1000, score: 6, text: 'Moderate internet activity density' }
  ], signals);

  if (metrics.ildCount > 1000) {
    score += 8;
    signals.push('Significant ILD activity');
  }

  if (metrics.dominantContactShare >= 25) {
    score += 8;
    signals.push('Strong dominant-contact concentration');
  }

  score += applyThresholds(metrics.peakDailyCalls, [
    { min: 500, score: 10, text: 'Burst communication day detected' },
    { min: 150, score: 5, text: 'Noticeable daily call burst' }
  ], signals);

  const caseText = `${caseRow.case_name || ''} ${caseRow.case_type || ''} ${caseRow.description || ''}`;
  const keyword = detectKeywordActivities(caseText);
  score += keyword.score;
  if (keyword.score > 0) signals.push('Case text contains offense-specific keywords');
  if (String(caseRow.status || '').toLowerCase() === 'active') score += 4;

  return {
    score: clamp(Math.round(score), 0, 100),
    signals,
    activities: keyword.activities
  };
};

export const isCrimePredictionRequest = (message = '') => {
  const text = String(message || '').toLowerCase();
  return /\b(predict|prediction|risk|criminal activity|crime pattern|forecast|threat analysis)\b/.test(text);
};

const buildPredictionResponse = ({ caseRow, score, level, signals, activities, metrics, lang }) => {
  const language = lang || 'en';
  return [
    '### SHAKTI SAHAYATA AI',
    '',
    `**${t(language, {
      en: 'Criminal Activity Risk Prediction',
      hi: 'Criminal Activity Risk Prediction',
      gu: 'Criminal Activity Risk Prediction'
    })}**`,
    '',
    `Case: **${caseRow.case_name || '-'}** | FIR: **${caseRow.fir_number || '-'}** | Case ID: **${caseRow.id}**`,
    '',
    `| ${t(language, { en: 'Metric', hi: 'Metric', gu: 'Metric' })} | ${t(language, { en: 'Value', hi: 'Value', gu: 'Value' })} |`,
    '| --- | --- |',
    `| ${t(language, { en: 'Risk Score', hi: 'Risk Score', gu: 'Risk Score' })} | ${score}/100 (${riskLevelLabel(language, level)}) |`,
    `| ${t(language, { en: 'CDR Records', hi: 'CDR Records', gu: 'CDR Records' })} | ${metrics.cdrCount} |`,
    `| ${t(language, { en: 'Unique Contacts', hi: 'Unique Contacts', gu: 'Unique Contacts' })} | ${metrics.uniqueContacts} |`,
    `| ${t(language, { en: 'Unique IMEI', hi: 'Unique IMEI', gu: 'Unique IMEI' })} | ${metrics.uniqueImei} |`,
    `| ${t(language, { en: 'IPDR Records', hi: 'IPDR Records', gu: 'IPDR Records' })} | ${metrics.ipdrCount} |`,
    `| ${t(language, { en: 'ILD Records', hi: 'ILD Records', gu: 'ILD Records' })} | ${metrics.ildCount} |`,
    `| ${t(language, { en: 'SDR Records', hi: 'SDR Records', gu: 'SDR Records' })} | ${metrics.sdrCount} |`,
    `| ${t(language, { en: 'Peak Daily Calls', hi: 'Peak Daily Calls', gu: 'Peak Daily Calls' })} | ${metrics.peakDailyCalls} |`,
    `| ${t(language, { en: 'Dominant Contact Share', hi: 'Dominant Contact Share', gu: 'Dominant Contact Share' })} | ${metrics.dominantContactShare}% |`,
    '',
    `**${t(language, { en: 'Likely activity classes', hi: 'Likely activity classes', gu: 'Likely activity classes' })}**`,
    ...(activities.length ? activities.map((x, i) => `${i + 1}. ${x}`) : ['1. Coordinated communication pattern (generic)']),
    '',
    `**${t(language, { en: 'Risk signals used', hi: 'Risk signals used', gu: 'Risk signals used' })}**`,
    ...(signals.length ? signals.map((x) => `- ${x}`) : ['- Limited data signals available']),
    '',
    `**${t(language, { en: 'Recommended next investigative steps', hi: 'Recommended next investigative steps', gu: 'Recommended next investigative steps' })}**`,
    `1. ${t(language, {
      en: 'Validate top contacts against SDR/KYC and historical case overlap.',
      hi: 'Top contacts ko SDR/KYC aur historical overlap se validate kijiye.',
      gu: 'Top contacts ne SDR/KYC ane historical overlap sathe validate karo.'
    })}`,
    `2. ${t(language, {
      en: 'Focus on high-duration calls and burst-date windows for timeline reconstruction.',
      hi: 'High-duration calls aur burst-date windows par focus karke timeline banaiye.',
      gu: 'High-duration calls ane burst-date windows par focus kari timeline banao.'
    })}`,
    `3. ${t(language, {
      en: 'Cross-check dominant IMEI shifts with location/tower evidence.',
      hi: 'Dominant IMEI shifts ko location/tower evidence se cross-check kijiye.',
      gu: 'Dominant IMEI shifts ne location/tower evidence sathe cross-check karo.'
    })}`,
    '',
    t(language, {
      en: '_Analytical prediction only. Use as lead-generation support, not legal proof._',
      hi: '_Analytical prediction only. Use as lead-generation support, not legal proof._',
      gu: '_Analytical prediction only. Use as lead-generation support, not legal proof._'
    })
  ].join('\n');
};

export const generateCrimePredictionResponse = async (message = '', context = {}) => {
  const lang = context.language || 'en';
  const fir = context.fir || parseFir(message);
  const caseId = context.caseId || parseCaseId(message);
  const caseRow = await fetchCaseByContext({ fir, caseId });

  if (!caseRow) {
    return {
      ok: false,
      mode: 'prediction',
      riskScore: null,
      signalCount: 0,
      response: [
        '### SHAKTI SAHAYATA AI',
        '',
        t(lang, {
          en: 'Case not found for prediction.',
          hi: 'Prediction ke liye case nahi mila.',
          gu: 'Prediction mate case malyo nathi.'
        }),
        t(lang, {
          en: 'Provide `FIR <number>` or `Case ID <id>` to run case-level risk prediction.',
          hi: 'Case-level risk prediction mate `FIR <number>` athva `Case ID <id>` aapo.',
          gu: 'Case-level risk prediction mate `FIR <number>` athva `Case ID <id>` aapo.'
        })
      ].join('\n')
    };
  }

  const [cdrAgg, ipdr, ild, sdr, daily, topContact] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS cdr_count,
          COUNT(DISTINCT NULLIF(imei_a, ''))::int AS unique_imei,
          (
            SELECT COUNT(DISTINCT n.number)::int
            FROM (
              SELECT NULLIF(calling_number, '') AS number FROM cdr_records WHERE case_id = $1
              UNION
              SELECT NULLIF(called_number, '') AS number FROM cdr_records WHERE case_id = $1
            ) n
            WHERE n.number IS NOT NULL
          ) AS unique_contacts
        FROM cdr_records
        WHERE case_id = $1
      `,
      [caseRow.id]
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM ipdr_records WHERE case_id = $1`, [caseRow.id]),
    pool.query(`SELECT COUNT(*)::int AS count FROM ild_records WHERE case_id = $1`, [caseRow.id]),
    pool.query(`SELECT COUNT(*)::int AS count FROM sdr_records WHERE case_id = $1`, [caseRow.id]),
    pool.query(
      `
        SELECT call_date, COUNT(*)::int AS calls
        FROM cdr_records
        WHERE case_id = $1
        GROUP BY call_date
        ORDER BY calls DESC
        LIMIT 1
      `,
      [caseRow.id]
    ),
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
        LIMIT 1
      `,
      [caseRow.id]
    )
  ]);

  const cdr = cdrAgg.rows[0] || { cdr_count: 0, unique_imei: 0, unique_contacts: 0 };
  const cdrCount = Number(cdr.cdr_count || 0);
  const uniqueImei = Number(cdr.unique_imei || 0);
  const uniqueContacts = Number(cdr.unique_contacts || 0);
  const ipdrCount = Number(ipdr.rows[0]?.count || 0);
  const ildCount = Number(ild.rows[0]?.count || 0);
  const sdrCount = Number(sdr.rows[0]?.count || 0);
  const peakDailyCalls = Number(daily.rows[0]?.calls || 0);
  const topContactCount = Number(topContact.rows[0]?.count || 0);
  const dominantContactShare = cdrCount > 0 ? clamp(Math.round((topContactCount / cdrCount) * 100), 0, 100) : 0;

  const { score, signals, activities } = computeRiskScore({
    metrics: {
      cdrCount,
      uniqueContacts,
      uniqueImei,
      ipdrCount,
      ildCount,
      sdrCount,
      peakDailyCalls,
      dominantContactShare
    },
    caseRow
  });
  const level = riskLevel(score);

  const metrics = {
    cdrCount,
    uniqueContacts,
    uniqueImei,
    ipdrCount,
    ildCount,
    sdrCount,
    peakDailyCalls,
    dominantContactShare
  };

  return {
    ok: true,
    mode: 'prediction',
    riskScore: score,
    signalCount: signals.length,
    metrics,
    response: buildPredictionResponse({
      caseRow,
      score,
      level,
      signals,
      activities,
      metrics,
      lang
    })
  };
};
