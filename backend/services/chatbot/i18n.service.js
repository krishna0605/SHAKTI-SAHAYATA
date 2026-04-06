const normalizeLang = (lang) => {
  const v = String(lang || '').trim().toLowerCase();
  if (v === 'gu' || v === 'hi' || v === 'en') return v;
  return 'en';
};

export const t = (lang, messages) => {
  const l = normalizeLang(lang);
  if (!messages || typeof messages !== 'object') return '';
  return String(messages[l] || messages.en || '').trim();
};

export const formatList = (lang, items = []) => {
  const l = normalizeLang(lang);
  const joiner = l === 'hi' ? ' और ' : (l === 'gu' ? ' અને ' : ' and ');
  const clean = (Array.isArray(items) ? items : []).map((x) => String(x || '').trim()).filter(Boolean);
  if (clean.length <= 1) return clean[0] || '';
  if (clean.length === 2) return `${clean[0]}${joiner}${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')},${joiner}${clean[clean.length - 1]}`;
};
