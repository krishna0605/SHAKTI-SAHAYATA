import { unwrapUserMessage } from './text.utils.js';
import { detectPreferredLanguage } from './language.service.js';

const extractTopN = (text) => {
  const match = text.match(/\btop\s+(\d{1,3})\b/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(100, n));
};

const extractTaggedCaseRef = (text) => {
  const quoted = text.match(/@"([^"]{2,})"/);
  if (quoted?.[1]) return quoted[1].trim();

  const simple = text.match(/(?:^|\s)@([a-z0-9][a-z0-9_\-\/]{1,63})\b/i);
  return simple?.[1] || null;
};

export const extractMessageEntities = (message, context = {}) => {
  const raw = String(message || '');
  const text = unwrapUserMessage(raw);

  const fir = text.match(/\bfir\s*[-:#]?\s*([a-z0-9\-\/]+)\b/i)?.[1] || null;
  const caseIdExplicit =
    text.match(/\bcase\s*id\s*[-:#]?\s*(\d+)\b/i)?.[1] ||
    text.match(/\bcase\s*[-:#]?\s*(\d+)\b/i)?.[1] ||
    context.caseId ||
    null;
  const taggedCaseRef = extractTaggedCaseRef(text) || context.caseName || null;
  const topN = extractTopN(text);
  const days = Number(text.match(/\b(last|past)\s+(\d{1,3})\s+days?\b/i)?.[2] || 0) || null;

  let module = null;
  const lower = text.toLowerCase();
  if (lower.includes('cdr')) module = 'cdr';
  else if (lower.includes('ipdr')) module = 'ipdr';
  else if (lower.includes('ild')) module = 'ild';
  else if (lower.includes('sdr')) module = 'sdr';
  else if (lower.includes('tower')) module = 'tower';

  return {
    fir,
    caseId: caseIdExplicit,
    caseName: context.caseName || null,
    taggedCaseRef,
    topN,
    days,
    module,
    language: detectPreferredLanguage(text)
  };
};

export const mergeSessionEntities = (sessionState = {}, newEntities = {}) => {
  return {
    fir: newEntities.fir || sessionState.fir || null,
    caseId: newEntities.caseId || sessionState.caseId || null,
    caseName: newEntities.caseName || sessionState.caseName || null,
    taggedCaseRef: newEntities.taggedCaseRef || sessionState.taggedCaseRef || null,
    module: newEntities.module || sessionState.module || null,
    topN: newEntities.topN || sessionState.topN || null,
    days: newEntities.days || sessionState.days || null,
    language: newEntities.language || sessionState.language || 'en'
  };
};
