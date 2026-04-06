import { t } from './i18n.service.js';

const SCOPE_TERMS = [
  'fir',
  'case',
  'cdr',
  'ipdr',
  'ild',
  'sdr',
  'tower',
  'cell',
  'imei',
  'imsi',
  'call',
  'contact',
  'suspect',
  'accused',
  'investigation',
  'evidence',
  'timeline',
  'crime',
  'criminal',
  'police',
  'offense',
  'risk',
  'prediction'
];

const inScopeByKeywords = (text) => {
  const s = String(text || '').toLowerCase();
  return SCOPE_TERMS.some((term) => s.includes(term));
};

export const enforceRagScope = ({ message, ragMatches, lang = 'en' } = {}) => {
  const hasRag = Array.isArray(ragMatches) && ragMatches.length > 0;
  const inScope = inScopeByKeywords(message);

  if (hasRag && inScope) return { allowed: true, reason: null };

  return {
    allowed: false,
    reason: !hasRag ? 'no_rag' : 'out_of_scope',
    response: [
      '### SHAKTI SAHAYATA AI',
      '',
      t(lang, {
        en: 'I can only answer queries that are **within the project investigation scope** and supported by internal project documents.',
        hi: 'Main sirf **project investigation scope** aur internal docs se supported queries ka jawab de sakta/sakti hoon.',
        gu: 'Hu fakt **project investigation scope** ane internal docs thi supported queries no jawab aapi shaku chu.'
      }),
      '',
      t(lang, {
        en: 'Please ask about FIR/case investigation tasks (CDR/IPDR/ILD/SDR/tower, suspects, evidence, timelines, risk prediction).',
        hi: 'Kripya FIR/case investigation tasks ke baare mein poochhein (CDR/IPDR/ILD/SDR/tower, suspects, evidence, timelines, risk prediction).',
        gu: 'Kripya FIR/case investigation tasks vishe pucho (CDR/IPDR/ILD/SDR/tower, suspects, evidence, timelines, risk prediction).'
      })
    ].join('\n')
  };
};
