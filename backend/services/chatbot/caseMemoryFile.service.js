import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetchCaseKnowledge, getCaseModuleSummary } from './caseContext.service.js';
import { getAnalysisProvider } from './analysisRegistry.service.js';
import { buildMetricIndex } from './metricRegistry.service.js';
import { getCaseQaCatalog } from '../../../shared/chatbot/caseQaCatalog.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CASE_MEMORY_VERSION = 'case-memory-v2';
const DEFAULT_CASE_MEMORY_TTL_MS = Math.max(30_000, Number(process.env.CHATBOT_CASE_MEMORY_FILE_TTL_MS || 5 * 60 * 1000));
const CASE_MEMORY_ROOT = path.resolve(__dirname, '../../runtime/case-memory');

const normalizeObject = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const normalizeArray = (value) => (Array.isArray(value) ? value : []);

const sanitizeSegment = (value = '') =>
  String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'case';

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const toModuleLabel = (module) => {
  if (module === 'cdr') return 'CDR';
  if (module === 'ipdr') return 'IPDR';
  if (module === 'sdr') return 'SDR';
  if (module === 'tower') return 'Tower Dump';
  if (module === 'ild') return 'ILD';
  return String(module || '').toUpperCase();
};

const getCaseFolderName = (knowledge = {}) => {
  const caseId = String(knowledge?.case?.id || '').trim();
  const tag = sanitizeSegment(knowledge?.case?.caseNumber || knowledge?.case?.caseName || caseId);
  return `${caseId || 'unknown'}__${tag}`;
};

const getCaseMemoryPath = (knowledge = {}) => path.join(CASE_MEMORY_ROOT, getCaseFolderName(knowledge), 'case-memory.json');

const readJsonIfExists = async (targetPath) => {
  try {
    const raw = await fs.readFile(targetPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
};

const writeAtomicJson = async (targetPath, value) => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, targetPath);
};

const buildRecordSummary = (knowledge = {}) => ({
  cdr: { records: safeNumber(knowledge?.datasetCounts?.cdr) },
  ipdr: { records: safeNumber(knowledge?.datasetCounts?.ipdr) },
  sdr: { records: safeNumber(knowledge?.datasetCounts?.sdr) },
  tower: { records: safeNumber(knowledge?.datasetCounts?.tower) },
  ild: { records: safeNumber(knowledge?.datasetCounts?.ild) }
});

const buildFileManifest = (knowledge = {}) =>
  normalizeArray(knowledge?.files?.items).map((file) => ({
    id: safeNumber(file.id),
    name: file.originalName || file.fileName || `File ${file.id}`,
    fileName: file.fileName || null,
    module: file.detectedType || file.fileType || null,
    parseStatus: file.parseStatus || null,
    recordCount: safeNumber(file.recordCount),
    uploadedAt: file.uploadedAt || null
  }));

const buildFilterSchema = (module) => {
  if (module === 'cdr') return ['call_type', 'date', 'min_duration', 'max_duration', 'search'];
  if (module === 'ipdr') return ['date', 'search', 'ip', 'msisdn'];
  if (module === 'sdr') return ['search', 'name', 'number', 'email'];
  if (module === 'tower') return ['search', 'cell_id', 'date'];
  if (module === 'ild') return ['search', 'date', 'country', 'min_duration', 'max_duration'];
  return [];
};

const buildSearchableFields = (module) => {
  if (module === 'cdr') return ['a_party', 'b_party', 'imei', 'imsi', 'cell_id'];
  if (module === 'ipdr') return ['msisdn', 'imei', 'imsi', 'source_ip', 'destination_ip', 'url'];
  if (module === 'sdr') return ['subscriber_name', 'msisdn', 'imsi', 'imei', 'email'];
  if (module === 'tower') return ['a_party', 'b_party', 'imei', 'imsi', 'cell_id', 'site_name'];
  if (module === 'ild') return ['calling_number', 'called_number', 'country', 'imei'];
  return [];
};

