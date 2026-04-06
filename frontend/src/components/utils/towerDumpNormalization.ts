/**
 * Tower Dump Normalization - Multi-operator CSV parsing for Tower Dump Records
 * Supports Vodafone, Airtel, BSNL, and JIO tower dump formats
 */

import mappingData from './mappings/towerDumpMapping.json';

const TOWER_DUMP_PARSE_DEBUG = false;
const towerParseLog = (...args: unknown[]) => {
  if (TOWER_DUMP_PARSE_DEBUG) console.log(...args);
};
const towerParseWarn = (...args: unknown[]) => {
  if (TOWER_DUMP_PARSE_DEBUG) console.warn(...args);
};

export interface NormalizedTowerDump {
  operator: string;
  record_id?: string;

  a_party?: string;
  b_party?: string;

  call_type?: string;
  toc?: string;

  lrn_b_party_number?: string;
  lrn_description?: string;
  lrn_lsa?: string;

  call_date?: string;
  call_start_time?: string;
  call_end_time?: string;
  duration_sec?: number;

  first_cell_desc?: string;
  first_cell_id?: string;
  first_cell_lat?: number;
  first_cell_long?: number;

  last_cell_desc?: string;
  last_cell_id?: string;
  last_cell_lat?: number;
  last_cell_long?: number;

  smsc_number?: string;
  service_type?: string;

  imei?: string;
  imsi?: string;

  call_forwarding_number?: string;
  original_originated_party?: string;

  roaming_circle?: string;
  msc_id?: string;
  in_tg?: string;
  out_tg?: string;

  vowifi_first_ue_ip?: string;
  vowifi_first_ue_port?: number;
  vowifi_last_ue_ip?: string;
  vowifi_last_ue_port?: number;
}

const RAW_TOWER_ALIAS_MAP = mappingData as unknown as Record<string, string[]>;
const CANONICAL_TOWER_FIELD_MAP: Record<string, keyof NormalizedTowerDump> = {
  'calling no': 'a_party',
  'called no': 'b_party',
  'date': 'call_date',
  'time': 'call_start_time',
  'duration of call': 'duration_sec',
  'dur(s)': 'duration_sec',
  'call type': 'call_type',
  'first cell id': 'first_cell_id',
  'last cell id': 'last_cell_id',
  'imei': 'imei',
  'imsi': 'imsi',
  'roaming circle': 'roaming_circle',
  'first roaming network circle id': 'roaming_circle',
  'lrn': 'lrn_b_party_number',
  'lac': 'lrn_lsa',
  'call forward': 'call_forwarding_number',
  'originating switch id': 'msc_id',
  'incoming trunk id': 'in_tg',
  'outgoing trunk id': 'out_tg'
};

