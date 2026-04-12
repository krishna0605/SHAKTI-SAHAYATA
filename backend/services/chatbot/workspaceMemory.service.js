import { fetchCaseKnowledge } from './caseContext.service.js';
import { getAnalysisProvider, shouldRunRecordQuery } from './analysisRegistry.service.js';
import { resolveMetricDefinition } from './metricRegistry.service.js';
import {
  buildClarificationAnswerPayload,
  buildFilesAnswerPayload,
  buildMetricAnswerPayload,
  buildRecordAnswerPayload,
  buildSummaryAnswerPayload
} from './groundedAnswer.service.js';
import {
  CASE_QA_MODULE_LABELS,
  CASE_QA_MODULE_ALIASES,
  CASE_QA_VIEW_ALIASES,
  findCaseQaCatalogEntries,
  getCaseQaCatalogEntry,
  getMetricLabel,
  buildMetricLabelMap
} from '../../../shared/chatbot/caseQaCatalog.js';

const MODULE_ALIASES = CASE_QA_MODULE_ALIASES;

const VIEW_ALIASES = CASE_QA_VIEW_ALIASES;

const MODULE_LABELS = CASE_QA_MODULE_LABELS;

const MODULE_TABLES = {
  cdr: ['cdr_records'],
  ipdr: ['ipdr_records'],
  sdr: ['sdr_records'],
  tower: ['tower_dump_records'],
  ild: ['ild_records']
};

const normalizeNumberArray = (values) => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => Number.parseInt(String(value), 10))
    .filter((value) => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);
};

const normalizeTextArray = (values) => {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
};

const normalizeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);

const normalizeModule = (value) => {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  return MODULE_ALIASES[key] || null;
};

const normalizeView = (value) => {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_');
  return VIEW_ALIASES[key] || null;
};

const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');
const formatDuration = (seconds) => `${Math.round(Number(seconds || 0))}s`;

const formatLabelValueList = (title, rows = [], formatter = null) => {
  if (!Array.isArray(rows) || rows.length === 0) return `${title}: No data available for the current scope.`;
  return [
    `${title}:`,
    ...rows.map((row, index) => {
      if (typeof formatter === 'function') return `- ${index + 1}. ${formatter(row)}`;
      const label = row.label || row.name || row.phone || row.cellId || row.msisdn || row.ip || `Item ${index + 1}`;
      const count = row.count != null ? ` (${formatNumber(row.count)})` : '';
      return `- ${index + 1}. ${label}${count}`;
    })
  ].join('\n');
};

const stripPromptContext = (message = '') => {
  const text = String(message || '').trim();
  const match = text.match(/(?:^|\n)User:\s*([\s\S]+)$/i);
  return (match?.[1] || text).trim();
};

const detectMessageModule = (message = '') => {
  const text = stripPromptContext(message).toLowerCase();
  if (/\bcdr\b|\bcall detail\b|\ba-?part(?:y|ies)\b|\bb-?part(?:y|ies)\b/.test(text)) return 'cdr';
  if (/\bipdr\b|\binternet\b|\bsource ip\b|\bdestination ip\b|\bmsisdn\b/.test(text)) return 'ipdr';
  if (/\bsdr\b|\bsubscriber\b|\bactivation\b|\bemail\b/.test(text)) return 'sdr';
  if (/\btower\b|\bcell\b|\bnetwork graph\b|\bparty graph\b/.test(text)) return 'tower';
  if (/\bild\b|\binternational\b|\bcountry\b/.test(text)) return 'ild';
  return null;
};

const detectMessageView = (message = '') => {
  const text = stripPromptContext(message).toLowerCase();
  if (/\badvanced analysis\b|\badvanced\b|\bfindings?\b|\bkey insights?\b/.test(text)) return 'advanced';
  if (/\boverview\b|\bhighlights?\b|\bsummary\b/.test(text)) return 'overview';
  if (/\brecords?\b|\bsearch\b|\bfind\b/.test(text)) return 'records';
  if (/\broaming\b/.test(text)) return 'roaming';
  if (/\blocation\b/.test(text)) return 'location';
  if (/\bmap\b/.test(text)) return 'map';
  if (/\bcharts?\b/.test(text)) return 'charts';
  if (/\bparty graph\b/.test(text)) return 'party-graph';
  if (/\bnetwork graph\b|\bgraph\b/.test(text)) return 'network-graph';
  return null;
};

