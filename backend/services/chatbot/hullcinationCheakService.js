import { t } from './i18n.service.js';

const looksLikeHallucinatedDbOutput = (text) => {
  const s = String(text || '').trim();
  if (!s) return false;
  if (/\b(ran|executed|running)\s+(the\s+)?(sql|query|database)\b/i.test(s)) return true;
  if (/\breturned\s+\d+\s+rows\b/i.test(s)) return true;
  if (/\bresults?\b\s*:\s*\n/i.test(s) && /\btable\b/i.test(s)) return true;
  if (/\bfrom\s+database\b/i.test(s) || /\bfrom\s+the\s+db\b/i.test(s)) return true;
  if (/^\s*\|.+\|\s*\n\s*\|(?:\s*-+\s*\|)+\s*\n\s*\|.+\|\s*$/m.test(s)) return true;
  if (/^\s*(id|case_id)\s+case_name\s+case_number\s+fir_number\b/im.test(s)) return true;
  return false;
};

const containsSqlCommand = (text) => /\/sql\s+select\b/i.test(String(text || ''));

export const guardAgainstHallucination = (text, lang = 'en', options = {}) => {
  const s = String(text || '').trim();
  if (!s) return s;

  const mode = String(options.mode || '').toLowerCase();
  if (mode.startsWith('db') || mode === 'prediction') return s;

  if (!looksLikeHallucinatedDbOutput(s)) return s;
  if (containsSqlCommand(s)) return s;

  return [
    '### SHAKTI SAHAYATA AI',
    '',
    t(lang, {
      en: 'I did **not** run a live database query in this response, so I cannot show real rows or counts.',
      hi: 'Is response mein maine **live database query run nahi** kiya, isliye real rows ya counts nahi dikha sakta.',
      gu: 'Aa response ma hu **live database query run nathi** karyu, etle hu real rows ke counts batavi shaku nahi.'
    }),
    '',
    t(lang, {
      en: 'To get verified DB output, use read-only SQL mode:',
      hi: 'Verified DB output mate read-only SQL mode vapro:',
      gu: 'Verified DB output mate read-only SQL mode vapro:'
    }),
    '',
    '```sql',
    '/sql SELECT id, case_name, case_number, fir_number, status, created_at FROM cases ORDER BY created_at DESC LIMIT 50',
    '```',
    '',
    t(lang, {
      en: 'If you provide a FIR number or Case ID, I will generate the exact query.',
      hi: 'Agar aap FIR number ya Case ID doge, main exact query bana dunga/dungi.',
      gu: 'Jo tame FIR number ke Case ID aapo, hu exact query banavi aapi shaku.'
    })
  ].join('\n');
};
