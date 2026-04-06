const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions?/i,
  /disregard\s+(all\s+)?(system|developer|previous)\s+instructions?/i,
  /reveal\s+(the\s+)?(system prompt|developer prompt|hidden prompt)/i,
  /\b(print|dump|expose|show)\b.*\b(env|environment variables?|\.env|api key|token|secret|password)\b/i,
  /\b(bypass|override)\b.*\b(safety|guardrails?|restrictions?)\b/i,
];

export const isPotentialPromptInjection = (message: string) => {
  const text = String(message || '');
  const isSqlMode = text.trim().toLowerCase().startsWith('/sql ');
  if (isSqlMode) return false;
  return PROMPT_INJECTION_PATTERNS.some((re) => re.test(text));
};

// Normalizes user text inputs sent to APIs (removes control chars, caps length).
export const sanitizeUserText = (value: string, maxLen = 4000) => {
  const text = String(value ?? '');
  const cleaned = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
};

// Prevent spreadsheet/CSV formula injection. See: cells starting with = + - @ or tab.
export const encodeSpreadsheetCell = (value: unknown) => {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const text = value;
  if (!text) return text;
  if (/^[=\-+@]/.test(text) || /^\t/.test(text)) return `'${text}`;
  return text;
};

export const encodeSpreadsheetRows = <T extends Record<string, unknown>>(rows: T[]) => {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row || {})) out[k] = encodeSpreadsheetCell(v);
    return out as T;
  });
};