const buildWorkspaceScopeLine = ({
  caseLabel,
  module,
  view,
  selectedFileNames = [],
  filters = null,
  searchState = null,
  mapState = null,
  graphState = null
}) => {
  const lines = [
    `Case: ${caseLabel}`,
    module ? `Module: ${MODULE_LABELS[module] || module.toUpperCase()}` : null,
    view ? `View: ${view}` : null
  ];

  if (selectedFileNames.length > 0) {
    lines.push(`Selected Files: ${selectedFileNames.join(', ')}`);
  }

  if (filters && Object.keys(filters).length > 0) {
    const activeFilters = Object.entries(filters)
      .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
      .map(([key, value]) => `${key}=${value}`);
    if (activeFilters.length > 0) lines.push(`Filters: ${activeFilters.join(', ')}`);
  }

  if (searchState?.query) {
    lines.push(`Current Search: ${searchState.query}`);
    if (Number.isFinite(searchState.resultCount)) lines.push(`Current Search Results: ${formatNumber(searchState.resultCount)}`);
  }

  if (mapState?.selectedTower) lines.push(`Selected Tower: ${mapState.selectedTower}`);
  if (graphState?.selectedNode) lines.push(`Selected Node: ${graphState.selectedNode}`);
  if (graphState?.selectedParty) lines.push(`Selected Party: ${graphState.selectedParty}`);

  return lines.filter(Boolean).join('\n');
};

const extractMetricKey = (message = '', module = null) => {
  const text = stripPromptContext(message).toLowerCase();
  if (!text) return null;

  const metricDefinition = resolveMetricDefinition({ message: text, module });
  if (metricDefinition?.key) return metricDefinition.key;

  if (module === 'sdr' && /\b(search results?|subscriber details?|subscriber info)\b/.test(text)) return 'sdr_search_results';
  if (/\badvanced analysis\b|\badvanced\b|\bkey findings?\b|\bwhat.*analysis\b/.test(text)) return 'advanced_summary';
  if (/\boverview\b|\bhighlights?\b|\bsummary\b|\bwhat does this.*show\b|\bwhat are the.*analysis\b/.test(text)) return 'module_summary';

  return null;
};

const normalizeFilters = (filters = null) => {
  const value = normalizeObject(filters);
  if (!value) return null;
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined && String(entry).trim() !== '')
  );
};

