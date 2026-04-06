import { t } from './i18n.service.js';

const looksLikeFakeSqlExecution = (text) => {
  const s = String(text || '');
  if (!s) return false;
  if (/\brunning\s+(the\s+)?sql\s+query\b/i.test(s)) return true;
  if (/\bresults?\b\s*:\s*\n/i.test(s) && /\btable\b/i.test(s)) return true;
  if (/^\s*\|.+\|\s*\n\s*\|(?:\s*-+\s*\|)+\s*\n\s*\|.+\|\s*$/m.test(s)) return true;
  if (/^\s*id\s+case_name\s+case_number\s+fir_number\b/im.test(s)) return true;
  return false;
};

const looksLikeMutatingSqlSuggestion = (text) => {
  const s = String(text || '');
  if (!s) return false;
  if (/```[\s\S]*?\b(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b[\s\S]*?```/i.test(s)) return true;
  if (/\b(insert\s+into|update\s+\w+|delete\s+from|create\s+table|alter\s+table|drop\s+table|truncate\s+table)\b/i.test(s)) return true;
  if (/\bcreating\s+(a\s+)?new\s+case\b/i.test(s)) return true;
  if (/\bcase\s+created\b/i.test(s)) return true;
  return false;
};

export const guardAgainstDbHallucinations = (text, lang = 'en') => {
  const s = String(text || '').trim();
  if (!s) return s;

  if (!looksLikeFakeSqlExecution(s)) return s;

  const guidance = [
    '### SHAKTI SAHAYATA AI',
    '',
    t(lang, {
      en: 'I did **not** run a database query in this response, so I cannot show real rows.',
      hi: 'Is response mein maine **database query run nahi** kiya, isliye main real rows nahi dikha sakta.',
      gu: 'Aa response ma hu **database query run nathi** karyu, etle hu real rows batavi shaku nahi.'
    }),
    '',
    t(lang, {
      en: 'To get accurate DB output, use read-only SQL mode:',
      hi: 'Accurate DB output mate read-only SQL mode vapro:',
      gu: 'Accurate DB output mate read-only SQL mode vapro:'
    }),
    '',
    '```sql',
    '/sql SELECT id, case_name, case_number, fir_number, status, created_at FROM cases ORDER BY created_at DESC LIMIT 50',
    '```',
    '',
    t(lang, {
      en: 'If you tell me the FIR number or Case ID, I can generate the exact query for your goal.',
      hi: 'Agar aap FIR number ya Case ID bataoge, main aapke goal ke liye exact query bana dunga/dungi.',
      gu: 'Jo tame FIR number ke Case ID aapo, hu tamara goal mate exact query banavi aapi shaku.'
    })
  ].join('\n');

  return guidance;
};

export const guardAgainstMutatingSuggestions = (text, lang = 'en') => {
  const s = String(text || '').trim();
  if (!s) return s;
  if (!looksLikeMutatingSqlSuggestion(s)) return s;

  return [
    '### SHAKTI SAHAYATA AI',
    '',
    t(lang, {
      en: 'I can\'t create/update cases or suggest mutating SQL here. This chatbot is **read-only** for database access.',
      hi: 'Main yahan cases create/update nahi kar sakta/sakti aur mutating SQL suggest nahi kar sakta/sakti. Chatbot DB access **read-only** hai.',
      gu: 'Hu aa chatbot ma case create/update kari shaktu nathi ane mutating SQL suggest pan nathi karto. Chatbot DB access **read-only** chhe.'
    }),
    '',
    t(lang, {
      en: 'To create a case, use the SHAKTI UI (Cases → Create Case).',
      hi: 'Case create karva mate SHAKTI UI vapro (Cases → Create Case).',
      gu: 'Case create karva mate SHAKTI UI vapro (Cases → Create Case).'
    }),
    '',
    t(lang, {
      en: 'If you want, I can list existing cases from DB using read-only SQL:',
      hi: 'Jo tamne hoy to hu read-only SQL thi existing cases list kari shaku:',
      gu: 'Jo tamne hoy to hu read-only SQL thi existing cases list kari shaku:'
    }),
    '',
    '```sql',
    '/sql SELECT id, case_name, case_number, fir_number, status, created_at FROM cases ORDER BY created_at DESC LIMIT 50',
    '```'
  ].join('\n');
};
