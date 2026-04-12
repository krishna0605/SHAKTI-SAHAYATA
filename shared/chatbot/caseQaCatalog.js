const normalizeText = (value = '') =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeAliases = (aliases = []) => [...new Set((aliases || []).map((alias) => normalizeText(alias)).filter(Boolean))];

const MODULE_ALIASES = {
  cdr: 'cdr',
  call: 'cdr',
  calls: 'cdr',
  ipdr: 'ipdr',
  internet: 'ipdr',
  sdr: 'sdr',
  str: 'sdr',
  subscriber: 'sdr',
  tower: 'tower',
  'tower dump': 'tower',
  cell: 'tower',
  ild: 'ild'
};

const VIEW_ALIASES = {
  overview: 'overview',
  summary: 'overview',
  advanced: 'advanced',
  analysis: 'advanced',
  'advanced analysis': 'advanced',
  advanced_analysis: 'advanced',
  records: 'records',
  record: 'records',
  search: 'search',
  results: 'results',
  map: 'map',
  charts: 'charts',
  chart: 'charts',
  location: 'location',
  roaming: 'roaming',
  'network graph': 'network-graph',
  network_graph: 'network-graph',
  graph: 'network-graph',
  'party graph': 'party-graph',
  party_graph: 'party-graph',
  detail: 'detail',
  details: 'detail'
};

export const CASE_QA_MODULE_LABELS = {
  cdr: 'CDR',
  ipdr: 'IPDR',
  sdr: 'SDR',
  tower: 'Tower Dump',
  ild: 'ILD'
};

const buildEntry = (entry = {}) => ({
  modules: [],
  views: [],
  uiLabels: [],
  aliases: [],
  factKeys: [],
  answerType: 'summary',
  renderer: 'summary_bullets',
  queryMode: 'hybrid_memory_then_aggregate',
  supportsCaseWide: true,
  supportsViewScope: true,
  supportsFileScope: true,
  supportsFilters: true,
  evidenceColumns: [],
  emptyState: 'No grounded data found for the current scope.',
  followUpExamples: [],
  ...entry,
  uiLabels: [...new Set(entry.uiLabels || [])],
  aliases: normalizeAliases([...(entry.aliases || []), ...(entry.uiLabels || []), entry.displayLabel || '']),
  factKeys: [...new Set([...(entry.factKeys || []), entry.key].filter(Boolean))]
});