const formatMetricValue = (metricKey, value) => {
  if (value == null) return null;

  if (Array.isArray(value)) {
    if (metricKey === 'callTypeDistribution') {
      return value.length
        ? value.map((row) => `${row.label}: ${formatNumber(row.count)}`).join(', ')
        : 'No call-type distribution available';
    }
    if (metricKey === 'hourlyActivity') {
      return value.length
        ? value.slice(0, 8).map((row) => `${row.hour}:00 (${formatNumber(row.count)})`).join(', ')
        : 'No hourly activity available';
    }
    if (metricKey === 'topBParties') {
      return `\n${formatLabelValueList('Top B-Parties', value, (row) => `${row.label} | Calls: ${formatNumber(row.count)} | Duration: ${formatDuration(row.duration_sec)}`)}`;
    }
    if (metricKey === 'topLocations') {
      return `\n${formatLabelValueList('Top Locations', value, (row) => `${row.label} | Events: ${formatNumber(row.count)} | Duration: ${formatDuration(row.duration_sec)}`)}`;
    }
    if (metricKey === 'top_source_ips') {
      return `\n${formatLabelValueList('Top Source / Destination IPs', value, (row) => `${row.label || row.ip} (${formatNumber(row.count)})`)}`;
    }
    if (metricKey === 'top_msisdn') {
      return `\n${formatLabelValueList('Top MSISDN', value, (row) => `${row.label || row.msisdn} (${formatNumber(row.count)})`)}`;
    }
    if (metricKey === 'topSubscriberNames') {
      return `\n${formatLabelValueList('Top Subscriber Names', value, (row) => `${row.label} (${formatNumber(row.count)})`)}`;
    }
    if (metricKey === 'topPhoneNumbers') {
      return `\n${formatLabelValueList('Top Phone Numbers', value, (row) => `${row.label} (${formatNumber(row.count)})`)}`;
    }
    if (metricKey === 'topCells') {
      return `\n${formatLabelValueList('Top Towers / Cells', value, (row) => `${row.label} (${formatNumber(row.count)})`)}`;
    }
    if (metricKey === 'topParties') {
      return `\n${formatLabelValueList('Top Parties', value, (row) => `${row.label} (${formatNumber(row.count)})`)}`;
    }
    if (metricKey === 'topCalledParties') {
      return `\n${formatLabelValueList('Top Called Parties', value, (row) => `${row.label} (${formatNumber(row.count)})`)}`;
    }
    if (metricKey === 'topCountries') {
      return `\n${formatLabelValueList('Top Countries', value, (row) => `${row.label} (${formatNumber(row.count)})`)}`;
    }
    if (metricKey === 'daily_first_last_call') {
      return value.length
        ? `\n${formatLabelValueList('Daily First/Last Call', value, (row) => `${row.label || 'Unknown date'} | First: ${row.first_call_time || '-'} | Last: ${row.last_call_time || '-'}`)}`
        : 'No daily first/last call data available';
    }
    if (metricKey === 'international_calls') {
      return `\n${formatLabelValueList('International Calls', value, (row) => `${row.label || row.called_number || row.number || 'Unknown'} (${formatNumber(row.count || 0)})`)}`;
    }
    if (metricKey === 'regular_callers') {
      return `\n${formatLabelValueList('Regular Callers', value, (row) => `${row.phone || row.label || 'Unknown'} | Calls: ${formatNumber(row.count || 0)} | Days: ${formatNumber(row.days_active || 0)}`)}`;
    }
  }

  // Sub-object metrics — extract meaningful values instead of falling through to String()
  if (typeof value === 'object' && !Array.isArray(value) && value !== null) {
    if (metricKey === 'sms_analysis') {
      return `SMS: Total ${formatNumber(value.total || 0)}, Sent ${formatNumber(value.sent || 0)}, Received ${formatNumber(value.received || 0)}`;
    }
    if (metricKey === 'night_activity') {
      const totalRecords = Number(value.total_records || 0);
      const peakHours = Array.isArray(value.peak_hours) ? value.peak_hours : [];
      const peakStr = peakHours.length > 0
        ? peakHours.slice(0, 5).map((h) => `${String(h.hour || '').padStart(2, '0')}:00 (${formatNumber(h.count || 0)})`).join(', ')
        : 'N/A';
      return `Night Activity: ${formatNumber(totalRecords)} records | Peak hours: ${peakStr}`;
    }
    if (metricKey === 'home_and_work') {
      const topHome = Array.isArray(value.topHome) ? value.topHome : [];
      const topWork = Array.isArray(value.topWork) ? value.topWork : [];
      const homeStr = topHome.length > 0
        ? topHome.slice(0, 3).map((r) => `${r.cell_id || r.label || 'Unknown'} (${formatNumber(r.count || 0)})`).join(', ')
        : 'No data';
      const workStr = topWork.length > 0
        ? topWork.slice(0, 3).map((r) => `${r.cell_id || r.label || 'Unknown'} (${formatNumber(r.count || 0)})`).join(', ')
        : 'No data';
      return `Home (night 22-06): ${homeStr}\nWork (day 09-18): ${workStr}`;
    }
    if (metricKey === 'location_summary') {
      const topCellIds = Array.isArray(value.top_cell_ids) ? value.top_cell_ids : [];
      return topCellIds.length > 0
        ? `\n${formatLabelValueList('Top Cell IDs', topCellIds)}`
        : 'No location summary available';
    }
    // common_* metrics: { hasMultipleFiles, common, fileIds }
    if (metricKey.startsWith('common_')) {
      const hasMultipleFiles = Boolean(value.hasMultipleFiles);
      const common = Array.isArray(value.common) ? value.common : [];
      if (!hasMultipleFiles) return 'Requires multiple files for cross-file comparison';
      if (common.length === 0) return 'No common values found across files';
      return common.join(', ');
    }
    // Fallback: avoid [object Object] — serialize cleanly
    try { return JSON.stringify(value); } catch { return 'Complex data (see evidence)'; }
  }

  if (metricKey === 'avg_duration_sec') return formatDuration(value);
  if (typeof value === 'number') return formatNumber(value);
  return String(value);
};

const metricLabels = buildMetricLabelMap();