const buildModuleCapabilities = (module) =>
  getCaseQaCatalog()
    .filter((entry) => (entry.modules || []).includes(module))
    .map((entry) => ({
      key: entry.key,
      label: entry.displayLabel,
      answerType: entry.answerType,
      queryMode: entry.queryMode,
      views: entry.views || [],
      aliases: (entry.uiLabels && entry.uiLabels.length > 0 ? entry.uiLabels : entry.aliases).slice(0, 8),
      supportsCaseWide: Boolean(entry.supportsCaseWide),
      supportsViewScope: Boolean(entry.supportsViewScope),
      supportsFileScope: Boolean(entry.supportsFileScope),
      supportsFilters: Boolean(entry.supportsFilters),
      evidenceColumns: entry.evidenceColumns || [],
      followUpExamples: entry.followUpExamples || []
    }));

const getSourceTables = (summary = {}, fallback = []) => {
  const tables = normalizeArray(summary?.sources?.tables);
  return tables.length > 0 ? tables : fallback;
};

const buildOverviewEntry = (summary = {}, fallbackTables = []) => ({
  markdown: summary?.artifacts?.summaryMarkdown || summary?.markdown || '',
  facts: normalizeObject(summary?.facts),
  insights: normalizeObject(summary?.insights),
  sources: { tables: getSourceTables(summary, fallbackTables) }
});

const buildRecordsEntry = (module, summary = {}, knowledge = {}) => ({
  count: safeNumber(summary?.facts?.total_records || knowledge?.datasetCounts?.[module]),
  filtersSupported: buildFilterSchema(module),
  searchableFields: buildSearchableFields(module),
  facts: {
    total_records: safeNumber(summary?.facts?.total_records || knowledge?.datasetCounts?.[module])
  },
  sources: { tables: getSourceTables(summary, [`${module}_records`]) }
});

const buildLocationRoamingEntry = (locationSummary = {}, roamingSummary = {}, fallbackTables = []) => ({
  markdown: [locationSummary?.artifacts?.summaryMarkdown || '', roamingSummary?.artifacts?.summaryMarkdown || ''].filter(Boolean).join('\n\n'),
  facts: {
    ...(normalizeObject(locationSummary?.facts)),
    ...(normalizeObject(roamingSummary?.facts))
  },
  sources: {
    tables: [...new Set([
      ...getSourceTables(locationSummary, fallbackTables),
      ...getSourceTables(roamingSummary, fallbackTables)
    ])]
  }
});

const buildTimelineEntry = (summary = {}) => ({
  totalEvents: safeNumber(summary?.facts?.event_count),
  earliestEvent: summary?.facts?.earliest_event || null,
  latestEvent: summary?.facts?.latest_event || null
});

const buildModuleMemory = async (module, caseId, user, knowledge) => {
  const provider = getAnalysisProvider(module);
  if (!provider) return null;

  const tableName = module === 'tower' ? 'tower_dump_records' : `${module}_records`;
  const [overviewSummary, advancedSummary] = await Promise.all([
    provider.buildCaseSummary(caseId, { user, view: 'overview' }),
    provider.buildCaseSummary(caseId, { user, view: 'advanced' })
  ]);

  const moduleMemory = {
    overview: buildOverviewEntry(overviewSummary, [tableName]),
    records: buildRecordsEntry(module, overviewSummary, knowledge),
    advanced: buildOverviewEntry(advancedSummary, [tableName])
  };

  if (module === 'cdr') {
    const [locationSummary, roamingSummary] = await Promise.all([
      provider.buildCaseSummary(caseId, { user, view: 'location' }),
      provider.buildCaseSummary(caseId, { user, view: 'roaming' })
    ]);
    moduleMemory.location_roaming = buildLocationRoamingEntry(locationSummary, roamingSummary, [tableName]);
  }

  if (module === 'ipdr') {
    const [mapSummary, chartsSummary] = await Promise.all([
      provider.buildCaseSummary(caseId, { user, view: 'map' }),
      provider.buildCaseSummary(caseId, { user, view: 'charts' })
    ]);
    moduleMemory.map = buildOverviewEntry(mapSummary, [tableName]);
    moduleMemory.charts = buildOverviewEntry(chartsSummary, [tableName]);
  }

  if (module === 'sdr') {
    moduleMemory.search = buildOverviewEntry(overviewSummary, [tableName]);
    moduleMemory.results = buildOverviewEntry(advancedSummary, [tableName]);
  }

  if (module === 'tower') {
    const [mapSummary, networkSummary, partySummary, chartSummary] = await Promise.all([
      provider.buildCaseSummary(caseId, { user, view: 'map' }),
      provider.buildCaseSummary(caseId, { user, view: 'network-graph' }),
      provider.buildCaseSummary(caseId, { user, view: 'party-graph' }),
      provider.buildCaseSummary(caseId, { user, view: 'charts' })
    ]);
    moduleMemory.map = buildOverviewEntry(mapSummary, [tableName]);
    moduleMemory.network_graph = buildOverviewEntry(networkSummary, [tableName]);
    moduleMemory.party_graph = buildOverviewEntry(partySummary, [tableName]);
    moduleMemory.charts = buildOverviewEntry(chartSummary, [tableName]);
  }

  if (module === 'ild') {
    const chartSummary = await provider.buildCaseSummary(caseId, { user, view: 'charts' });
    moduleMemory.charts = buildOverviewEntry(chartSummary, [tableName]);
  }

  return moduleMemory;
};

