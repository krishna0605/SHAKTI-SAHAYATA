export const normalizeText = (value) => String(value || '').trim();
export const digitsOnly = (value) => String(value || '').replaceAll(/\D+/g, '');
export const formatNumber = (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-IN') : String(n ?? 0));

export const unwrapUserMessage = (message) => {
  const text = normalizeText(message);
  const match = /(?:^|\n)\s*User:\s*([\s\S]+)$/i.exec(text);
  return normalizeText(match?.[1] ?? text);
};

export const parseContextFromMessage = (message) => {
  const text = String(message || '');
  const read = (label) => {
    const re = new RegExp(String.raw`^${label}:\s*(.+)$`, 'im');
    const match = re.exec(text);
    return normalizeText(match?.[1] ?? '');
  };

  return {
    caseId: read('Case ID') || null,
    caseName: read('Case Name') || null,
    caseType: read('Case Type') || null,
    fileId: read('File ID') || null
  };
};