const CASE_QA_CATALOG = [
  buildEntry({
    key: 'uploaded_files',
    displayLabel: 'Uploaded Files',
    modules: ['cdr', 'ipdr', 'sdr', 'tower', 'ild'],
    views: ['overview', 'records', 'advanced', 'search'],
    uiLabels: ['Uploaded Files', 'Case File Manifest'],
    aliases: ['which files', 'list files', 'uploaded files', 'files uploaded', 'file list',
      'kaun si files', 'files dikhao', 'upload ki gayi files',
      'kon kon ni files', 'files batavo', 'upload kareli files'],
    answerType: 'table',
    renderer: 'table_block',
    queryMode: 'records_only',
    evidenceColumns: [
      { key: 'name', label: 'File' },
      { key: 'module', label: 'Module' },
      { key: 'parseStatus', label: 'Parse Status' },
      { key: 'recordCount', label: 'Records' }
    ],
    emptyState: 'No uploaded files were found for this case.'
  }),
  buildEntry({
    key: 'module_summary',
    displayLabel: 'Module Summary',
    modules: ['cdr', 'ipdr', 'sdr', 'tower', 'ild'],
    views: ['overview'],
    aliases: ['overview', 'summary', 'highlights', 'what does this show', 'module summary',
      'saransh', 'saransh dikhao', 'kya dikhta hai', 'saar batao',
      'saransh batavo', 'shu dekhay chhe', 'overview batavo'],
    answerType: 'summary',
    renderer: 'summary_bullets',
    emptyState: 'No verified summary is available for this scope yet.'
  }),
  buildEntry({
    key: 'advanced_summary',
    displayLabel: 'Advanced Analysis',
    modules: ['cdr', 'ipdr', 'sdr', 'tower', 'ild'],
    views: ['advanced', 'charts', 'map', 'network-graph', 'party-graph', 'search', 'results'],
    aliases: ['advanced analysis', 'advanced', 'findings', 'key insights',
      'gehri analysis', 'vishleshan', 'mukhya nishkarsh',
      'uNDi analysis', 'vishleshan batavo', 'mukhya parinaam'],
    answerType: 'summary',
    renderer: 'summary_bullets',
    emptyState: 'No verified advanced analysis summary is available for this scope yet.'
  }),
  buildEntry({
    key: 'total_records',
    displayLabel: 'Total Records',
    modules: ['cdr', 'ipdr', 'sdr', 'tower', 'ild'],
    aliases: ['total records', 'how many records', 'total sessions', 'how many sessions',
      'kitne records', 'kul records', 'records ki sankhya',
      'ketla records', 'kul records sankhya'],
    answerType: 'scalar',
    renderer: 'scalar_line'
  }),
  buildEntry({
    key: 'unique_a_parties',
    displayLabel: 'Unique A-Parties',
    modules: ['cdr', 'tower'],
    aliases: ['unique a parties', 'unique a party'],
    answerType: 'scalar',
    renderer: 'scalar_line'
  }),
  buildEntry({
    key: 'unique_b_parties',
    displayLabel: 'Unique B-Parties',
    modules: ['cdr', 'tower'],
    aliases: ['unique b parties', 'unique b party'],
    answerType: 'scalar',
    renderer: 'scalar_line'
  }),
  buildEntry({
    key: 'avg_duration_sec',
    displayLabel: 'Average Duration',
    modules: ['cdr', 'ild'],
    aliases: ['average duration', 'avg duration',
      'ausat avadhi', 'average kitna hai',
      'sarasar samay', 'average duration ketli'],
    answerType: 'scalar',
    renderer: 'scalar_line'
  }),
  buildEntry({
    key: 'callTypeDistribution',
    displayLabel: 'Call Types',
    modules: ['cdr'],
    uiLabels: ['Call Type Breakdown', 'Call Types'],
    aliases: ['call directions',
      'call ke prakar', 'call type ka breakdown',
      'call na prakar', 'call type breakdown'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Call Type' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'hourlyActivity',
    displayLabel: 'Hourly Call Activity',
    modules: ['cdr'],
    aliases: ['hourly call activity', 'hourly activity', 'activity by hour',
      'ghante ke hisab se', 'har ghante ki activity',
      'kalak pramane activity'],
    answerType: 'timeseries',
    renderer: 'timeseries_chart',
    evidenceColumns: [
      { key: 'hour', label: 'Hour' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'topBParties',
    displayLabel: 'Top B-Parties',
    modules: ['cdr'],
    uiLabels: ['Top B-Parties', 'Top Contacts'],
    aliases: ['top b parties', 'top contacts', 'sabse zyada call kiye gaye number',
      'pramuKh b party', 'sabse vadhu call karela number'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Number' },
      { key: 'count', label: 'Calls', format: 'number' },
      { key: 'duration_sec', label: 'Duration', format: 'duration' }
    ]
  }),
  buildEntry({
    key: 'topLocations',
    displayLabel: 'Top Locations',
    modules: ['cdr'],
    aliases: ['top location', 'location highlights',
      'pramuKh sthaan', 'top jagah',
      'pramuKh sthano', 'top jagya'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Location' },
      { key: 'count', label: 'Events', format: 'number' },
      { key: 'duration_sec', label: 'Duration', format: 'duration' }
    ]
  }),
  buildEntry({
    key: 'max_imei_numbers',
    displayLabel: 'Max IMEI Numbers',
    modules: ['cdr', 'ipdr'],
    aliases: ['max imei', 'top imei', 'max imei numbers', 'top imei numbers',
      'sabse zyada imei', 'maximum imei'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'IMEI' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'max_imsi_numbers',
    displayLabel: 'Max IMSI Numbers',
    modules: ['cdr', 'ipdr'],
    aliases: ['max imsi', 'top imsi', 'max imsi numbers', 'top imsi numbers',
      'sabse zyada imsi', 'maximum imsi'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'IMSI' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'max_b_parties',
    displayLabel: 'Max B-Parties',
    modules: ['cdr'],
    aliases: ['max b parties', 'max b party',
      'sabse zyada b party', 'maximum b party'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Number' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'sms_analysis',
    displayLabel: 'SMS Analysis',
    modules: ['cdr'],
    aliases: ['sms analysis', 'sms stats', 'sms ka vishleshan', 'kitne sms',
      'sms nu vishleshan', 'ketla sms'],
    answerType: 'summary',
    renderer: 'summary_bullets'
  }),
  buildEntry({
    key: 'night_activity',
    displayLabel: 'Night Activity',
    modules: ['cdr'],
    aliases: ['night activity', 'night calls', 'night stay',
      'raat ki activity', 'raat ke call',
      'raatri activity', 'raatna call'],
    answerType: 'summary',
    renderer: 'summary_bullets'
  }),
  /* regular_callers is defined once below with full evidenceColumns (phone, count, days_active) */
  buildEntry({
    key: 'international_calls',
    displayLabel: 'International Calls',
    modules: ['cdr', 'ild'],
    uiLabels: ['International Calls'],
    aliases: ['isd calls', 'international calls',
      'antarrashtriya call', 'videsh ke call',
      'aaantarraashTriya call', 'videsh na call'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Number' },
      { key: 'count', label: 'Count', format: 'number' }
    ],
    followUpExamples: ['Show evidence', 'Which file?', 'Broaden to entire case']
  }),
  buildEntry({
    key: 'daily_first_last_call',
    displayLabel: 'Daily First/Last Call',
    modules: ['cdr'],
    views: ['advanced'],
    uiLabels: ['Daily First/Last Call'],
    aliases: ['daily first and last call', 'daily first/last call', 'daily first last call', 'first and last call', 'first/last call',
      'roz ka pehla aur aakhri call', 'daily pehla aakhri call',
      'dainik pehlo ane chello call', 'roj no first last call'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Date' },
      { key: 'first_call_time', label: 'First Call' },
      { key: 'last_call_time', label: 'Last Call' }
    ],
    followUpExamples: ['Which day had the earliest call?', 'Show more']
  }),
  buildEntry({
    key: 'home_and_work',
    displayLabel: 'Home and Work',
    modules: ['cdr'],
    aliases: ['home and work', 'home work',
      'ghar aur kaam', 'ghar aur office ki jagah',
      'ghar ane office', 'ghar ane kaam ni jagya'],
    answerType: 'summary',
    renderer: 'summary_bullets'
  }),
  buildEntry({
    key: 'common_numbers',
    displayLabel: 'Common Numbers',
    modules: ['cdr'],
    aliases: ['common numbers', 'common number',
      'samaaan number', 'ek jaise number',
      'samaan number', 'ekna jeva number'],
    answerType: 'list',
    renderer: 'list_block'
  }),
  buildEntry({
    key: 'common_imei_numbers',
    displayLabel: 'Common IMEI Numbers',
    modules: ['cdr', 'ipdr', 'sdr', 'tower'],
    aliases: ['common imei', 'common imei number', 'common imei numbers',
      'samaaan imei', 'samaan imei'],
    answerType: 'list',
    renderer: 'list_block'
  }),
  buildEntry({
    key: 'common_imsi_numbers',
    displayLabel: 'Common IMSI Numbers',
    modules: ['cdr', 'ipdr', 'sdr', 'tower'],
    aliases: ['common imsi', 'common imsi number', 'common imsi numbers',
      'samaaan imsi', 'samaan imsi'],
    answerType: 'list',
    renderer: 'list_block'
  }),
  buildEntry({
    key: 'common_locations',
    displayLabel: 'Common Locations',
    modules: ['cdr'],
    aliases: ['common locations', 'common location',
      'samaaan jagah', 'ek jaisi jagah',
      'samaan jagya', 'ekni jeva jagya'],
    answerType: 'list',
    renderer: 'list_block'
  }),
  buildEntry({
    key: 'roamingSummary',
    displayLabel: 'Roaming Summary',
    modules: ['cdr'],
    aliases: ['roaming summary', 'state roaming', 'roaming states',
      'roaming saransh', 'rajya roaming',
      'roaming saransh', 'rajya roaming'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'State' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'location_summary',
    displayLabel: 'Location Summary',
    modules: ['cdr'],
    aliases: ['location summary', 'cell id locations', 'top cell ids',
      'sthaan saransh', 'cell id ki jagah',
      'sthaan saransh', 'cell id na sthano'],
    answerType: 'summary',
    renderer: 'summary_bullets'
  }),
  buildEntry({
    key: 'unique_msisdn',
    displayLabel: 'Unique MSISDN',
    modules: ['ipdr'],
    aliases: ['unique msisdn', 'kitne msisdn', 'ketla msisdn'],
    answerType: 'scalar',
    renderer: 'scalar_line'
  }),
  buildEntry({
    key: 'unique_imei',
    displayLabel: 'Unique IMEI',
    modules: ['ipdr', 'cdr', 'sdr'],
    aliases: ['unique imei', 'kitne imei', 'ketla imei'],
    answerType: 'scalar',
    renderer: 'scalar_line'
  }),
  buildEntry({
    key: 'unique_imsi',
    displayLabel: 'Unique IMSI',
    modules: ['ipdr', 'sdr'],
    aliases: ['unique imsi', 'kitne imsi', 'ketla imsi'],
    answerType: 'scalar',
    renderer: 'scalar_line'
  }),
  buildEntry({
    key: 'data_volume',
    displayLabel: 'Data Volume',
    modules: ['ipdr'],
    aliases: ['data volume', 'total data volume',
      'data ki matra', 'kitna data',
      'data nu pramaan', 'ketlu data'],
    answerType: 'scalar',
    renderer: 'scalar_line'
  }),
  buildEntry({
    key: 'top_source_ips',
    displayLabel: 'Top Source / Destination IPs',
    modules: ['ipdr'],
    aliases: ['top source ip', 'top source ips', 'top destination ip', 'top destination ips', 'source ip', 'destination ip',
      'pramuKh source ip', 'pramuKh destination ip'],
    factKeys: ['top_source_ips', 'topSourceIps'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'IP' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'top_destination_ips',
    displayLabel: 'Top Destination IPs',
    modules: ['ipdr'],
    aliases: ['top destination ip', 'top destination ips',
      'pramuKh destination ip', 'sabse zyada destination ip'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'IP' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'top_msisdn',
    displayLabel: 'Top MSISDN',
    modules: ['ipdr'],
    uiLabels: ['Top MSISDN'],
    factKeys: ['top_msisdn', 'topMsisdn'],
    aliases: ['top msisdn', 'pramuKh msisdn', 'sabse zyada msisdn'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'MSISDN' },
      { key: 'count', label: 'Count', format: 'number' }
    ],
    followUpExamples: ['Show top 10', 'Which file?']
  }),
  buildEntry({
    key: 'topSubscriberNames',
    displayLabel: 'Top Subscriber Names',
    modules: ['sdr'],
    aliases: ['top names', 'top subscriber names',
      'pramuKh naam', 'sabse zyada subscriber',
      'pramuKh naam', 'sabse vadhu subscriber'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Subscriber' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'topPhoneNumbers',
    displayLabel: 'Top Phone Numbers',
    modules: ['sdr'],
    aliases: ['top phone numbers', 'top numbers',
      'pramuKh phone number', 'sabse zyada phone number'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Number' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'topCells',
    displayLabel: 'Top Towers / Cells',
    modules: ['tower'],
    aliases: ['top towers', 'top tower', 'top cells', 'top cell',
      'pramuKh tower', 'sabse zyada cell',
      'pramuKh tower', 'sabse vadhu cell'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Cell / Tower' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'topParties',
    displayLabel: 'Top Parties',
    modules: ['tower'],
    aliases: ['top parties', 'top party',
      'pramuKh party', 'sabse zyada party'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Party' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'topCalledParties',
    displayLabel: 'Top Called Parties',
    modules: ['ild'],
    aliases: ['top called parties', 'top called party', 'top international contacts',
      'sabse zyada call kiye gaye', 'pramuKh antarrashtriya sampark'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Number' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'topCountries',
    displayLabel: 'Top Countries',
    modules: ['ild'],
    aliases: ['top countries', 'country trends', 'top country',
      'pramuKh desh', 'sabse zyada desh',
      'pramuKh desh', 'sabse vadhu desh'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'label', label: 'Country' },
      { key: 'count', label: 'Count', format: 'number' }
    ]
  }),
  buildEntry({
    key: 'common_msisdn',
    displayLabel: 'Common MSISDN',
    modules: ['ipdr'],
    aliases: ['common msisdn', 'shared msisdn',
      'samaaan msisdn', 'samaan msisdn'],
    answerType: 'list',
    renderer: 'list_block',
    queryMode: 'aggregate_only',
    emptyState: 'No common MSISDN found across files.'
  }),
  buildEntry({
    key: 'regular_callers',
    displayLabel: 'Regular Callers',
    modules: ['cdr'],
    aliases: ['regular callers', 'regular caller', 'frequent callers', 'frequent caller',
      'niyamit caller', 'bar bar call karne wale',
      'niyamit caller', 'varamvar call karnara'],
    answerType: 'table',
    renderer: 'table_block',
    evidenceColumns: [
      { key: 'phone', label: 'Number' },
      { key: 'count', label: 'Calls', format: 'number' },
      { key: 'days_active', label: 'Days Active', format: 'number' }
    ]
  })
];

const exactAliasScore = (text, entry) => {
  if (!text) return 0;
  if (entry.aliases.includes(text)) return 100;
  if ((entry.uiLabels || []).some((label) => normalizeText(label) === text)) return 90;
  return 0;
};

const includesAliasScore = (text, entry) => {
  if (!text) return 0;
  const alias = entry.aliases.find((candidate) => text.includes(candidate));
  if (!alias) return 0;
  return Math.min(80, alias.length + 20);
};

const normalizeModule = (value = null) => MODULE_ALIASES[normalizeText(value)] || null;
const normalizeView = (value = null) => VIEW_ALIASES[normalizeText(value)] || null;

export const CASE_QA_MODULE_ALIASES = MODULE_ALIASES;
export const CASE_QA_VIEW_ALIASES = VIEW_ALIASES;
export const normalizeCaseQaText = normalizeText;
export const normalizeCaseQaModule = normalizeModule;
export const normalizeCaseQaView = normalizeView;

export const getCaseQaCatalog = () => CASE_QA_CATALOG.map((entry) => ({
  ...entry,
  modules: [...entry.modules],
  views: [...entry.views],
  uiLabels: [...entry.uiLabels],
  aliases: [...entry.aliases],
  factKeys: [...entry.factKeys],
  evidenceColumns: [...entry.evidenceColumns],
  followUpExamples: [...entry.followUpExamples]
}));

export const getCaseQaCatalogEntry = (key) =>
  CASE_QA_CATALOG.find((entry) => entry.key === key) || null;

export const findCaseQaCatalogEntries = ({ message = '', module = null, view = null } = {}) => {
  const text = normalizeText(message);
  if (!text) return [];

  const normalizedModule = normalizeModule(module);
  const normalizedView = normalizeView(view);

  return CASE_QA_CATALOG
    .map((entry) => {
      if (normalizedModule && entry.modules.length > 0 && !entry.modules.includes(normalizedModule)) return null;
      if (normalizedView && entry.views.length > 0 && !entry.views.includes(normalizedView)) return null;
      const score = exactAliasScore(text, entry) || includesAliasScore(text, entry);
      if (!score) return null;
      return { entry, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .map(({ entry }) => entry);
};

export const resolveCaseQaCatalogEntry = ({ message = '', module = null, view = null } = {}) =>
  findCaseQaCatalogEntries({ message, module, view })[0] || null;

const GROUNDABILITY_PATTERNS = [
  { bucket: 'metric', pattern: /\b(total|count|average|avg|max|min|unique|top|how many|volume|duration|number of)\b/ },
  { bucket: 'entity_lookup', pattern: /\b(imei|imsi|msisdn|phone|number|subscriber|ip address|email|party|contact)\b/ },
  { bucket: 'record_search', pattern: /\b(find|search|lookup|look up|get|show me|records?|rows?|entries)\b/ },
  { bucket: 'summary', pattern: /\b(summary|summarize|overview|highlights?|what does|tell me about|describe|explain)\b/ },
  { bucket: 'timeline', pattern: /\b(timeline|when|date|time|first|last|earliest|latest|daily|hourly|trend|pattern)\b/ },
  { bucket: 'file_question', pattern: /\b(files?|uploads?|uploaded|file list|manifest|parsed|parse status)\b/ },
  { bucket: 'comparison', pattern: /\b(compare|comparison|versus|vs|difference|between|across|common|shared)\b/ },
  { bucket: 'filterable_aggregate', pattern: /\b(filter|by|per|breakdown|distribution|grouped|group by|split|segment)\b/ },
  { bucket: 'module_navigation', pattern: /\b(cdr|ipdr|sdr|tower|ild|module|tab|view|section|page|screen)\b/ },
  { bucket: 'evidence_drilldown', pattern: /\b(evidence|detail|drill|expand|more|show more|open|from which|which file)\b/ }
];

const NON_GROUNDABLE_PATTERNS = [
  /\bhow are you\b/,
  /\bwhat(?:'s| is)\s+your\s+name\b/,
  /\bwho are you\b/,
  /\bwho (?:made|created|built) you\b/,
  /\btell me a joke\b/,
  /\bjoke\b/,
  /\bweather\b/,
  /\bplay\b/,
  /\bsing\b/,
  /\bpoem\b/,
  /\bstory\b/,
  /\brecipe\b/,
  /\bcook\b/
];

export const classifyGroundability = (message = '') => {
  const text = normalizeText(message);
  if (!text) return { groundable: false, bucket: null, confidence: 0 };

  if (NON_GROUNDABLE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { groundable: false, bucket: 'chit_chat', confidence: 0.95 };
  }

  const catalogEntry = resolveCaseQaCatalogEntry({ message: text });
  if (catalogEntry) {
    return { groundable: true, bucket: 'metric', confidence: 0.98, catalogKey: catalogEntry.key };
  }

  for (const { bucket, pattern } of GROUNDABILITY_PATTERNS) {
    if (pattern.test(text)) {
      return { groundable: true, bucket, confidence: 0.8 };
    }
  }

  return { groundable: false, bucket: null, confidence: 0.5 };
};

export const isGroundableCaseQuestionText = (message = '') => {
  const text = normalizeText(message);
  if (!text) return false;
  const result = classifyGroundability(text);
  return result.groundable;
};

export const getMetricLabel = (metricKey) => {
  const entry = CASE_QA_CATALOG.find((e) => e.key === metricKey);
  return entry?.displayLabel || null;
};

export const buildMetricLabelMap = () =>
  Object.fromEntries(CASE_QA_CATALOG.map((entry) => [entry.key, entry.displayLabel]));

export const getCaseQaCatalogKeysByModule = (module) => {
  const normalized = normalizeModule(module);
  if (!normalized) return [];
  return CASE_QA_CATALOG
    .filter((entry) => entry.modules.length === 0 || entry.modules.includes(normalized))
    .map((entry) => entry.key);
};

export const getCaseQaCatalogEntriesByModule = (module) => {
  const normalized = normalizeModule(module);
  if (!normalized) return [];
  return CASE_QA_CATALOG
    .filter((entry) => entry.modules.length === 0 || entry.modules.includes(normalized))
    .map((entry) => ({ key: entry.key, displayLabel: entry.displayLabel, answerType: entry.answerType, renderer: entry.renderer }));
};
