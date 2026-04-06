/**
 * CDR Normalization - Multi-operator CSV parsing
 * Supports Vodafone, Airtel, BSNL, Jio formats with auto-detection
 */

import mappingData from './mappings/cdrMapping.json';

export interface NormalizedCDR {
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
  file_id?: number;
  file_index?: number;
  file_name?: string;
}

export type Operator = 'VODAFONE' | 'AIRTEL' | 'BSNL' | 'JIO';

const RAW_UNIVERSAL_MAP = mappingData as Record<string, string | string[]>;
const CANONICAL_CDR_FIELD_MAP: Record<string, keyof NormalizedCDR | [keyof NormalizedCDR, keyof NormalizedCDR]> = {
  'calling no': 'a_party',
  'called no': 'b_party',
  'date': 'call_date',
  'time': 'call_start_time',
  'call date': 'call_date',
  'call time': 'call_start_time',
  'start time': 'call_start_time',
  'call start time': 'call_start_time',
  'date time': 'call_start_time',
  'datetime': 'call_start_time',
  'timestamp': 'call_start_time',
  'duration of call': 'duration_sec',
  'dur(s)': 'duration_sec',
  'call type': 'call_type',
  'first cell id': 'first_cell_id',
  'last cell id': 'last_cell_id',
  'imei': 'imei',
  'imsi': 'imsi',
  'roaming circle': 'roaming_circle',
  'type of connection': 'service_type',
  'lac': 'lrn_lsa',
  'lrn': 'lrn_b_party_number',
  'call forward': 'call_forwarding_number'
};

