import {
  CASE_QA_MODULE_LABELS,
  getCaseQaCatalogEntry
} from '../../../shared/chatbot/caseQaCatalog.js';

const PREVIEW_LIMIT = 10;
const EVIDENCE_LIMIT = 50;

const normalizeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');

const formatDuration = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '-';
  return `${Math.round(numeric)}s`;
};

const formatBytes = (value) => {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0 B';
  if (numeric >= 1024 ** 3) return `${(numeric / (1024 ** 3)).toFixed(2)} GB`;
  if (numeric >= 1024 ** 2) return `${(numeric / (1024 ** 2)).toFixed(2)} MB`;
  if (numeric >= 1024) return `${(numeric / 1024).toFixed(2)} KB`;
  return `${Math.round(numeric)} B`;
};

const formatCellValue = (value, format = null) => {
  if (value == null || value === '') return '-';
  if (format === 'number') return formatNumber(value);
  if (format === 'duration') return formatDuration(value);
  if (format === 'bytes') return formatBytes(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const takePreview = (rows = [], limit = PREVIEW_LIMIT) => normalizeArray(rows).slice(0, limit);

const hasMeaningfulValue = (value) => {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

const containsRawObjectString = (value) => {
  if (typeof value === 'string') return value.includes('[object Object]');
  if (Array.isArray(value)) return value.some((item) => containsRawObjectString(item));
  if (value && typeof value === 'object') return Object.values(value).some((item) => containsRawObjectString(item));
  return false;
};

const sanitizePayload = (payload) => {
  if (!payload) return payload;
  if (containsRawObjectString(payload)) {
    if (process.env.NODE_ENV === 'test') {
      throw new Error('Grounded answer payload contains raw object stringification.');
    }
    return {
      ...payload,
      kind: 'abstain',
      shortAnswer: 'I found grounded data for this request, but I could not safely format it for display.',
      evidence: [],
      actions: payload.actions || [],
      emptyState: 'Formatting safeguard triggered for this answer.'
    };
  }

  // Deep check: ensure no evidence cell or shortAnswer slipped through with raw object rendering
  if (payload.shortAnswer && typeof payload.shortAnswer === 'object') {
    payload.shortAnswer = JSON.stringify(payload.shortAnswer);
  }
  if (Array.isArray(payload.evidence)) {
    for (const block of payload.evidence) {
      if (Array.isArray(block.items)) {
        block.items = block.items.map((item) => (typeof item === 'object' && item !== null) ? JSON.stringify(item) : String(item ?? ''));
      }
      const rowArrays = [block.previewRows, block.rows].filter(Array.isArray);
      for (const rows of rowArrays) {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (!row || typeof row !== 'object') continue;
          const clean = {};
          for (const [k, v] of Object.entries(row)) {
            clean[k] = (v && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '-');
          }
          rows[i] = clean;
        }
      }
    }
  }
  return payload;
};

const buildScopeDescriptor = ({
  caseId,
  caseLabel,
  module = null,
  view = null,
  workspaceContext = null,
  scopeMode = 'case-wide',
  scopeOrigin = 'locked_session_case',
  broadenedFromWorkspace = false
}) => ({
  caseId: String(caseId || ''),
  caseLabel: caseLabel || null,
  scopeOrigin,
  scopeMode,
  module: module || null,
  moduleLabel: module ? (CASE_QA_MODULE_LABELS[module] || module.toUpperCase()) : null,
  view: view || null,
  selectedFileIds: normalizeArray(workspaceContext?.selectedFileIds || []),
  selectedFileNames: normalizeArray(workspaceContext?.selectedFileNames || []),
  filtersApplied: normalizeObject(workspaceContext?.filters || null),
  searchQuery: workspaceContext?.searchState?.query || null,
  selectedEntities: normalizeArray(workspaceContext?.selectedEntities || []),
  mapState: normalizeObject(workspaceContext?.mapState || null),
  graphState: normalizeObject(workspaceContext?.graphState || null),
  selectionTimestamp: workspaceContext?.selectionTimestamp || null,
  broadenedFromWorkspace: Boolean(broadenedFromWorkspace)
});

const buildSourceList = ({ summary = null, tables = [], sourceType = 'memory', fileIds = [] } = {}) => {
  const sourceTables = [...new Set([...(summary?.sources?.tables || []), ...normalizeArray(tables)])];
  const meta = summary?.meta || {};
  return [
    {
      sourceType,
      tables: sourceTables,
      cacheStatus: meta.cache || null,
      generatedAt: summary?.sources?.generatedAt || summary?.generatedAt || null,
      fileIds: normalizeArray(fileIds)
    }
  ];
};

const getFactValue = (summary = null, catalogEntry = null) => {
  if (!summary?.facts || !catalogEntry) return null;
  for (const key of catalogEntry.factKeys || []) {
    if (summary.facts[key] !== undefined && summary.facts[key] !== null) {
      return summary.facts[key];
    }
  }
  return null;
};

const buildScalarShortAnswer = (entry, value) => {
  if (entry?.key === 'avg_duration_sec') return `${entry.displayLabel}: ${formatDuration(value)}`;
  if (entry?.key === 'data_volume') return `${entry.displayLabel}: ${formatBytes(value)}`;
  if (typeof value === 'number') return `${entry.displayLabel}: ${formatNumber(value)}`;
  return `${entry.displayLabel}: ${formatCellValue(value)}`;
};

const buildSubObjectAnswer = (entry, value) => {
  const key = entry?.key;
  if (!key || value == null) return null;

  if (key === 'sms_analysis') {
    const obj = normalizeObject(value) || {};
    const total = Number(obj.total || 0);
    const sent = Number(obj.sent || 0);
    const received = Number(obj.received || 0);
    return {
      shortAnswer: `SMS Analysis: Total ${formatNumber(total)}, Sent ${formatNumber(sent)}, Received ${formatNumber(received)}`,
      evidence: [{
        type: 'table',
        columns: [{ key: 'metric', label: 'Metric' }, { key: 'value', label: 'Value' }],
        previewRows: [
          { metric: 'Total SMS', value: formatNumber(total) },
          { metric: 'Sent (SMO)', value: formatNumber(sent) },
          { metric: 'Received (SMT)', value: formatNumber(received) }
        ],
        totalCount: 3
      }]
    };
  }

  if (key === 'night_activity') {
    const obj = normalizeObject(value) || {};
    const totalRecords = Number(obj.total_records || 0);
    const peakHours = normalizeArray(obj.peak_hours || []);
    const lines = [`Night activity records: ${formatNumber(totalRecords)}`];
    if (peakHours.length > 0) {
      lines.push(`Peak night hours: ${peakHours.slice(0, 5).map((h) => `${String(h.hour || '').padStart(2, '0')}:00 (${formatNumber(h.count || 0)})`).join(', ')}`);
    }
    return {
      shortAnswer: lines.join('\n'),
      evidence: peakHours.length > 0 ? [{
        type: 'table',
        columns: [{ key: 'hour', label: 'Hour' }, { key: 'count', label: 'Records' }],
        previewRows: takePreview(peakHours).map((h) => ({ hour: `${String(h.hour || '').padStart(2, '0')}:00`, count: formatNumber(h.count || 0) })),
        totalCount: peakHours.length
      }] : []
    };
  }

  if (key === 'home_and_work') {
    const obj = normalizeObject(value) || {};
    const topHome = normalizeArray(obj.topHome || []);
    const topWork = normalizeArray(obj.topWork || []);
    const homeStr = topHome.length > 0 ? topHome.slice(0, 3).map((r) => `${r.cell_id || r.label || 'Unknown'} (${formatNumber(r.count || 0)})`).join(', ') : 'No data';
    const workStr = topWork.length > 0 ? topWork.slice(0, 3).map((r) => `${r.cell_id || r.label || 'Unknown'} (${formatNumber(r.count || 0)})`).join(', ') : 'No data';
    return {
      shortAnswer: `Home Location (night 22-06): ${homeStr}\nWork Location (day 09-18): ${workStr}`,
      evidence: [{
        type: 'table',
        columns: [{ key: 'type', label: 'Type' }, { key: 'cell_id', label: 'Cell ID' }, { key: 'count', label: 'Records' }],
        previewRows: [
          ...topHome.slice(0, 3).map((r) => ({ type: 'Home', cell_id: r.cell_id || r.label || 'Unknown', count: formatNumber(r.count || 0) })),
          ...topWork.slice(0, 3).map((r) => ({ type: 'Work', cell_id: r.cell_id || r.label || 'Unknown', count: formatNumber(r.count || 0) }))
        ],
        totalCount: topHome.length + topWork.length
      }]
    };
  }

  if (key === 'location_summary') {
    const obj = normalizeObject(value) || {};
    const topCellIds = normalizeArray(obj.top_cell_ids || []);
    if (topCellIds.length === 0) return null;
    return {
      shortAnswer: `Location Summary: ${formatNumber(topCellIds.length)} top cell ID(s) found.`,
      evidence: [{
        type: 'table',
        columns: [{ key: 'label', label: 'Cell ID' }, { key: 'count', label: 'Events' }],
        previewRows: takePreview(topCellIds).map((r) => ({ label: r.label || r.cell_id || 'Unknown', count: formatNumber(r.count || 0) })),
        totalCount: topCellIds.length
      }]
    };
  }

  // common_numbers, common_imei_numbers, common_imsi_numbers, common_locations, common_msisdn
  if (key.startsWith('common_')) {
    const obj = normalizeObject(value) || {};
    const hasMultipleFiles = Boolean(obj.hasMultipleFiles);
    const commonItems = normalizeArray(obj.common || []);
    if (!hasMultipleFiles) {
      return { shortAnswer: `${entry.displayLabel}: Requires multiple files for cross-file comparison.`, evidence: [] };
    }
    if (commonItems.length === 0) {
      return { shortAnswer: `${entry.displayLabel}: No common values found across files.`, evidence: [] };
    }
    return {
      shortAnswer: `${entry.displayLabel}: ${formatNumber(commonItems.length)} common value(s) found across files.`,
      evidence: [buildListEvidence(commonItems.map((item, idx) => `${idx + 1}. ${String(item)}`))
      ]
    };
  }

  return null;
};

const buildTableEvidence = (entry, rows = [], previewLimit = PREVIEW_LIMIT) => {
  const columns = normalizeArray(entry?.evidenceColumns || []);
  const mapRow = (row) => {
    const objectRow = normalizeObject(row) || {};
    const nextRow = {};
    for (const column of columns) {
      nextRow[column.key] = formatCellValue(objectRow[column.key], column.format || null);
    }
    return nextRow;
  };

  return {
    type: 'table',
    columns: columns.map((column) => ({ key: column.key, label: column.label })),
    previewRows: takePreview(rows, previewLimit).map(mapRow),
    rows: normalizeArray(rows).slice(0, EVIDENCE_LIMIT).map(mapRow),
    totalCount: normalizeArray(rows).length
  };
};

const buildListEvidence = (rows = [], previewLimit = PREVIEW_LIMIT) => {
  const items = normalizeArray(rows).map((row, index) => {
    if (typeof row === 'string' || typeof row === 'number') return `${index + 1}. ${row}`;
    const objectRow = normalizeObject(row) || {};
    const label = objectRow.label || objectRow.name || objectRow.phone || objectRow.number || `Item ${index + 1}`;
    const count = objectRow.count != null ? ` (${formatNumber(objectRow.count)})` : '';
    return `${index + 1}. ${label}${count}`;
  });

  return {
    type: 'list',
    items: takePreview(items, previewLimit),
    totalCount: items.length
  };
};

const buildRecordEvidence = (preview = [], columns = [], previewLimit = PREVIEW_LIMIT) => {
  const normalizedColumns = normalizeArray(columns);
  const previewRows = takePreview(preview, previewLimit).map((row) => {
    const objectRow = normalizeObject(row) || {};
    return Object.fromEntries(normalizedColumns.map((key) => [key, formatCellValue(objectRow[key])]));
  });

  return {
    type: 'records',
    columns: normalizedColumns.map((key) => ({ key, label: key.replaceAll('_', ' ') })),
    previewRows,
    rows: normalizeArray(preview).slice(0, EVIDENCE_LIMIT).map((row) => {
      const objectRow = normalizeObject(row) || {};
      return Object.fromEntries(normalizedColumns.map((key) => [key, formatCellValue(objectRow[key])]));
    }),
    totalCount: normalizeArray(preview).length
  };
};

const markdownFromPayload = (payload) => {
  if (!payload) return '';

  const scopeChips = [];
  if (payload.scope?.caseLabel) scopeChips.push(`Case: ${payload.scope.caseLabel}`);
  if (payload.scope?.moduleLabel) scopeChips.push(`Scope: ${payload.scope.moduleLabel}${payload.scope.view ? ` ${payload.scope.view}` : ''}`);
  if (payload.sources?.[0]?.sourceType) scopeChips.push(`Source: ${payload.sources[0].sourceType.replace(/_/g, ' ')}`);

  const lines = [
    `**${payload.title || 'Grounded Answer'}**`,
    scopeChips.length > 0 ? `[${scopeChips.join('] [')}]` : null,
    payload.subtitle || null,
    payload.scope?.broadenedFromWorkspace ? '⬆ Auto-broadened from current view to entire case.' : null,
    payload.shortAnswer || null
  ].filter(Boolean);

  for (const block of normalizeArray(payload.evidence || [])) {
    if (block.type === 'list') {
      lines.push('', 'Preview', ...(block.items || []).map((item) => `- ${item.replace(/^\d+\.\s*/, '')}`));
      continue;
    }

    if (block.type === 'table' || block.type === 'records') {
      const columns = normalizeArray(block.columns || []);
      const previewRows = normalizeArray(block.previewRows || []);
      if (columns.length > 0 && previewRows.length > 0) {
        lines.push('', 'Preview');
        for (const row of previewRows) {
          lines.push(`- ${columns.map((column) => `${column.label}: ${row[column.key] ?? '-'}`).join(' | ')}`);
        }
      }
    }
  }

  if (payload.emptyState && normalizeArray(payload.evidence || []).length === 0) {
    lines.push('', payload.emptyState);
  }

  return lines.join('\n');
};

export const buildMetricAnswerPayload = ({
  metricKey,
  summary = null,
  caseId,
  caseLabel,
  module = null,
  view = null,
  workspaceContext = null,
  scopeMode = 'case-wide',
  scopeOrigin = 'locked_session_case',
  broadenedFromWorkspace = false,
  sourceType = 'memory',
  previewLimit = PREVIEW_LIMIT
}) => {
  const entry = getCaseQaCatalogEntry(metricKey);
  if (!entry) return null;

  const value = getFactValue(summary, entry);
  const scope = buildScopeDescriptor({
    caseId,
    caseLabel,
    module,
    view,
    workspaceContext,
    scopeMode,
    scopeOrigin,
    broadenedFromWorkspace
  });

  const payload = {
    version: 'grounded-answer-v1',
    kind: entry.answerType,
    title: entry.displayLabel,
    subtitle: scope.moduleLabel && scope.view ? `${scope.moduleLabel} • ${scope.view}` : scope.moduleLabel || scope.view || null,
    shortAnswer: null,
    scope,
    sources: buildSourceList({
      summary,
      tables: summary?.sources?.tables || [],
      sourceType,
      fileIds: scope.selectedFileIds
    }),
    evidence: [],
    actions: [],
    followUps: normalizeArray(entry.followUpExamples || []),
    emptyState: entry.emptyState || 'No grounded data found for the current scope.',
    debugMeta: {
      metricKey,
      renderKind: entry.answerType,
      entityRefs: [],
      queryKind: entry.queryMode || 'metric',
      supportsBroaden: scope.scopeMode === 'workspace' && !scope.broadenedFromWorkspace,
      supportsModuleSwitch: true,
      supportsEvidence: false,
      defaultLimit: previewLimit,
      tables: summary?.sources?.tables || [],
      evidenceColumns: normalizeArray(entry?.evidenceColumns || []).map((column) => column.key)
    }
  };

  if (!hasMeaningfulValue(value)) {
    payload.kind = 'abstain';
    payload.shortAnswer = `I could not find a grounded value for ${entry.displayLabel} in the current scope.`;
    payload.actions = [
      { id: 'copy-answer', label: 'Copy answer', kind: 'copy' }
    ];
    payload.markdown = markdownFromPayload(payload);
    return sanitizePayload(payload);
  }

  if (entry.answerType === 'scalar') {
    payload.shortAnswer = buildScalarShortAnswer(entry, value);
  } else if (entry.answerType === 'summary') {
    // Check if value is a sub-object with a specialized renderer before falling back to markdown
    const subObjectResult = (value && typeof value === 'object' && !Array.isArray(value))
      ? buildSubObjectAnswer(entry, value)
      : null;
    if (subObjectResult) {
      payload.shortAnswer = subObjectResult.shortAnswer;
      payload.evidence = subObjectResult.evidence || [];
    } else {
      payload.shortAnswer = summary?.markdown || entry.emptyState;
    }
  } else if (entry.answerType === 'timeseries') {
    const rows = normalizeArray(value);
    payload.shortAnswer = `${entry.displayLabel}: ${formatNumber(rows.length)} data point(s) found.`;
    payload.evidence = [buildTableEvidence(entry, rows, previewLimit)];
  } else if (entry.answerType === 'list' || entry.answerType === 'table') {
    // Check if value is a sub-object (not a plain array) — route to specialized renderer
    const subObjectResult = (!Array.isArray(value) && typeof value === 'object' && value !== null)
      ? buildSubObjectAnswer(entry, value)
      : null;
    if (subObjectResult) {
      payload.shortAnswer = subObjectResult.shortAnswer;
      payload.evidence = subObjectResult.evidence || [];
    } else {
      const rows = normalizeArray(value);
      payload.shortAnswer = `${entry.displayLabel}: ${formatNumber(rows.length)} result(s) found.`;
      payload.evidence = [
        (entry.evidenceColumns || []).length > 0 ? buildTableEvidence(entry, rows, previewLimit) : buildListEvidence(rows, previewLimit)
      ];
    }
  } else {
    // Catch-all: check for sub-object patterns before falling back to scalar
    const subObjectResult = (value && typeof value === 'object' && !Array.isArray(value))
      ? buildSubObjectAnswer(entry, value)
      : null;
    if (subObjectResult) {
      payload.shortAnswer = subObjectResult.shortAnswer;
      payload.evidence = subObjectResult.evidence || [];
    } else {
      payload.shortAnswer = buildScalarShortAnswer(entry, value);
    }
  }

  payload.actions = [
    ...(payload.evidence.length > 0 ? [{ id: 'show-evidence', label: 'Show evidence', kind: 'toggle_evidence' }] : []),
    ...(scope.scopeMode === 'workspace' && !scope.broadenedFromWorkspace
      ? [{ id: 'broaden-case', label: 'Broaden to entire case', kind: 'prompt', prompt: `${entry.displayLabel} entire case` }]
      : []),
    { id: 'copy-answer', label: 'Copy answer', kind: 'copy' }
  ];
  payload.debugMeta.supportsEvidence = payload.evidence.length > 0;
  payload.markdown = markdownFromPayload(payload);
  return sanitizePayload(payload);
};

export const buildSummaryAnswerPayload = ({
  title,
  summary = null,
  caseId,
  caseLabel,
  module = null,
  view = null,
  workspaceContext = null,
  scopeMode = 'case-wide',
  scopeOrigin = 'locked_session_case',
  broadenedFromWorkspace = false,
  sourceType = 'memory',
  emptyState = 'No verified summary is available for this scope yet.',
  previewLimit = PREVIEW_LIMIT
}) => {
  const scope = buildScopeDescriptor({
    caseId,
    caseLabel,
    module,
    view,
    workspaceContext,
    scopeMode,
    scopeOrigin,
    broadenedFromWorkspace
  });

  const payload = sanitizePayload({
    version: 'grounded-answer-v1',
    kind: 'summary',
    title,
    subtitle: scope.moduleLabel && scope.view ? `${scope.moduleLabel} • ${scope.view}` : scope.moduleLabel || scope.view || null,
    shortAnswer: summary?.markdown || emptyState,
    scope,
    sources: buildSourceList({
      summary,
      tables: summary?.sources?.tables || [],
      sourceType,
      fileIds: scope.selectedFileIds
    }),
    evidence: [],
    actions: [{ id: 'copy-answer', label: 'Copy answer', kind: 'copy' }],
    followUps: [],
    emptyState,
    debugMeta: {
      renderKind: 'summary',
      entityRefs: [],
      queryKind: 'summary',
      supportsBroaden: scope.scopeMode === 'workspace' && !scope.broadenedFromWorkspace,
      supportsModuleSwitch: Boolean(module),
      supportsEvidence: false,
      defaultLimit: previewLimit,
      tables: summary?.sources?.tables || [],
      evidenceColumns: []
    }
  });

  payload.markdown = markdownFromPayload(payload);
  return payload;
};

export const buildFilesAnswerPayload = ({
  files = [],
  caseId,
  caseLabel,
  module = null,
  view = null,
  workspaceContext = null,
  sourceType = 'memory'
}) => {
  const scope = buildScopeDescriptor({
    caseId,
    caseLabel,
    module,
    view,
    workspaceContext,
    scopeMode: 'case-wide',
    scopeOrigin: workspaceContext?.caseId ? 'workspace_context' : 'locked_session_case'
  });

  const mapFile = (file) => ({
    name: formatCellValue(file.originalName || file.fileName || file.name || `File ${file.id}`),
    module: formatCellValue(file.detectedType || file.fileType || file.module),
    parseStatus: formatCellValue(file.parseStatus),
    recordCount: formatCellValue(file.recordCount || 0, 'number')
  });

  const payload = sanitizePayload({
    version: 'grounded-answer-v1',
    kind: 'table',
    title: 'Uploaded Files',
    subtitle: 'Case file manifest',
    shortAnswer: `Uploaded Files: ${formatNumber(normalizeArray(files).length)}`,
    scope,
    sources: buildSourceList({
      tables: ['uploaded_files', 'file_classifications'],
      sourceType,
      fileIds: scope.selectedFileIds
    }),
    evidence: [
      {
        type: 'table',
        columns: [
          { key: 'name', label: 'File' },
          { key: 'module', label: 'Module' },
          { key: 'parseStatus', label: 'Parse Status' },
          { key: 'recordCount', label: 'Records' }
        ],
        previewRows: takePreview(files).map(mapFile),
        rows: normalizeArray(files).slice(0, EVIDENCE_LIMIT).map(mapFile),
        totalCount: normalizeArray(files).length
      }
    ],
    actions: [
      { id: 'show-evidence', label: 'Show evidence', kind: 'toggle_evidence' },
      { id: 'copy-answer', label: 'Copy answer', kind: 'copy' }
    ],
    followUps: ['Show files for this module', 'Which file has the most records?'],
    emptyState: 'No uploaded files were found for this case.',
    debugMeta: {
      renderKind: 'table',
      metricKey: 'uploaded_files',
      entityRefs: [],
      queryKind: 'files',
      supportsBroaden: false,
      supportsModuleSwitch: Boolean(module),
      supportsEvidence: true,
      defaultLimit: PREVIEW_LIMIT,
      tables: ['uploaded_files', 'file_classifications'],
      evidenceColumns: ['name', 'module', 'parseStatus', 'recordCount']
    }
  });

  payload.markdown = markdownFromPayload(payload);
  return payload;
};

export const buildRecordAnswerPayload = ({
  title,
  recordSummary = null,
  caseId,
  caseLabel,
  module = null,
  view = 'records',
  workspaceContext = null,
  scopeMode = 'workspace',
  scopeOrigin = 'workspace_context',
  broadenedFromWorkspace = false,
  sourceType = 'live_records',
  previewLimit = PREVIEW_LIMIT
}) => {
  const scope = buildScopeDescriptor({
    caseId,
    caseLabel,
    module,
    view,
    workspaceContext,
    scopeMode,
    scopeOrigin,
    broadenedFromWorkspace
  });

  const previewRows = normalizeArray(recordSummary?.artifacts?.preview || []);
  const columns = previewRows.length > 0
    ? Object.keys(normalizeObject(previewRows[0]) || {})
    : [];

  const payload = sanitizePayload({
    version: 'grounded-answer-v1',
    kind: previewRows.length > 0 ? 'record_preview' : 'abstain',
    title,
    subtitle: scope.moduleLabel && scope.view ? `${scope.moduleLabel} • ${scope.view}` : scope.moduleLabel || scope.view || null,
    shortAnswer: previewRows.length > 0
      ? `${formatNumber(previewRows.length)} preview row(s) matched the current search.`
      : 'I could not find grounded records for the current search in this scope.',
    scope,
    sources: buildSourceList({
      summary: recordSummary,
      tables: recordSummary?.sources?.tables || [],
      sourceType,
      fileIds: scope.selectedFileIds
    }),
    evidence: previewRows.length > 0 ? [buildRecordEvidence(previewRows, columns)] : [],
    actions: [
      ...(previewRows.length > 0 ? [{ id: 'show-evidence', label: 'Show evidence', kind: 'toggle_evidence' }] : []),
      ...(scope.scopeMode === 'workspace' && !scope.broadenedFromWorkspace
        ? [{ id: 'broaden-case', label: 'Broaden to entire case', kind: 'prompt', prompt: 'Broaden record search to entire case' }]
        : []),
      ...(module ? [{ id: 'open-records-view', label: 'Open related view', kind: 'open_records', href: `/${module}/records` }] : []),
      { id: 'copy-answer', label: 'Copy answer', kind: 'copy' }
    ],
    followUps: ['Show more', 'From which file?', 'Open records'],
    emptyState: 'No verified rows matched the current search.',
    debugMeta: {
      renderKind: previewRows.length > 0 ? 'record_preview' : 'abstain',
      entityRefs: recordSummary?.artifacts?.query ? [String(recordSummary.artifacts.query)] : [],
      queryKind: 'record_query',
      supportsBroaden: scope.scopeMode === 'workspace' && !scope.broadenedFromWorkspace,
      supportsModuleSwitch: Boolean(module),
      supportsEvidence: previewRows.length > 0,
      defaultLimit: Number(recordSummary?.artifacts?.limit || previewLimit || PREVIEW_LIMIT),
      tables: recordSummary?.sources?.tables || [],
      evidenceColumns: columns
    }
  });
  if (payload.evidence[0]) {
    payload.evidence[0] = buildRecordEvidence(previewRows, columns, previewLimit);
  }

  payload.markdown = markdownFromPayload(payload);
  return payload;
};

export const buildClarificationAnswerPayload = ({
  title = 'Clarify Scope',
  shortAnswer = 'I can answer this from more than one grounded scope.',
  options = [],
  caseId,
  caseLabel,
  workspaceContext = null
}) => {
  const payload = sanitizePayload({
    version: 'grounded-answer-v1',
    kind: 'clarification',
    title,
    subtitle: null,
    shortAnswer,
    scope: buildScopeDescriptor({
      caseId,
      caseLabel,
      workspaceContext,
      scopeMode: 'case-wide',
      scopeOrigin: 'locked_session_case'
    }),
    sources: [],
    evidence: [],
    actions: [],
    followUps: [],
    emptyState: null,
    clarificationOptions: normalizeArray(options),
    debugMeta: {
      renderKind: 'clarification',
      entityRefs: [],
      queryKind: 'clarification',
      supportsBroaden: false,
      supportsModuleSwitch: false,
      supportsEvidence: false,
      defaultLimit: PREVIEW_LIMIT,
      tables: [],
      evidenceColumns: []
    }
  });

  payload.markdown = markdownFromPayload(payload);
  return payload;
};

export const getMetricAnswerValue = getFactValue;
