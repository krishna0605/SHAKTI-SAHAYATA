import { unwrapUserMessage } from './text.utils.js';

export const detectPreferredLanguage = (message = '') => {
  const text = unwrapUserMessage(message);
  if (!text) return 'en';

  if (/[\u0A80-\u0AFF]/.test(text)) return 'gu';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';

  const lowered = text.toLowerCase();
  if (/\b(gujarati|kem cho|kemchho|kem chho|saru|saaru|majama|maja ma|shu|su|tamne|tame|mane|mne|chhe|chho)\b/.test(lowered)) return 'gu';
  if (/\b(hindi|namaste|kaise|kaisa|kya|kyu|kyun|kripya|kripyaa|mujhe|aap|please|dhanyavaad|dhanyavad|shukriya|karo|kijiye)\b/.test(lowered)) return 'hi';
  return 'en';
};

export const buildLanguageInstruction = (lang) => {
  if (lang === 'gu') {
    return 'Respond in Gujarati (Gujarati script). Keep operational terms, SQL, and table/column names in English.';
  }
  if (lang === 'hi') {
    return 'Respond in Hindi (Devanagari script). Keep operational terms, SQL, and table/column names in English.';
  }
  return 'Respond in English unless the user asks otherwise.';
};