export const normalizeWorkspaceContext = (raw = null) => {
  const input = normalizeObject(raw);
  if (!input) return null;

  const caseId = Number.parseInt(String(input.caseId || ''), 10);
  const module = normalizeModule(input.module);
  const view = normalizeView(input.view);
  const subview = normalizeView(input.subview) || (input.subview ? String(input.subview).trim() : null);

  return {
    caseId: Number.isFinite(caseId) && caseId > 0 ? String(caseId) : null,
    caseTag: String(input.caseTag || '').trim() || null,
    module,
    view,
    subview,
    selectedFileIds: normalizeNumberArray(input.selectedFileIds),
    selectedFileKeys: normalizeTextArray(input.selectedFileKeys),
    selectedFileNames: normalizeTextArray(input.selectedFileNames),
    filters: normalizeFilters(input.filters),
    searchState: normalizeObject(input.searchState),
    selectedEntities: normalizeTextArray(input.selectedEntities),
    mapState: normalizeObject(input.mapState),
    graphState: normalizeObject(input.graphState),
    selectionTimestamp: String(input.selectionTimestamp || '').trim() || null
  };
};

export const mergeWorkspaceContext = (sessionState = {}, rawWorkspaceContext = null) => {
  const existing = normalizeWorkspaceContext(sessionState?.workspaceContext || null);
  const incoming = normalizeWorkspaceContext(rawWorkspaceContext);
  if (!existing && !incoming) return null;
  if (!existing) return incoming;
  if (!incoming) return existing;

  return {
    ...existing,
    ...incoming,
    selectedFileIds: incoming.selectedFileIds.length > 0 ? incoming.selectedFileIds : existing.selectedFileIds,
    selectedFileKeys: incoming.selectedFileKeys.length > 0 ? incoming.selectedFileKeys : existing.selectedFileKeys,
    selectedFileNames: incoming.selectedFileNames.length > 0 ? incoming.selectedFileNames : existing.selectedFileNames,
    filters: incoming.filters || existing.filters,
    searchState: incoming.searchState || existing.searchState,
    selectedEntities: incoming.selectedEntities.length > 0 ? incoming.selectedEntities : existing.selectedEntities,
    mapState: incoming.mapState || existing.mapState,
    graphState: incoming.graphState || existing.graphState,
    selectionTimestamp: incoming.selectionTimestamp || existing.selectionTimestamp
  };
};