export const buildCanonicalCaseMemory = async ({ caseId, user = null } = {}) => {
  const knowledge = await fetchCaseKnowledge(caseId, { user });
  if (!knowledge?.case?.id) return null;

  const timelineSummary = await getCaseModuleSummary(caseId, 'timeline', { user });
  const modules = {};

  for (const module of ['cdr', 'ipdr', 'sdr', 'tower', 'ild']) {
    modules[module] = await buildModuleMemory(module, caseId, user, knowledge);
  }

  const memory = {
    version: CASE_MEMORY_VERSION,
    generatedAt: new Date().toISOString(),
    case: {
      id: safeNumber(knowledge?.case?.id),
      caseTag: knowledge?.case?.caseNumber || null,
      caseName: knowledge?.case?.caseName || null,
      caseNumber: knowledge?.case?.caseNumber || null,
      firNumber: knowledge?.case?.firNumber || null,
      officer: knowledge?.case?.operator || null,
      createdAt: knowledge?.case?.createdAt || null,
      status: knowledge?.case?.status || null,
      priority: knowledge?.case?.priority || null
    },
    dashboard: {
      recordSummary: buildRecordSummary(knowledge),
      timeline: buildTimelineEntry(timelineSummary || {}),
      files: buildFileManifest(knowledge)
    },
    capabilities: {
      modules: {
        cdr: buildModuleCapabilities('cdr'),
        ipdr: buildModuleCapabilities('ipdr'),
        sdr: buildModuleCapabilities('sdr'),
        tower: buildModuleCapabilities('tower'),
        ild: buildModuleCapabilities('ild')
      },
      searchableFields: {
        cdr: buildSearchableFields('cdr'),
        ipdr: buildSearchableFields('ipdr'),
        sdr: buildSearchableFields('sdr'),
        tower: buildSearchableFields('tower'),
        ild: buildSearchableFields('ild')
      }
    },
    modules,
    sources: {
      tables: normalizeArray(knowledge?.sources?.tables),
      files: buildFileManifest(knowledge).map((file) => ({ id: file.id, name: file.name, module: file.module }))
    }
  };

  memory.metricIndex = buildMetricIndex(memory);
  return memory;
};

export const getOrBuildCaseMemoryFile = async ({ caseId, user = null, ttlMs = DEFAULT_CASE_MEMORY_TTL_MS } = {}) => {
  const knowledge = await fetchCaseKnowledge(caseId, { user });
  if (!knowledge?.case?.id) return null;

  const targetPath = getCaseMemoryPath(knowledge);
  const existing = await readJsonIfExists(targetPath);
  if (existing?.generatedAt) {
    const ageMs = Date.now() - new Date(existing.generatedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= ttlMs) {
      return { memory: existing, path: targetPath, cache: 'hit' };
    }
  }

  const memory = await buildCanonicalCaseMemory({ caseId, user });
  if (!memory) return null;

  await writeAtomicJson(targetPath, memory);
  return { memory, path: targetPath, cache: existing ? 'refresh' : 'miss' };
};

export const invalidateCaseMemoryFile = async ({ caseId } = {}) => {
  const normalized = String(caseId || '').trim();
  if (!normalized) return;

  try {
    const entries = await fs.readdir(CASE_MEMORY_ROOT, { withFileTypes: true });
    const targets = entries.filter((entry) => entry.isDirectory() && entry.name.startsWith(`${normalized}__`));
    await Promise.all(targets.map((entry) => fs.rm(path.join(CASE_MEMORY_ROOT, entry.name), { recursive: true, force: true })));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

export const getCaseMemoryRoot = () => CASE_MEMORY_ROOT;
