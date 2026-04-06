const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toPercent = (score) => Math.round(score * 100);

const labelForScore = (score) => {
  if (score >= 0.8) return 'High';
  if (score >= 0.55) return 'Medium';
  return 'Low';
};

const topRagScore = (matches) => {
  if (!Array.isArray(matches) || matches.length === 0) return 0;
  let top = 0;
  for (const m of matches) {
    const v = Number(m?.score) || 0;
    if (v > top) top = v;
  }
  return top;
};

export const computeConfidence = ({
  mode = 'chat',
  ragMatches = [],
  sqlRowCount = null,
  sqlTruncated = false,
  rowCount = null,
  responseText = '',
  isGreeting = false,
  intentScore = null,
  intentLabel = '',
  predictionScore = null,
  predictionSignals = null,
  hasChart = false
} = {}) => {
  const reasons = [];
  const basis = {};
  let score = 0.52;
  basis.mode = mode;

  const baseByMode = {
    chat: 0.52,
    chat_guidance: 0.62,
    db: 0.88,
    db_summary: 0.9,
    db_analysis: 0.86,
    prediction: 0.82
  };

  if (isGreeting) {
    score = 0.92;
    reasons.push('Simple greeting');
  } else {
    score = Number.isFinite(baseByMode[mode]) ? baseByMode[mode] : 0.52;
    if (mode === 'db' || mode === 'db_summary' || mode === 'db_analysis') reasons.push('Deterministic database response');
    else if (mode === 'prediction') reasons.push('Rule-based prediction');
    else if (mode === 'chat_guidance') reasons.push('Guidance response');
    else reasons.push('Generative response');
  }

  if (Number.isFinite(intentScore)) {
    const weight = 0.35;
    score = (score * (1 - weight)) + (intentScore * weight);
    basis.intent = Math.round(intentScore * 100) / 100;
    reasons.push(intentLabel ? `Intent match (${intentLabel})` : 'Intent match');
  }

  const evidenceCount = Number.isFinite(sqlRowCount) ? sqlRowCount : (Number.isFinite(rowCount) ? rowCount : null);
  if (Number.isFinite(evidenceCount)) {
    basis.rows = evidenceCount;
    if (evidenceCount === 0) {
      score -= 0.18;
      reasons.push('No rows returned');
    } else if (evidenceCount <= 5) {
      score += 0.02;
      reasons.push('Few rows returned');
    } else if (evidenceCount <= 50) {
      score += 0.04;
      reasons.push('Rows returned');
    } else if (evidenceCount <= 200) {
      score += 0.06;
      reasons.push('Many rows returned');
    } else {
      score += 0.08;
      reasons.push('Large result set');
    }
  }

  if (sqlTruncated) {
    score -= 0.03;
    reasons.push('Result truncated');
  }

  const ragScore = topRagScore(ragMatches);
  basis.rag = Math.round(ragScore * 10000) / 10000;
  if (ragScore > 0) {
    const ragBoost = Math.min(0.12, ragScore * 0.5);
    score += ragBoost;
    if (ragScore >= 0.25) reasons.push('High RAG match');
    else if (ragScore >= 0.15) reasons.push('Moderate RAG match');
    else reasons.push('Weak RAG match');
  } else if (mode === 'chat') {
    score -= 0.05;
    reasons.push('No RAG context');
  }

  if (/no rows returned|not found|missing|invalid/i.test(String(responseText || ''))) {
    score -= 0.07;
    reasons.push('Low evidence in result');
  }

  const wordCount = String(responseText || '').trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > 0) basis.words = wordCount;
  if (wordCount > 0 && wordCount <= 12) {
    score -= 0.1;
    reasons.push('Very short response');
  } else if (wordCount <= 30) {
    score -= 0.05;
    reasons.push('Short response');
  } else if (wordCount >= 150 && wordCount < 300) {
    score += 0.03;
    reasons.push('Detailed response');
  } else if (wordCount >= 300) {
    score += 0.05;
    reasons.push('Very detailed response');
  }

  if (/\b(maybe|might|could|not sure|unsure|possibly)\b/i.test(String(responseText || ''))) {
    score -= 0.05;
    reasons.push('Uncertainty language detected');
  }

  if (/no response generated|system error/i.test(String(responseText || ''))) {
    score -= 0.2;
    reasons.push('System error response');
  }

  if (Number.isFinite(predictionScore)) {
    basis.prediction = Math.round(predictionScore);
    if (Number.isFinite(predictionSignals)) basis.signals = predictionSignals;
    if (predictionSignals >= 3) {
      score += 0.03;
      reasons.push('Multiple risk signals');
    } else if (predictionSignals === 0) {
      score -= 0.04;
      reasons.push('No risk signals');
    }
  }

  if (hasChart) {
    score += 0.02;
    reasons.push('Charted evidence');
    basis.chart = true;
  }

  const finalScore = clamp(score, 0.15, 0.97);
  return {
    score: Math.round(finalScore * 100) / 100,
    scorePct: toPercent(finalScore),
    label: labelForScore(finalScore),
    reasons,
    ragScore: Math.round(ragScore * 10000) / 10000,
    basis
  };
};

export const formatConfidenceBlock = (confidence, lang = 'en') => {
  if (!confidence) return '';
  const labels = {
    en: { title: 'Confidence', basis: 'Basis', high: 'High', medium: 'Medium', low: 'Low' },
    hi: { title: 'Confidence', basis: 'Basis', high: 'High', medium: 'Medium', low: 'Low' },
    gu: { title: 'Confidence', basis: 'Basis', high: 'High', medium: 'Medium', low: 'Low' }
  };
  const dict = labels[lang] || labels.en;
  const labelMap = { High: dict.high, Medium: dict.medium, Low: dict.low };
  const label = labelMap[confidence.label] || confidence.label;
  const basisParts = [];
  if (confidence?.basis?.mode) basisParts.push(`mode=${confidence.basis.mode}`);
  if (Number.isFinite(confidence?.basis?.rows)) basisParts.push(`rows=${confidence.basis.rows}`);
  if (Number.isFinite(confidence?.basis?.rag)) basisParts.push(`rag=${confidence.basis.rag}`);
  if (Number.isFinite(confidence?.basis?.words)) basisParts.push(`words=${confidence.basis.words}`);
  if (Number.isFinite(confidence?.basis?.intent)) basisParts.push(`intent=${confidence.basis.intent}`);
  if (Number.isFinite(confidence?.basis?.prediction)) basisParts.push(`risk=${confidence.basis.prediction}`);
  if (Number.isFinite(confidence?.basis?.signals)) basisParts.push(`signals=${confidence.basis.signals}`);
  if (confidence?.basis?.chart) basisParts.push('chart=true');
  const basis = basisParts.length > 0
    ? basisParts.join(', ')
    : (Array.isArray(confidence.reasons) && confidence.reasons.length > 0 ? confidence.reasons.join(', ') : 'Heuristic estimate');

  return [
    '---',
    `**${dict.title}**: ${confidence.scorePct}/100 (${label})`,
    `_${dict.basis}: ${basis}_`
  ].join('\n');
};