export const buildWorkspaceContextPrompt = (workspaceContext = null) => {
  const normalized = normalizeWorkspaceContext(workspaceContext);
  if (!normalized) return '';

  const lines = [
    'ACTIVE WORKSPACE MEMORY:',
    normalized.caseId ? `- Active Case ID: ${normalized.caseId}` : null,
    normalized.caseTag ? `- Active Case Tag: ${normalized.caseTag}` : null,
    normalized.module ? `- Active Module: ${MODULE_LABELS[normalized.module] || normalized.module.toUpperCase()}` : null,
    normalized.view ? `- Active View: ${normalized.view}` : null,
    normalized.selectedFileIds.length ? `- Selected File IDs: ${normalized.selectedFileIds.join(', ')}` : null,
    normalized.selectedFileNames.length ? `- Selected File Names: ${normalized.selectedFileNames.join(', ')}` : null,
    normalized.searchState?.query ? `- Current Search Query: ${normalized.searchState.query}` : null,
    normalized.selectedEntities.length ? `- Selected Entities: ${normalized.selectedEntities.join(', ')}` : null
  ];

  if (normalized.filters && Object.keys(normalized.filters).length > 0) {
    lines.push(`- Active Filters: ${Object.entries(normalized.filters).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  }
  if (normalized.mapState?.selectedTower) lines.push(`- Map Selection: tower=${normalized.mapState.selectedTower}`);
  if (normalized.graphState?.selectedNode) lines.push(`- Graph Selection: node=${normalized.graphState.selectedNode}`);
  if (normalized.graphState?.selectedParty) lines.push(`- Party Graph Selection: party=${normalized.graphState.selectedParty}`);

  return lines.filter(Boolean).join('\n');
};

const getFileSelectionNames = (knowledge, selectedFileIds = []) => {
  if (!knowledge?.files?.items || selectedFileIds.length === 0) return [];
  const lookup = new Set(selectedFileIds.map((value) => String(value)));
  return knowledge.files.items
    .filter((file) => lookup.has(String(file.id)))
    .map((file) => file.originalName || file.fileName || `File ${file.id}`);
};

const buildScopeMeta = (knowledge, module, view, workspaceContext) => ({
  caseLabel: knowledge?.case?.caseName || knowledge?.case?.caseNumber || `Case ${knowledge?.case?.id || ''}`.trim(),
  module,
  view: view || (module === 'sdr' ? 'search' : 'overview'),
  selectedFileNames: workspaceContext?.selectedFileNames?.length
    ? workspaceContext.selectedFileNames
    : getFileSelectionNames(knowledge, workspaceContext?.selectedFileIds || []),
  filters: workspaceContext?.filters || null,
  searchState: workspaceContext?.searchState || null,
  mapState: workspaceContext?.mapState || null,
  graphState: workspaceContext?.graphState || null
});

const buildCaseLabel = (knowledge = {}) =>
  knowledge?.case?.caseName || knowledge?.case?.caseNumber || `Case ${knowledge?.case?.id || ''}`.trim();

const hasNarrowWorkspaceScope = (workspaceContext = null) =>
  Boolean(
    (workspaceContext?.selectedFileIds || []).length > 0
    || (workspaceContext?.filters && Object.keys(workspaceContext.filters).length > 0)
    || workspaceContext?.searchState?.query
    || workspaceContext?.mapState?.selectedTower
    || workspaceContext?.graphState?.selectedNode
    || workspaceContext?.graphState?.selectedParty
    || (workspaceContext?.selectedEntities || []).length > 0
  );

const buildCaseWideWorkspaceContext = (workspaceContext = null, module = null, view = null) => ({
  ...(workspaceContext || {}),
  module: module || workspaceContext?.module || null,
  view: view || workspaceContext?.view || null,
  selectedFileIds: [],
  selectedFileKeys: [],
  selectedFileNames: [],
  filters: null,
  searchState: null,
  selectedEntities: [],
  mapState: null,
  graphState: null
});

const hasMeaningfulValue = (value) => {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
};

const getMetricValueFromSummary = (summary = null, metricKey = null) => {
  const metricDefinition = getCaseQaCatalogEntry(metricKey);
  if (!summary?.facts || !metricDefinition) return null;
  for (const factKey of metricDefinition.factKeys || [metricKey]) {
    if (summary.facts[factKey] !== undefined && summary.facts[factKey] !== null) {
      return summary.facts[factKey];
    }
  }
  return null;
};

const buildFilesMarkdown = (knowledge, scopeMeta, workspaceContext) => {
  const items = knowledge?.files?.items || [];
  const selectedIds = workspaceContext?.selectedFileIds || [];
  const selectedSet = new Set(selectedIds.map((value) => String(value)));
  const selectedItems = selectedIds.length > 0
    ? items.filter((file) => selectedSet.has(String(file.id)))
    : items;

  const lines = [
    '**Case File Manifest**',
    buildWorkspaceScopeLine(scopeMeta),
    '',
    `Uploaded Files: ${formatNumber(items.length)}`,
    selectedIds.length > 0 ? `Current Selection: ${formatNumber(selectedItems.length)} file(s)` : null,
    '',
    ...(selectedItems.length > 0
      ? selectedItems.map((file, index) => `${index + 1}. ${file.originalName} | Type: ${file.detectedType || file.fileType || 'unknown'} | Parse: ${file.parseStatus || 'unknown'} | Records: ${formatNumber(file.recordCount || 0)}`)
      : ['No uploaded files were found for this case scope.'])
  ];

  return lines.filter(Boolean).join('\n');
};

const buildFactMarkdown = ({ scopeMeta, metricLabel, metricValue }) => {
  const contextLine = [
    scopeMeta?.caseLabel ? `Case: ${scopeMeta.caseLabel}` : null,
    scopeMeta?.module ? `Module: ${MODULE_LABELS[scopeMeta.module] || scopeMeta.module.toUpperCase()}` : null
  ].filter(Boolean).join(' | ');

  return [
    contextLine,
    `${metricLabel}: ${metricValue}`
  ].filter(Boolean).join('\n');
};

const buildSummaryMarkdown = ({ scopeMeta, summary, title = 'Scoped Analysis Summary' }) => {
  const lines = [
    `**${title}**`,
    buildWorkspaceScopeLine(scopeMeta),
    ''
  ];

  if (summary?.markdown) {
    lines.push(summary.markdown);
  } else {
    lines.push('No verified summary is available for this scope yet.');
  }

  return lines.join('\n');
};

const buildCurrentViewMarkdown = ({ scopeMeta, summary }) => {
  const viewLabel = scopeMeta.view ? `${scopeMeta.view} view` : 'current view';
  const lines = [
    '**Current Workspace View**',
    buildWorkspaceScopeLine(scopeMeta),
    '',
    `You are on the ${viewLabel} for ${MODULE_LABELS[scopeMeta.module] || scopeMeta.module?.toUpperCase() || 'the selected module'}.`
  ];

  if (summary?.markdown) lines.push('', summary.markdown);
  return lines.join('\n');
};

const buildAbstainMarkdown = ({ scopeMeta, metricKey }) => [
  '**Grounded Answer Unavailable**',
  buildWorkspaceScopeLine(scopeMeta),
  '',
  metricKey
    ? `I checked the current ${MODULE_LABELS[scopeMeta.module] || scopeMeta.module || 'case'} scope, but I could not find a grounded value for ${metricLabels[metricKey] || metricKey}.`
    : 'I checked the current case scope, but I could not find a grounded answer for that request.',
  'Try asking for a different metric, changing the current selection, or moving to the relevant records/search view.'
].join('\n');

const resolveScopedSummary = async ({ caseId, module, view, normalizedWorkspace, user }) => {
  const provider = getAnalysisProvider(module);
  if (!provider) return null;

  const selectedFileIds = normalizedWorkspace?.selectedFileIds || [];
  const hasSelectionScope = selectedFileIds.length > 1
    || (normalizedWorkspace?.filters && Object.keys(normalizedWorkspace.filters).length > 0)
    || Boolean(normalizedWorkspace?.searchState?.query)
    || Boolean(normalizedWorkspace?.mapState?.selectedTower)
    || Boolean(normalizedWorkspace?.graphState?.selectedNode)
    || Boolean(normalizedWorkspace?.graphState?.selectedParty)
    || (view && view !== 'overview' && !(module === 'sdr' && view === 'search'));

  if (selectedFileIds.length === 1 && !hasSelectionScope) {
    return provider.buildFileSummary(caseId, selectedFileIds[0], { view });
  }

  if (hasSelectionScope) {
    return provider.buildViewBundle({
      caseId,
      view,
      workspaceContext: normalizedWorkspace,
      user
    });
  }

  return provider.buildCaseSummary(caseId, { user, view });
};

export const lookupWorkspaceAnswer = async ({
  message,
  resolvedContext = {},
  workspaceContext = null,
  user = null,
  queryOptions = {}
}) => {
  const normalizedWorkspace = normalizeWorkspaceContext(workspaceContext);
  if (!resolvedContext?.caseId && !normalizedWorkspace?.caseId) return null;

  const caseId = resolvedContext?.caseId || normalizedWorkspace?.caseId;
  const detectedModule = normalizedWorkspace?.module || detectMessageModule(message) || resolvedContext?.module || null;
  const view = normalizedWorkspace?.view || detectMessageView(message) || null;
  const metricKey = extractMetricKey(message, detectedModule);
  const matchedCatalogEntries = findCaseQaCatalogEntries({ message, module: detectedModule, view });
  const knowledge = await fetchCaseKnowledge(caseId, { user });
  if (!knowledge) return null;

  const caseLabel = buildCaseLabel(knowledge);
  const previewLimit = Number.isFinite(Number(queryOptions?.limit))
    ? Math.max(1, Math.min(50, Number(queryOptions.limit)))
    : undefined;
  const currentScopeMode = normalizedWorkspace?.module
    ? (hasNarrowWorkspaceScope(normalizedWorkspace) ? 'workspace' : 'module-casewide')
    : 'case-wide';
  const scopeMeta = buildScopeMeta(knowledge, detectedModule, view, normalizedWorkspace);
  const scopeOrigin = normalizedWorkspace?.caseId ? 'workspace_context' : 'locked_session_case';

  if (!detectedModule && matchedCatalogEntries.length > 0) {
    const candidateModules = [...new Set((matchedCatalogEntries[0]?.modules || []).filter(Boolean))];
    if (candidateModules.length > 1) {
      const answerPayload = buildClarificationAnswerPayload({
        title: 'Clarify Scope',
        shortAnswer: 'I can answer this from more than one grounded module. Choose the scope you want.',
        options: candidateModules.map((moduleKey, index) => ({
          id: moduleKey,
          label: `${MODULE_LABELS[moduleKey] || moduleKey.toUpperCase()} module${index === 0 ? ' (Recommended)' : ''}`,
          description: `Answer this from ${MODULE_LABELS[moduleKey] || moduleKey.toUpperCase()} for the tagged case.`,
          prompt: `${MODULE_LABELS[moduleKey] || moduleKey.toUpperCase()} ${matchedCatalogEntries[0].displayLabel}`
        })),
        caseId,
        caseLabel,
        workspaceContext: normalizedWorkspace
      });

      return {
        route: 'workspace_clarification',
        mode: 'db_summary',
        tables: [],
        confidenceInput: { mode: 'db_summary', intentScore: 0.84, intentLabel: 'workspace_clarification' },
        markdown: answerPayload.markdown,
        answerPayload
      };
    }
  }

  if (metricKey === 'uploaded_files') {
    const answerPayload = buildFilesAnswerPayload({
      files: knowledge?.files?.items || [],
      caseId,
      caseLabel,
      module: detectedModule,
      view,
      workspaceContext: normalizedWorkspace,
      sourceType: 'memory'
    });

    return {
      route: 'workspace_files',
      mode: 'db_summary',
      tables: ['cases', 'uploaded_files', 'file_classifications'],
      confidenceInput: { mode: 'db_summary', intentScore: 0.96, intentLabel: 'workspace_files' },
      markdown: answerPayload.markdown || buildFilesMarkdown(knowledge, scopeMeta, normalizedWorkspace),
      answerPayload
    };
  }

  if (!detectedModule) return null;
  const provider = getAnalysisProvider(detectedModule);
  if (!provider) return null;

  if (shouldRunRecordQuery(message, normalizedWorkspace)) {
    let recordSummary = await provider.runRecordQuery({
      caseId,
      view: view || 'records',
      message,
      workspaceContext: normalizedWorkspace,
      user,
      limit: previewLimit
    });
    let broadenedFromWorkspace = false;
    let effectiveWorkspace = normalizedWorkspace;

    if ((recordSummary?.artifacts?.preview || []).length === 0 && hasNarrowWorkspaceScope(normalizedWorkspace)) {
      const caseWideWorkspace = buildCaseWideWorkspaceContext(normalizedWorkspace, detectedModule, view || 'records');
      const broadenedSummary = await provider.runRecordQuery({
        caseId,
        view: view || 'records',
        message,
        workspaceContext: caseWideWorkspace,
        user,
        limit: previewLimit
      });

      if ((broadenedSummary?.artifacts?.preview || []).length > 0) {
        recordSummary = broadenedSummary;
        broadenedFromWorkspace = true;
        effectiveWorkspace = caseWideWorkspace;
      }
    }

    if (recordSummary?.markdown || (recordSummary?.artifacts?.preview || []).length >= 0) {
      const answerPayload = buildRecordAnswerPayload({
        title: `${MODULE_LABELS[detectedModule] || detectedModule.toUpperCase()} Records`,
        recordSummary,
        caseId,
        caseLabel,
        module: detectedModule,
        view: view || 'records',
        workspaceContext: effectiveWorkspace,
        scopeMode: broadenedFromWorkspace ? 'case-wide' : currentScopeMode,
        scopeOrigin: broadenedFromWorkspace ? 'broadened_case_fallback' : scopeOrigin,
        broadenedFromWorkspace,
        sourceType: recordSummary?.meta?.cache === 'hit' ? 'snapshot' : 'live_records',
        previewLimit
      });

      return {
        route: `workspace_records_${detectedModule}`,
        mode: 'db_summary',
        tables: recordSummary?.sources?.tables || MODULE_TABLES[detectedModule] || [],
        confidenceInput: { mode: 'db_summary', intentScore: 0.95, intentLabel: `workspace_records_${detectedModule}` },
        markdown: answerPayload.markdown || buildSummaryMarkdown({
          scopeMeta,
          summary: recordSummary,
          title: `${MODULE_LABELS[detectedModule] || detectedModule.toUpperCase()} Records`
        }),
        answerPayload
      };
    }
  }

  const summary = await resolveScopedSummary({
    caseId,
    module: detectedModule,
    view: scopeMeta.view,
    normalizedWorkspace,
    user
  });

  if (metricKey && !['module_summary', 'advanced_summary', 'sdr_search_results', 'uploaded_files'].includes(metricKey)) {
    let effectiveSummary = summary;
    let effectiveWorkspace = normalizedWorkspace;
    let broadenedFromWorkspace = false;
    let metricValue = getMetricValueFromSummary(summary, metricKey);

    if (!hasMeaningfulValue(metricValue) && hasNarrowWorkspaceScope(normalizedWorkspace)) {
      const caseWideWorkspace = buildCaseWideWorkspaceContext(normalizedWorkspace, detectedModule, view);
      const caseWideSummary = await resolveScopedSummary({
        caseId,
        module: detectedModule,
        view: scopeMeta.view,
        normalizedWorkspace: caseWideWorkspace,
        user
      });
      const caseWideValue = getMetricValueFromSummary(caseWideSummary, metricKey);
      if (hasMeaningfulValue(caseWideValue)) {
        effectiveSummary = caseWideSummary;
        effectiveWorkspace = caseWideWorkspace;
        broadenedFromWorkspace = true;
        metricValue = caseWideValue;
      }
    }

    const answerPayload = buildMetricAnswerPayload({
      metricKey,
      summary: effectiveSummary,
      caseId,
      caseLabel,
      module: detectedModule,
      view,
      workspaceContext: effectiveWorkspace,
      scopeMode: broadenedFromWorkspace ? 'case-wide' : currentScopeMode,
      scopeOrigin: broadenedFromWorkspace ? 'broadened_case_fallback' : scopeOrigin,
      broadenedFromWorkspace,
      sourceType: effectiveSummary?.meta?.cache === 'hit' ? 'snapshot' : 'live_aggregate',
      previewLimit
    });

    if (hasMeaningfulValue(metricValue)) {
      return {
        route: `workspace_metric_${metricKey}`,
        mode: 'db_summary',
        tables: effectiveSummary?.sources?.tables || MODULE_TABLES[detectedModule] || [],
        confidenceInput: { mode: 'db_summary', intentScore: 0.97, intentLabel: `workspace_metric_${metricKey}` },
        markdown: answerPayload.markdown || buildFactMarkdown({
          scopeMeta,
          metricLabel: metricLabels[metricKey] || metricKey,
          metricValue: formatMetricValue(metricKey, metricValue)
        }),
        answerPayload
      };
    }

    return {
      route: `workspace_abstain_${detectedModule}`,
      mode: 'db_summary',
      tables: effectiveSummary?.sources?.tables || MODULE_TABLES[detectedModule] || [],
      confidenceInput: { mode: 'db_summary', intentScore: 0.72, intentLabel: `workspace_abstain_${detectedModule}` },
      markdown: answerPayload?.markdown || buildAbstainMarkdown({ scopeMeta, metricKey }),
      answerPayload
    };
  }

  if (metricKey === 'advanced_summary' || scopeMeta.view === 'advanced') {
    const answerPayload = buildSummaryAnswerPayload({
      title: `${MODULE_LABELS[detectedModule] || 'Case'} Advanced Analysis`,
      summary,
      caseId,
      caseLabel,
      module: detectedModule,
      view: scopeMeta.view,
      workspaceContext: normalizedWorkspace,
      scopeMode: currentScopeMode,
      scopeOrigin,
      sourceType: summary?.meta?.cache === 'hit' ? 'snapshot' : 'live_aggregate',
      previewLimit
    });

    return {
      route: `workspace_advanced_${detectedModule}`,
      mode: 'db_summary',
      tables: summary?.sources?.tables || MODULE_TABLES[detectedModule] || [],
      confidenceInput: { mode: 'db_summary', intentScore: 0.93, intentLabel: `workspace_advanced_${detectedModule}` },
      markdown: answerPayload.markdown || buildSummaryMarkdown({
        scopeMeta,
        summary,
        title: `${MODULE_LABELS[detectedModule] || 'Case'} Advanced Analysis`
      }),
      answerPayload
    };
  }

  if (metricKey === 'module_summary' || scopeMeta.view) {
    const answerPayload = buildSummaryAnswerPayload({
      title: scopeMeta.view && scopeMeta.view !== 'overview'
        ? `${MODULE_LABELS[detectedModule] || 'Case'} ${scopeMeta.view} View`
        : `${MODULE_LABELS[detectedModule] || 'Case'} Overview`,
      summary,
      caseId,
      caseLabel,
      module: detectedModule,
      view: scopeMeta.view,
      workspaceContext: normalizedWorkspace,
      scopeMode: currentScopeMode,
      scopeOrigin,
      sourceType: summary?.meta?.cache === 'hit' ? 'snapshot' : 'live_aggregate',
      previewLimit
    });

    return {
      route: `workspace_summary_${detectedModule}`,
      mode: 'db_summary',
      tables: summary?.sources?.tables || MODULE_TABLES[detectedModule] || [],
      confidenceInput: { mode: 'db_summary', intentScore: 0.9, intentLabel: `workspace_summary_${detectedModule}` },
      markdown: answerPayload.markdown || (scopeMeta.view && scopeMeta.view !== 'overview'
        ? buildCurrentViewMarkdown({ scopeMeta, summary })
        : buildSummaryMarkdown({
          scopeMeta,
          summary,
          title: `${MODULE_LABELS[detectedModule] || 'Case'} Overview`
        })),
      answerPayload
    };
  }

  return null;
};