const normalizeTowerMappingHeaderKey = (header: string): string => {
  return header.toLowerCase().trim()
    .replace(/[_\-()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const buildTowerAliasMap = (): Record<string, string | string[]> => {
  const aliasMap: Record<string, string | string[]> = {};
  Object.entries(RAW_TOWER_ALIAS_MAP).forEach(([canonical, aliases]) => {
    const field = CANONICAL_TOWER_FIELD_MAP[canonical.toLowerCase().trim()];
    if (!field) return;
    aliasMap[canonical] = field;
    aliasMap[normalizeTowerMappingHeaderKey(canonical)] = field;
    aliases.forEach(alias => {
      aliasMap[alias] = field;
      aliasMap[normalizeTowerMappingHeaderKey(alias)] = field;
    });
  });
  return aliasMap;
};

const UNIVERSAL_TOWER_MAP = buildTowerAliasMap();
const OPERATOR_MAPS: Record<string, Record<string, string | string[]>> = {
  VODAFONE: UNIVERSAL_TOWER_MAP,
  AIRTEL: UNIVERSAL_TOWER_MAP,
  BSNL: UNIVERSAL_TOWER_MAP,
  JIO: UNIVERSAL_TOWER_MAP,
  OTHER: UNIVERSAL_TOWER_MAP
};

type OperatorLookup = {
  mapping: Record<string, string | string[]>;
  keys: string[];
  lowerMap: Map<string, string | string[]>;
  normalizedMap: Map<string, string | string[]>;
  normalizedKeys: Array<{ key: string; norm: string }>;
};

const operatorLookupCache = new Map<string, OperatorLookup>();

const getOperatorLookup = (operator: string): OperatorLookup => {
  const cached = operatorLookupCache.get(operator);
  if (cached) return cached;

  const mapping = OPERATOR_MAPS[operator];
  if (!mapping) {
    throw new Error(`Unknown operator: ${operator}`);
  }

  const keys = Object.keys(mapping);
  const lowerMap = new Map<string, string | string[]>();
  const normalizedMap = new Map<string, string | string[]>();
  const normalizedKeys: Array<{ key: string; norm: string }> = [];

  for (const key of keys) {
    const lower = key.toLowerCase().trim();
    const norm = normalizeHeader(key);
    lowerMap.set(lower, mapping[key]);
    normalizedMap.set(norm, mapping[key]);
    normalizedKeys.push({ key, norm });
  }

  const lookup: OperatorLookup = { mapping, keys, lowerMap, normalizedMap, normalizedKeys };
  operatorLookupCache.set(operator, lookup);
  return lookup;
};

// Normalize header for matching
function normalizeHeader(header: string): string {
  return header.toLowerCase().trim()
    .replace(/[_\-()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const setTowerField = <K extends keyof NormalizedTowerDump>(
  target: NormalizedTowerDump,
  key: K,
  value: NormalizedTowerDump[K]
): void => {
  target[key] = value;
};

// Parse duration from various formats to seconds
const parseDuration = (duration: string): number | null => {
  if (!duration) return null;

  // Handle HH:MM:SS format
  const timeMatch = duration.match(/^(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (timeMatch) {
    const [, hours, minutes, seconds] = timeMatch;
    return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds);
  }

  // Handle MM:SS format
  const minSecMatch = duration.match(/^(\d{1,2}):(\d{1,2})$/);
  if (minSecMatch) {
    const [, minutes, seconds] = minSecMatch;
    return parseInt(minutes) * 60 + parseInt(seconds);
  }

  // Handle plain seconds
  const secMatch = duration.match(/^(\d+)$/);
  if (secMatch) {
    return parseInt(secMatch[1]);
  }

  return null;
};

// Parse date from various formats
const parseDate = (dateStr: string): string | null => {
  if (!dateStr) return null;

  // Handle DD/MM/YYYY format
  const dmYMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmYMatch) {
    const [, day, month, year] = dmYMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Handle DD-MM-YYYY format
  const dMYMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dMYMatch) {
    const [, day, month, year] = dMYMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  // Try to parse as ISO or other formats
  const date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString().split('T')[0];
  }

  return null;
};

const toUndefined = <T>(value: T | null): T | undefined => (value === null ? undefined : value);

const applyTowerGeoFallback = (
  normalized: NormalizedTowerDump,
  normalizedHeader: string,
  rawValue: string
): boolean => {
  const value = rawValue?.trim();
  if (!value) return false;

  const hasFirst = normalizedHeader.includes('first');
  const hasLast = normalizedHeader.includes('last');
  if (!hasFirst && !hasLast) return false;

  const hasLat = normalizedHeader.includes('latitude') || /(^|[\s_])lat($|[\s_])/.test(normalizedHeader);
  const hasLng = normalizedHeader.includes('longitude') || normalizedHeader.includes('long') || normalizedHeader.includes('lng');
  const hasCellDesc =
    normalizedHeader.includes('desc') ||
    normalizedHeader.includes('address') ||
    normalizedHeader.includes('location') ||
    normalizedHeader.includes('tower');

  if (hasLat && hasLng) {
    const [lat, lng] = parseLatLong(value);
    if (hasFirst) {
      if (lat !== undefined) normalized.first_cell_lat = lat;
      if (lng !== undefined) normalized.first_cell_long = lng;
    } else {
      if (lat !== undefined) normalized.last_cell_lat = lat;
      if (lng !== undefined) normalized.last_cell_long = lng;
    }
    return lat !== undefined || lng !== undefined;
  }

  if (hasLat) {
    const lat = parseFloat(value);
    if (!Number.isNaN(lat)) {
      if (hasFirst) normalized.first_cell_lat = lat;
      else normalized.last_cell_lat = lat;
      return true;
    }
  }

  if (hasLng) {
    const lng = parseFloat(value);
    if (!Number.isNaN(lng)) {
      if (hasFirst) normalized.first_cell_long = lng;
      else normalized.last_cell_long = lng;
      return true;
    }
  }

  if (hasCellDesc) {
    if (hasFirst) normalized.first_cell_desc = value;
    else normalized.last_cell_desc = value;
    return true;
  }

  return false;
};

// Parse datetime from various formats
const parseDateTime = (dateTimeStr: string): string | null => {
  if (!dateTimeStr) return null;

  // Handle DD/MM/YYYY HH:mm:ss format
  const dateTimeMatch = dateTimeStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (dateTimeMatch) {
    const [, day, month, year, hour, minute, second] = dateTimeMatch;
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;
    return isoDate;
  }

  // Handle DD-MM-YYYY HH:mm:ss format
  const dateTimeDashMatch = dateTimeStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (dateTimeDashMatch) {
    const [, day, month, year, hour, minute, second] = dateTimeDashMatch;
    const isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:${second.padStart(2, '0')}`;
    return isoDate;
  }

  // Try to parse as ISO or other formats
  const date = new Date(dateTimeStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  return null;
};

// Parse latitude/longitude from various formats
const parseLatLong = (val: string): [number | undefined, number | undefined] => {
  if (!val || val.trim() === '') return [undefined, undefined];
  const parts = val.split(/[,\s/]+/).filter(Boolean);
  if (parts.length >= 2) {
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    return [isNaN(lat) ? undefined : lat, isNaN(lng) ? undefined : lng];
  }
  return [undefined, undefined];
};

// Clean and validate value based on field type
const cleanValue = (field: string, value: string): string | number | undefined => {
  if (!value || value.trim() === '') return undefined;

  const cleanVal = value.trim();

  // Phone numbers
  if (['a_party', 'b_party', 'lrn_b_party_number', 'call_forwarding_number', 'original_originated_party'].includes(field)) {
    return cleanVal.replace(/[^\d]/g, '');
  }

  // Duration
  if (field === 'duration_sec') {
    return toUndefined(parseDuration(cleanVal));
  }

  // Dates
  if (field === 'call_date') {
    return toUndefined(parseDate(cleanVal));
  }

  // DateTimes
  if (['call_start_time', 'call_end_time'].includes(field)) {
    return toUndefined(parseDateTime(cleanVal));
  }

  // Coordinates
  if (['first_cell_lat', 'first_cell_long', 'last_cell_lat', 'last_cell_long'].includes(field)) {
    const num = parseFloat(cleanVal);
    return isNaN(num) ? undefined : num;
  }

  // Ports
  if (['vowifi_first_ue_port', 'vowifi_last_ue_port'].includes(field)) {
    const num = parseInt(cleanVal);
    return isNaN(num) ? undefined : num;
  }

  // IPs
  if (['vowifi_first_ue_ip', 'vowifi_last_ue_ip'].includes(field)) {
    // Basic IP validation
    const ipMatch = cleanVal.match(/^(\d{1,3}\.){3}\d{1,3}$/);
    return ipMatch ? cleanVal : undefined;
  }

  // IMEI and IMSI - ensure they are stored as strings without scientific notation
  if (field === 'imei' || field === 'imsi') {
    // If it's a number in scientific notation, convert to decimal string
    if (/^\d+\.?\d*e[+-]\d+$/i.test(cleanVal)) {
      try {
        const num = parseFloat(cleanVal);
        return BigInt(Math.round(num)).toString(); // Use BigInt for exact conversion
      } catch {
        return cleanVal.replace(/[^\d]/g, '');
      }
    }
    // Otherwise, clean to digits only
    return cleanVal.replace(/[^\d]/g, '');
  }

  return cleanVal;
};

// Detect operator from headers
const detectOperator = (headers: string[]): string | null => {
  const normalizedHeaders = headers.map(h => normalizeHeader(h));

  // Check for operator-specific headers
  if (normalizedHeaders.includes('target /a party number') || normalizedHeaders.includes('lrn- b party number')) {
    return 'VODAFONE';
  }
  if (normalizedHeaders.includes('target no') || normalizedHeaders.includes('vowifi first ue ip')) {
    return 'AIRTEL';
  }
  if (normalizedHeaders.includes('sl_no') || normalizedHeaders.includes('lrn_b_party_no')) {
    return 'BSNL';
  }
  if (normalizedHeaders.includes('calling party telephone number') || normalizedHeaders.includes('call termination time')) {
    return 'JIO';
  }

  // Fallback: score headers against each operator map and pick the best overlap.
  const normalizedHeaderSet = new Set(normalizedHeaders);
  const scored = Object.entries(OPERATOR_MAPS)
    .map(([operator, mapping]) => {
      const mappingHeaders = Object.keys(mapping).map(h => normalizeHeader(h));
      const hits = mappingHeaders.filter(h => normalizedHeaderSet.has(h)).length;
      return { operator, hits };
    })
    .sort((a, b) => b.hits - a.hits);

  if (scored[0] && scored[0].hits > 0) {
    towerParseLog(`[Tower Dump Parser] Fallback operator match: ${scored[0].operator} (${scored[0].hits} header matches)`);
    return scored[0].operator;
  }

  return null;
};

// Main normalization function
export const normalizeTowerDumpRow = (operator: string, headerRow: string[], dataRow: string[]): NormalizedTowerDump => {
  const { mapping, keys: mappingKeys } = getOperatorLookup(operator);

  const normalized: NormalizedTowerDump = { operator };

  for (let i = 0; i < headerRow.length; i++) {
    const header = headerRow[i];
    const value = dataRow[i] || '';
    const normalizedIncomingHeader = normalizeHeader(header);

    // Try exact match first
    if (header in mapping) {
      const dest = mapping[header];

      if (Array.isArray(dest)) {
        // Handle lat/long pairs (Airtel)
        const [lat, lon] = parseLatLong(value);
        setTowerField(normalized, dest[0] as keyof NormalizedTowerDump, lat);
        setTowerField(normalized, dest[1] as keyof NormalizedTowerDump, lon);
      } else {
        setTowerField(normalized, dest as keyof NormalizedTowerDump, cleanValue(dest, value));
      }
    } else {
      // Try case-insensitive match
      const normalizedHeader = header.toLowerCase().trim();
      const mappingKey = mappingKeys.find(k => k.toLowerCase().trim() === normalizedHeader);
      const normalizedMappingKey = mappingKey || mappingKeys.find(k => normalizeHeader(k) === normalizedIncomingHeader);
      const fuzzyMappingKey = normalizedMappingKey || mappingKeys.find(k => {
        const norm = normalizeHeader(k);
        return (
          (normalizedIncomingHeader.length >= 4 && norm.includes(normalizedIncomingHeader)) ||
          (norm.length >= 4 && normalizedIncomingHeader.includes(norm))
        );
      });
      if (fuzzyMappingKey) {
        const dest = mapping[fuzzyMappingKey];

        if (Array.isArray(dest)) {
          // Handle lat/long pairs (Airtel)
          const [lat, lon] = parseLatLong(value);
          setTowerField(normalized, dest[0] as keyof NormalizedTowerDump, lat);
          setTowerField(normalized, dest[1] as keyof NormalizedTowerDump, lon);
        } else {
          setTowerField(normalized, dest as keyof NormalizedTowerDump, cleanValue(dest, value));
        }
      } else {
        applyTowerGeoFallback(normalized, normalizedIncomingHeader, value);
      }
    }
  }

  return normalized;
};

// Debug function to test parsing
export const debugParseTowerDump = (content: string, maxLines: number = 20): void => {
  const lines = content.split('\n').filter(line => line.trim());
  towerParseLog(`[DEBUG] Total lines: ${lines.length}`);
  towerParseLog(`[DEBUG] First ${maxLines} lines:`, lines.slice(0, maxLines));
};

type HeaderResolver = {
  dest?: string | string[];
  normalizedHeader: string;
};

const buildHeaderResolvers = (operator: string, headerRow: string[]): HeaderResolver[] => {
  const { mapping, lowerMap, normalizedMap, normalizedKeys } = getOperatorLookup(operator);

  return headerRow.map((header) => {
    const direct = mapping[header];
    const normalizedHeader = normalizeHeader(header);
    if (direct) {
      return { dest: direct, normalizedHeader };
    }

    const lower = header.toLowerCase().trim();
    const exactLower = lowerMap.get(lower);
    if (exactLower) {
      return { dest: exactLower, normalizedHeader };
    }

    const exactNormalized = normalizedMap.get(normalizedHeader);
    if (exactNormalized) {
      return { dest: exactNormalized, normalizedHeader };
    }

    let fuzzyDest: string | string[] | undefined;
    for (const { key, norm } of normalizedKeys) {
      if (
        (normalizedHeader.length >= 4 && norm.includes(normalizedHeader)) ||
        (norm.length >= 4 && normalizedHeader.includes(norm))
      ) {
        fuzzyDest = mapping[key];
        break;
      }
    }

    return { dest: fuzzyDest, normalizedHeader };
  });
};

const normalizeTowerDumpRowFast = (
  operator: string,
  headerResolvers: HeaderResolver[],
  dataRow: string[]
): NormalizedTowerDump => {
  const normalized: NormalizedTowerDump = { operator };

  for (let i = 0; i < headerResolvers.length; i++) {
    const resolver = headerResolvers[i];
    const value = dataRow[i] || '';
    const dest = resolver.dest;

    if (dest) {
      if (Array.isArray(dest)) {
        const [lat, lon] = parseLatLong(value);
        setTowerField(normalized, dest[0] as keyof NormalizedTowerDump, lat);
        setTowerField(normalized, dest[1] as keyof NormalizedTowerDump, lon);
      } else {
        setTowerField(normalized, dest as keyof NormalizedTowerDump, cleanValue(dest, value));
      }
    } else {
      applyTowerGeoFallback(normalized, resolver.normalizedHeader, value);
    }
  }

  return normalized;
};
export const parseTowerDumpCsv = (content: string, operator?: string): NormalizedTowerDump[] => {
  const lines = content.split('\n').filter(line => line.trim());

  towerParseLog(`[Tower Dump Parser] Total lines in file: ${lines.length}`);
  towerParseLog(`[Tower Dump Parser] First 10 lines:`, lines.slice(0, 10).map((line, i) => `Line ${i+1}: "${line.substring(0, 100)}..."`));

  // Find the actual header row by looking for rows that contain typical header keywords
  // Skip title/metadata rows that contain colons or are too short
  let headerRowIndex = -1;
  const headerKeywords = ['telephone', 'number', 'cell', 'date', 'time', 'duration', 'type', 'imei', 'imsi', 'circle', 'party'];
  const delimiters = [',', '|', ';', '\t'];

  towerParseLog(`[Tower Dump Parser] Starting header detection with keywords:`, headerKeywords);

  for (let i = 0; i < Math.min(lines.length, 50); i++) { // Check first 50 lines
    const line = lines[i].trim();
    if (!line) {
      towerParseLog(`[Tower Dump Parser] Line ${i+1}: empty, skipping`);
      continue;
    }

    // Skip lines that look like metadata (contain colons or are very short)
    if (line.includes(':') && !delimiters.some(delim => line.split(delim).length >= 10)) {
      towerParseLog(`[Tower Dump Parser] Line ${i+1}: contains colon or too short, skipping`);
      continue;
    }

    towerParseLog(`[Tower Dump Parser] Line ${i+1}: checking for header keywords`);

    // Try different delimiters
    for (const delim of delimiters) {
      const cols = line.split(delim).map(c => c.trim().replace(/^['"]|['"]$/g, '')).filter(c => c.length > 0);
      if (cols.length < 10) {
        towerParseLog(`[Tower Dump Parser] Line ${i+1}, delim '${delim}': only ${cols.length} columns, need >= 10`);
        continue; // Need at least 10 columns
      }

      // Check if this looks like a header row (contains header keywords)
      const lowerCols = cols.map(c => c.toLowerCase());
      const keywordMatches = headerKeywords.filter(keyword =>
        lowerCols.some(col => col.includes(keyword))
      );

      towerParseLog(`[Tower Dump Parser] Line ${i+1}, delim '${delim}': ${cols.length} columns, keyword matches:`, keywordMatches);

      if (keywordMatches.length >= 3) { // At least 3 header keywords match
        headerRowIndex = i;
        towerParseLog(`[Tower Dump Parser] Found header row at line ${i+1} with ${cols.length} columns using delimiter '${delim === '\t' ? '\\t' : delim}'`);
        towerParseLog(`[Tower Dump Parser] Header columns:`, cols.slice(0, 5), '...');
        towerParseLog(`[Tower Dump Parser] Matched keywords:`, keywordMatches);
        break;
      }
    }

    if (headerRowIndex !== -1) break; // Found it
  }

  if (headerRowIndex === -1) {
    // Fallback to old method if no header found
    towerParseLog(`[Tower Dump Parser] No header found with keywords, falling back to column count method`);
    let maxColumns = 0;
    for (let i = 0; i < Math.min(lines.length, 50); i++) {
      const line = lines[i].trim();
      if (!line || line.includes(':')) continue;

      for (const delim of delimiters) {
        const cols = line.split(delim).map(c => c.trim().replace(/^['"]|['"]$/g, '')).filter(c => c.length > 0);
        if (cols.length > maxColumns && cols.length >= 10) {
          maxColumns = cols.length;
          headerRowIndex = i;
          towerParseLog(`[Tower Dump Parser] Fallback: Found row ${i+1} with ${cols.length} columns`);
        }
      }
    }
  }

  if (headerRowIndex === -1) {
    throw new Error('Could not find header row with sufficient columns or header keywords');
  }

  towerParseLog(`[Tower Dump Parser] Using row ${headerRowIndex + 1} as headers`);

  // Use the delimiter that worked for header detection
  let bestDelimiter = ',';
  let headers: string[] = [];

  for (const delim of delimiters) {
    const cols = lines[headerRowIndex].split(delim).map(h => h.trim().replace(/^['"]|['"]$/g, '')).filter(h => h.length > 0);
    if (cols.length >= 10) {
      // Check if it has header keywords
      const lowerCols = cols.map(c => c.toLowerCase());
      const keywordMatches = headerKeywords.filter(keyword =>
        lowerCols.some(col => col.includes(keyword))
      );
      if (keywordMatches.length >= 3) {
        bestDelimiter = delim;
        headers = cols;
        break;
      }
    }
  }

  towerParseLog(`[Tower Dump Parser] Final delimiter: '${bestDelimiter === '\t' ? '\\t' : bestDelimiter}', headers:`, headers.slice(0, 5), '...');

  // Auto-detect operator if not provided
  let detectedOperator: string = operator || '';
  if (!detectedOperator) {
    const autoDetected = detectOperator(headers);
    if (!autoDetected) {
      throw new Error('Could not auto-detect operator. Please specify operator explicitly.');
    }
    detectedOperator = autoDetected;
    towerParseLog(`[Tower Dump Parser] Auto-detected operator: ${detectedOperator}`);
  }

  const results: NormalizedTowerDump[] = [];
  const headerResolvers = buildHeaderResolvers(detectedOperator, headers);

  // Parse data rows (start from row after headers)
  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      towerParseLog(`[Tower Dump Parser] Skipping empty line ${i + 1}`);
      continue;
    }

    const values = line.split(bestDelimiter).map(v => {
      const trimmed = v.trim();
      // Remove surrounding quotes (single or double)
      if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || 
          (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
        return trimmed.slice(1, -1);
      }
      return trimmed;
    });
    towerParseLog(`[Tower Dump Parser] Line ${i + 1}: ${values.length} values, first few:`, values.slice(0, 3));
    
    if (values.length !== headers.length) {
      towerParseWarn(`[Tower Dump Parser] Line ${i + 1}: expected ${headers.length} columns, got ${values.length}. Raw line: "${line}"`);
      towerParseWarn(`[Tower Dump Parser] Parsed values:`, values);
      // Try to handle mismatched columns by padding or truncating
      if (values.length > headers.length) {
        // Too many columns - might be commas in data, try to merge
        towerParseWarn(`[Tower Dump Parser] Attempting to fix by truncating extra columns`);
        values.splice(headers.length);
      } else if (values.length < headers.length) {
        // Too few columns - pad with empty strings
        towerParseWarn(`[Tower Dump Parser] Padding with empty values`);
        while (values.length < headers.length) {
          values.push('');
        }
      }
    }

    try {
      const normalized = normalizeTowerDumpRowFast(detectedOperator, headerResolvers, values);
      results.push(normalized);
    } catch (error) {
      towerParseWarn(`[Tower Dump Parser] Error parsing row ${i + 1}:`, error);
      towerParseWarn(`[Tower Dump Parser] Row data:`, { headers, values });
      // Continue processing other rows instead of failing completely
    }
  }

  towerParseLog(`[Tower Dump Parser] Successfully parsed ${results.length} records out of ${lines.length - headerRowIndex - 1} data rows`);
  return results;
};
