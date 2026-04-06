import { unwrapUserMessage } from './text.utils.js';
import { t } from './i18n.service.js';

const INVALID_FIR_TOKENS = new Set(['record', 'records', 'data', 'details', 'detail', 'info', 'information', 'case']);

const extractFirValue = (message) => {
  const userText = unwrapUserMessage(message);
  const match = userText.match(/\bfir\s*[-:#]?\s*([a-z0-9\-\/]+)\b/i);
  if (!match) return null;
  const token = String(match[1] || '').trim().toLowerCase();
  if (!token || INVALID_FIR_TOKENS.has(token)) return null;
  if (!/\d/.test(token)) return null;
  return match[1];
};

export const isSimpleGreeting = (message) => {
  const text = unwrapUserMessage(message).toLowerCase();
  return /^(hi+|hello+|hey+|hii+|hiii+|namaste|kem cho|kemcho|kem chho)$/i.test(text);
};

export const buildGreetingResponse = (lang = 'en') => [
  '### SHAKTI SAHAYATA AI',
  '',
  t(lang, {
    en: 'I can help in Gujarati / Hindi / English.',
    hi: 'Main Gujarati / Hindi / English mein help kar sakta/ sakti hoon.',
    gu: 'Hu Gujarati / Hindi / English ma help kari shaku chu.'
  }),
  '',
  `**${t(lang, { en: 'Quick actions', hi: 'Quick actions', gu: 'Quick actions' })}**`,
  '1. `FIR 3 summary`',
  '2. `open CDR FIR #3`',
  '3. `predict criminal activities for FIR 3`'
].join('\n');

export const looksLikeOpenCdrFirRequest = (message) => {
  const text = unwrapUserMessage(message).toLowerCase();
  return /\b(open|khol|kholjo|khol\s+do|show|get|fetch|view)\b/.test(text)
    && /\bcdr\b/.test(text)
    && /\bfir\b/.test(text);
};

export const looksLikeDirectDbDataRequest = (message) => {
  const text = unwrapUserMessage(message).toLowerCase();
  const hasAction = /\b(get|show|fetch|give|find|list|open|view|analyze|analyse|summary|details|detail|check|see|run|execute)\b/.test(text);
  const hasTarget = /\b(cdr|ipdr|ild|sdr|tower|fir|record|records|database|db|case|imei|imsi|cases)\b/.test(text);
  const hasIndicTerms = /\b(data|details|mahiti|jaankari|record|records|vigat|vivaran|asli|actual|original|real|live)\b/.test(text);

  return (hasAction && hasTarget)
    || (/\b(access)\b/.test(text) && /\b(db|database|cdr|ipdr)\b/.test(text))
    || (hasTarget && hasIndicTerms)
    || (/\b(mane|mujhe|please|plz)\b/.test(text) && hasTarget)
    || /\b(yes|ok|sure|execute|run|do it|haan|ha|karo)\b/.test(text) && /\b(sql|query|actual|data|real)\b/.test(text)
    || /\b(actual|real|live|real-time)\b/.test(text) && /\b(data|records|result|output)\b/.test(text);
};

export const looksLikeCaseScopedQuestion = (message) => {
  const text = unwrapUserMessage(message).toLowerCase();
  const hasCaseWords = /\b(case|fir|cdr|ipdr|ild|sdr|tower|timeline|summary|details|status|investigation|file|operator)\b/.test(text);
  const hasAsk = /\b(what|which|show|get|give|summarize|summary|details|detail|timeline|status|who|where|analyze|analyse|tell)\b/.test(text);
  const hasTag = /(?:^|\s)@/i.test(text);
  return hasTag || (hasCaseWords && hasAsk);
};

export const detectFirRequest = (message) => {
  const text = unwrapUserMessage(message).toLowerCase();
  const firValue = extractFirValue(message);
  if (!firValue) return null;

  // Treat any explicit FIR token containing digits as a DB intent, even if user only typed "FIR 4".
  // This prevents falling back to the LLM which can hallucinate "sample" tables.
  return { firNumber: firValue };
};

export const buildOpenCdrFirGuidanceResponse = (message, ctx = {}, lang = 'en') => {
  const firValue = extractFirValue(message);
  const firClause = firValue ? `'${firValue}'` : '<FIR_NUMBER>';

  return [
    '### SHAKTI SAHAYATA AI',
    '',
    `**${t(lang, { en: 'What I understood', hi: 'What I understood', gu: 'What I understood' })}**`,
    `- ${t(lang, {
      en: 'You want CDR records linked to a FIR in SHAKTI.',
      hi: 'Aap SHAKTI mein FIR se linked CDR records dekhna chahte ho.',
      gu: 'Tame SHAKTI ma FIR sathe linked CDR records jovaa maango cho.'
    })}`,
    firValue
      ? `- ${t(lang, { en: 'FIR detected', hi: 'FIR detected', gu: 'FIR detected' })}: \`${firValue}\``
      : `- ${t(lang, {
        en: 'FIR number is missing or invalid in your message.',
        hi: 'Aapna message ma FIR number missing ya invalid chhe.',
        gu: 'Tamara message ma FIR number missing athva invalid chhe.'
      })}`,
    ctx.caseId ? `- Current case context: \`${ctx.caseId}\`` : null,
    ctx.caseType ? `- Current case type context: \`${ctx.caseType}\`` : null,
    '',
    `**${t(lang, { en: 'Next step', hi: 'Next step', gu: 'Next step' })}**`,
    firValue
      ? `- ${t(lang, {
        en: 'Ask `FIR <number> summary` for direct database summary, or use SQL mode for raw rows.',
        hi: '`FIR <number> summary` puchhiye (DB summary), ya raw rows ke liye SQL mode use kijiye.',
        gu: '`FIR <number> summary` puchho (DB summary) athva raw rows mate SQL mode vapro.'
      })}`
      : `- ${t(lang, {
        en: 'Send valid FIR format like `open CDR FIR #23` or `FIR 23 summary`.',
        hi: 'Valid FIR format moklo: `open CDR FIR #23` athva `FIR 23 summary`.',
        gu: 'Valid FIR format moklo: `open CDR FIR #23` athva `FIR 23 summary`.'
      })}`,
    `- ${t(lang, {
      en: 'Optional filters: mobile number (`calling_number`/`called_number`), date range, IMEI.',
      hi: 'Optional filters: mobile number (`calling_number`/`called_number`), date range, IMEI.',
      gu: 'Optional filters: mobile number (`calling_number`/`called_number`), date range, IMEI.'
    })}`,
    '',
    '**SQL (Read-only)**',
    '```sql',
    'SELECT c.*',
    'FROM cdr_records c',
    'JOIN cases cs ON cs.id = c.case_id',
    `WHERE cs.fir_number = ${firClause}`,
    'ORDER BY c.call_date DESC NULLS LAST, c.id DESC',
    'LIMIT 100',
    '```'
  ].filter(Boolean).join('\n');
};