const normalizeMappingHeaderKey = (header: string): string => {
  return header.toLowerCase().trim()
    .replace(/[_\-()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const UNIVERSAL_MAP: Record<string, keyof NormalizedCDR | [keyof NormalizedCDR, keyof NormalizedCDR]> = {};

Object.entries(RAW_UNIVERSAL_MAP).forEach(([key, value]) => {
  const canonicalField = CANONICAL_CDR_FIELD_MAP[key.toLowerCase().trim()];

  // Alias-list schema: "Calling No": ["A Party", ...]
  if (Array.isArray(value) && canonicalField) {
    UNIVERSAL_MAP[key.toLowerCase().trim()] = canonicalField;
    value.forEach(alias => {
      UNIVERSAL_MAP[normalizeMappingHeaderKey(alias)] = canonicalField;
    });
    return;
  }

  // Direct schema fallback (if present in future)
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string' && !canonicalField) {
    UNIVERSAL_MAP[key] = [value[0] as keyof NormalizedCDR, value[1] as keyof NormalizedCDR];
    return;
  }

  if (typeof value === 'string') {
    UNIVERSAL_MAP[key] = value as keyof NormalizedCDR;
  }
});

export const OPERATOR_MAPS: Record<Operator, typeof UNIVERSAL_MAP> = {
  "VODAFONE": UNIVERSAL_MAP,
  "AIRTEL": UNIVERSAL_MAP,
  "BSNL": UNIVERSAL_MAP,
  "JIO": UNIVERSAL_MAP,
};

// Helper to parse lat/long string
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

// Helper to parse duration (HH:MM:SS or seconds)
const parseDuration = (val: string): number => {
  if (!val || val.trim() === '') return 0;
  const cleanVal = val.trim();
  
  // Already a number
  if (!isNaN(Number(cleanVal))) return parseInt(cleanVal) || 0;
  
  // HH:MM:SS format
  const parts = cleanVal.split(':');
  if (parts.length === 3) {
    const h = parseInt(parts[0]) || 0;
    const m = parseInt(parts[1]) || 0;
    const s = parseInt(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseInt(parts[0]) || 0;
    const s = parseInt(parts[1]) || 0;
    return m * 60 + s;
  }
  
  return parseInt(cleanVal) || 0;
};

const stripOuterQuotes = (val: string): string => {
  const text = String(val ?? '').trim();
  if (!text) return '';
  // Remove a single pair of surrounding quotes (single or double).
  const m = text.match(/^(['"])([\s\S]*)\1$/);
  return m ? m[2].trim() : text;
};

// Excel serial date (days since 1899-12-30) heuristic.
const tryParseExcelSerialDate = (raw: string): string | null => {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 20000 || n > 90000) return null;
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(n) * 24 * 60 * 60 * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const normalizeDateString = (raw: string): string => {
  const text = stripOuterQuotes(raw);
  if (!text) return '';
  const excel = tryParseExcelSerialDate(text);
  if (excel) return excel;

  // Common formats: dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd
  const m1 = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m1) {
    const dd = m1[1].padStart(2, '0');
    const mm = m1[2].padStart(2, '0');
    const yyyy = m1[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  const m2 = text.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (m2) {
    const yyyy = m2[1];
    const mm = m2[2].padStart(2, '0');
    const dd = m2[3].padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return text;
};

const normalizeTimeString = (raw: string): string => {
  const text = stripOuterQuotes(raw);
  if (!text) return '';
  // HH:MM[:SS]
  const m1 = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m1) {
    const hh = m1[1].padStart(2, '0');
    const mm = m1[2];
    const ss = (m1[3] || '00').padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  // HHMM[SS]
  const m2 = text.match(/^(\d{2})(\d{2})(\d{2})?$/);
  if (m2) {
    const hh = m2[1];
    const mm = m2[2];
    const ss = (m2[3] || '00').padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return text;
};

const setField = <K extends keyof NormalizedCDR>(
  target: Partial<NormalizedCDR>,
  key: K,
  value: NormalizedCDR[K]
): void => {
  target[key] = value;
};

const parseDelimitedLine = (line: string, delimiter: string): string[] => {
  const row: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(current.trim().replace(/^"|"$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }

  row.push(current.trim().replace(/^"|"$/g, ''));
  return row;
};

// Normalize header for matching (lowercase, trim, remove special chars)
const normalizeHeader = (header: string): string => {
  return header.toLowerCase().trim()
    .replace(/[_\-()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

// Find mapping for a header (flexible matching)
const findMapping = (header: string): keyof NormalizedCDR | [keyof NormalizedCDR, keyof NormalizedCDR] | null => {
  const normalizedHeader = normalizeHeader(header);
  
  // Direct match
  if (UNIVERSAL_MAP[normalizedHeader]) {
    return UNIVERSAL_MAP[normalizedHeader];
  }
  
  // Try each key
  for (const key of Object.keys(UNIVERSAL_MAP)) {
    // Exact match after normalization
    if (normalizedHeader === key) {
      return UNIVERSAL_MAP[key];
    }
    // Header contains key
    if (normalizedHeader.includes(key)) {
      return UNIVERSAL_MAP[key];
    }
    // Key contains header (for short headers like "imei")
    if (key.includes(normalizedHeader) && normalizedHeader.length >= 3) {
      return UNIVERSAL_MAP[key];
    }
  }
  
  return null;
};

// Parse CSV content and return normalized records
export const parseCSV = (csvContent: string, operator: Operator): NormalizedCDR[] => {
  console.log(`[CDR Parser] ======= STARTING PARSE =======`);
  console.log(`[CDR Parser] Operator: ${operator}`);
  console.log(`[CDR Parser] Content length: ${csvContent.length} chars`);
  
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim() !== '');
  console.log(`[CDR Parser] Total lines: ${lines.length}`);
  
  if (lines.length < 2) {
    console.error('[CDR Parser] CSV has less than 2 lines!');
    return [];
  }

  // Find header row and best delimiter (comma/pipe/semicolon/tab)
  let headerRowIndex = 0;
  let delimiter = ',';
  const headerKeywords = ['target', 'party', 'call', 'date', 'time', 'duration', 'imei', 'imsi', 'cell', 'cgi', 'mobile'];
  let bestScore = -1;
  const delimiters = [',', '|', ';', '\t'];
  
  for (let i = 0; i < Math.min(15, lines.length); i++) {
    for (const candidateDelimiter of delimiters) {
      const cols = parseDelimitedLine(lines[i], candidateDelimiter);
      if (cols.length < 5) continue;

      const lineLower = cols.join(' ').toLowerCase();
      const matchCount = headerKeywords.filter(keyword => lineLower.includes(keyword)).length;

      if (matchCount > bestScore) {
        bestScore = matchCount;
        headerRowIndex = i;
        delimiter = candidateDelimiter;
      }

      if (matchCount >= 3) {
        headerRowIndex = i;
        delimiter = candidateDelimiter;
        bestScore = matchCount;
        console.log(`[CDR Parser] Found header row at line ${i + 1} using delimiter '${candidateDelimiter === '\t' ? '\\t' : candidateDelimiter}' (matched ${matchCount} keywords)`);
        break;
      }
    }
    if (bestScore >= 3) break;
  }

  console.log(`[CDR Parser] Using line ${headerRowIndex + 1} as header row`);
  console.log(`[CDR Parser] Using delimiter: '${delimiter === '\t' ? '\\t' : delimiter}'`);
  
  // Parse headers
  const rawHeaders = parseDelimitedLine(lines[headerRowIndex], delimiter);
  console.log(`[CDR Parser] Raw headers (${rawHeaders.length}):`, rawHeaders);
  
  // Build header to field mapping
  const headerToField: Record<number, keyof NormalizedCDR | [keyof NormalizedCDR, keyof NormalizedCDR]> = {};
  const mappedHeaders: string[] = [];
  const unmappedHeaders: string[] = [];
  
  rawHeaders.forEach((header, index) => {
    const field = findMapping(header);
    if (field) {
      headerToField[index] = field;
      mappedHeaders.push(`"${header}" -> ${JSON.stringify(field)}`);
    } else {
      unmappedHeaders.push(header);
    }
  });

  console.log(`[CDR Parser] Mapped ${mappedHeaders.length} columns:`);
  mappedHeaders.forEach(m => console.log(`  - ${m}`));
  
  if (unmappedHeaders.length > 0) {
    console.log(`[CDR Parser] Unmapped columns (${unmappedHeaders.length}):`, unmappedHeaders.join(', '));
  }

  if (mappedHeaders.length === 0) {
    console.error('[CDR Parser] NO COLUMNS MAPPED! Headers might not match expected format.');
    console.log('[CDR Parser] Please check if headers match: a party, b party, call type, date, time, duration, imei, imsi, cell id, etc.');
    return [];
  }

  const results: NormalizedCDR[] = [];

  // Start parsing data rows after the header row
  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    const row = parseDelimitedLine(line, delimiter);
    
    if (row.length <= 1 || row.every(v => !v)) continue; // Skip empty rows

    const normalized: Partial<NormalizedCDR> = { operator };

    Object.entries(headerToField).forEach(([indexStr, field]) => {
      const index = parseInt(indexStr);
      const value = row[index] || '';
      
      if (!value || value === 'NULL' || value === 'null' || value === '-' || value === 'NA') return;

      if (Array.isArray(field)) {
        // Tuple case for lat/long
        const [lat, lng] = parseLatLong(value);
        if (lat !== undefined) setField(normalized, field[0], lat);
        if (lng !== undefined) setField(normalized, field[1], lng);
      } else {
        // Single field
        if (field === 'duration_sec') {
          setField(normalized, field, parseDuration(value));
        } else if (field.includes('port')) {
          setField(normalized, field, parseInt(value) || undefined);
        } else if (field.includes('lat') || field.includes('long')) {
          setField(normalized, field, parseFloat(value) || undefined);
        } else {
          const cleaned = stripOuterQuotes(value);
          if (field === 'call_date') setField(normalized, field, normalizeDateString(cleaned));
          else if (field === 'call_start_time') setField(normalized, field, normalizeTimeString(cleaned));
          else setField(normalized, field, cleaned);
        }
      }
    });

    // If we mapped a combined datetime into call_start_time, split date/time when possible.
    if (!normalized.call_date && normalized.call_start_time) {
      const dt = String(normalized.call_start_time);
      const iso = dt.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{1,2}:\d{2}(?::\d{2})?)/);
      if (iso) {
        normalized.call_date = iso[1];
        normalized.call_start_time = normalizeTimeString(iso[2]);
      }
    }

    // Include if we have at least some data
    if (normalized.a_party || normalized.b_party || normalized.imei || normalized.first_cell_id) {
      results.push(normalized as NormalizedCDR);
    }
  }

  console.log(`[CDR Parser] Parsed ${results.length} valid records`);
  if (results.length > 0) {
    console.log('[CDR Parser] Sample record:', JSON.stringify(results[0], null, 2));
  } else {
    console.error('[CDR Parser] NO RECORDS PARSED! First few data rows:');
    for (let i = 1; i < Math.min(4, lines.length); i++) {
      console.log(`  Row ${i}: ${lines[i].substring(0, 200)}`);
    }
  }
  console.log(`[CDR Parser] ======= PARSE COMPLETE =======`);

  return results;
};

// Alias
export const normalizeCSV = parseCSV;
