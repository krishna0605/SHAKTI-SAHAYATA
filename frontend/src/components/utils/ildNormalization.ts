import mappingData from './mappings/ildMapping.json';

export type ILDOperator = 'JIO';

export interface NormalizedILD {
  operator: string;
  call_time?: string;
  call_date?: string;
  calling_party_number?: string;
  called_party_number?: string;
  call_duration_sec?: number;
  orig_switch_id?: string;
  term_switch_id?: string;
  org_trunc_group?: string;
  term_trunc_group?: string;
  call_direction?: string;
  call_type?: string;
  orig_carr_name?: string;
  term_carr_name?: string;
  call_status?: string;
  first_cell_id?: string;
  last_cell_id?: string;
  circle?: string;
  carrier?: string;
  operator_name?: string;
  lrn?: string;
}

const RAW_ILD_MAPPING = mappingData as unknown as Record<string, string[] | Record<string, keyof NormalizedILD>>;
const ILD_CANONICAL_FIELD_MAP: Record<string, keyof NormalizedILD> = {
  'calling no': 'calling_party_number',
  'called no': 'called_party_number',
  'date': 'call_date',
  'time': 'call_time',
  'dur(s)': 'call_duration_sec',
  'duration of call': 'call_duration_sec',
  'call type': 'call_type',
  'first cell id': 'first_cell_id',
  'last cell id': 'last_cell_id',
  'first roaming network circle id': 'circle',
  'originating switch id': 'orig_switch_id',
  'terminating switch id': 'term_switch_id',
  'incoming trunk id': 'org_trunc_group',
  'outgoing trunk id': 'term_trunc_group',
  'incoming operator': 'orig_carr_name',
  'outgoing operator': 'term_carr_name',
  'call status': 'call_status',
  'lrn': 'lrn'
};

function buildIldAliasMap(source: Record<string, string[] | Record<string, keyof NormalizedILD>>): Record<string, keyof NormalizedILD> {
  const aliasMap: Record<string, keyof NormalizedILD> = {};
  for (const [canonical, aliases] of Object.entries(source)) {
    const field = ILD_CANONICAL_FIELD_MAP[canonical.toLowerCase().trim()];
    if (!field || !Array.isArray(aliases)) continue;
    aliasMap[normalizeHeader(canonical)] = field;
    aliases.forEach((alias) => {
      aliasMap[normalizeHeader(alias)] = field;
    });
  }
  return aliasMap;
}

const JIO_ILD_MAP: Record<string, keyof NormalizedILD> =
  'JIO' in RAW_ILD_MAPPING && !Array.isArray(RAW_ILD_MAPPING.JIO)
    ? (RAW_ILD_MAPPING.JIO as Record<string, keyof NormalizedILD>)
    : buildIldAliasMap(RAW_ILD_MAPPING);

function parseNumber(value: string | undefined): number | undefined {
  if (!value || value === '-' || value === '') return undefined;
  const num = parseFloat(value.replace(/,/g, ''));
  return isNaN(num) ? undefined : num;
}

function parseCSVLine(line: string, delimiter: string = ','): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      let value = current.trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1);
      }
      result.push(value);
      current = '';
    } else {
      current += char;
    }
  }
  let value = current.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  result.push(value);
  return result;
}

function normalizeHeader(header: string): string {
  return header
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .toUpperCase();
}

function detectDelimiter(lines: string[]): string {
  const delimiters = [',', '|', ';', '\t'];
  const keywords = ['call_date', 'call time', 'calling_party', 'called_party', 'call_duration'];
  let bestDelimiter = ',';
  let bestScore = -1;

  for (let i = 0; i < Math.min(20, lines.length); i++) {
    for (const delimiter of delimiters) {
      const columns = parseCSVLine(lines[i], delimiter);
      if (columns.length < 4) continue;
      const sample = columns.join(' ').toLowerCase();
      const score = keywords.filter(keyword => sample.includes(keyword)).length;
      if (score > bestScore || (score === bestScore && columns.length > parseCSVLine(lines[i], bestDelimiter).length)) {
        bestScore = score;
        bestDelimiter = delimiter;
      }
    }
  }

  return bestDelimiter;
}

function findHeaderRow(lines: string[], delimiter: string): number {
  const keywords = ['call_date', 'call time', 'calling_party', 'called_party', 'call_duration'];

  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const columns = parseCSVLine(lines[i], delimiter);
    if (columns.length < 5) continue;

    const lineLower = lines[i].toLowerCase();
    const matchCount = keywords.filter(keyword => lineLower.includes(keyword)).length;
    if (matchCount >= 2) {
      return i;
    }
  }
  return 0;
}

function findMappedField(mapping: Record<string, keyof NormalizedILD>, header: string): keyof NormalizedILD | undefined {
  const normalizedKey = normalizeHeader(header);
  if (mapping[normalizedKey]) return mapping[normalizedKey];

  const keys = Object.keys(mapping);
  const exactKey = keys.find(key => normalizeHeader(key) === normalizedKey);
  if (exactKey) return mapping[exactKey];

  const fuzzyKey = keys.find(key => {
    const norm = normalizeHeader(key);
    return (
      (normalizedKey.length >= 4 && norm.includes(normalizedKey)) ||
      (norm.length >= 4 && normalizedKey.includes(norm))
    );
  });
  if (fuzzyKey) return mapping[fuzzyKey];

  return undefined;
}

export function parseILD(csvContent: string, operator: ILDOperator): NormalizedILD[] {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim());

  if (lines.length < 2) {
    return [];
  }

  const delimiter = detectDelimiter(lines);
  const headerRowIndex = findHeaderRow(lines, delimiter);
  const rawHeaders = parseCSVLine(lines[headerRowIndex], delimiter);
  const mapping = JIO_ILD_MAP;

  const headerMapping: { index: number; field: keyof NormalizedILD }[] = [];

  rawHeaders.forEach((header, index) => {
    const mappedField = findMappedField(mapping, header);
    if (mappedField) {
      headerMapping.push({ index, field: mappedField });
    }
  });

  const records: NormalizedILD[] = [];

  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const values = parseCSVLine(line, delimiter);
    if (values.length < 2) continue;

    const record: NormalizedILD = { operator: operator.toUpperCase() };

    const setField = <K extends keyof NormalizedILD>(target: NormalizedILD, key: K, val: NormalizedILD[K]) => {
      target[key] = val;
    };

    headerMapping.forEach(({ index, field }) => {
      const value = values[index]?.trim();
      if (!value || value === '-' || value === '') return;

      if (field === 'call_duration_sec') {
        const numValue = parseNumber(value);
        if (numValue !== undefined) {
          record.call_duration_sec = numValue;
        }
      } else {
        setField(record, field, value as NormalizedILD[typeof field]);
      }
    });

    if (record.calling_party_number || record.called_party_number || record.call_date || record.call_time || record.call_duration_sec) {
      records.push(record);
    }
  }

  return records;
}

export const ILD_OPERATORS: { value: ILDOperator; label: string }[] = [
  { value: 'JIO', label: 'Jio' }
];