export const buildSqlGuidanceResponse = (lang = 'en') => [
  '### SHAKTI SAHAYATA AI',
  '',
  `**${t(lang, { en: 'What I understood', hi: 'What I understood', gu: 'What I understood' })}**`,
  `- ${t(lang, {
    en: 'You are asking for SHAKTI database records (CDR/IPDR/ILD/SDR/tower/case data).',
    hi: 'Aap SHAKTI database records (CDR/IPDR/ILD/SDR/tower/case data) maang rahe ho.',
    gu: 'Tame SHAKTI database records (CDR/IPDR/ILD/SDR/tower/case data) maango cho.'
  })}`,
  '',
  `**${t(lang, { en: 'Next step', hi: 'Next step', gu: 'Next step' })}**`,
  `- ${t(lang, {
    en: 'I try automatic DB query for supported requests.',
    hi: 'Supported requests ke liye main automatic DB query try karta/karti hoon.',
    gu: 'Supported requests mate hu automatic DB query try karu chu.'
  })}`,
  `- ${t(lang, {
    en: 'For custom logic, use `/sql` read-only mode.',
    hi: 'Custom logic ke liye `/sql` read-only mode use kijiye.',
    gu: 'Custom logic mate `/sql` read-only mode vapro.'
  })}`,
  '',
  '**SQL (Read-only)**',
  '```sql',
  'SELECT cs.fir_number, COUNT(*) AS cdr_rows',
  'FROM cdr_records c',
  'JOIN cases cs ON cs.id = c.case_id',
  'GROUP BY cs.fir_number',
  'ORDER BY cdr_rows DESC',
  'LIMIT 20',
  '```'
].join('\n');
