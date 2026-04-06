// IPDR Normalization Utilities
// Supports: VLI, Airtel, Type3 (ISP)
// Updated to use exact case-sensitive header matching

import mappingData from './mappings/ipdrMapping.json';

export type IPDROperator = 'VLI' | 'AIRTEL' | 'TYPE3';
export type IpInfo = Record<string, unknown>;

export interface NormalizedIPDR {
  operator: string;
  record_id?: string;

  // Subscriber / person info
  subscriber_name?: string;
  subscriber_address?: string;
  subscriber_contact?: string;
  subscriber_alt_contact?: string;
  subscriber_email?: string;
  subscriber_msisdn?: string;
  subscriber_alt_id?: string;
  subscriber_user_id?: string;

  // Device / SIM
  imei?: string;
  imsi?: string;
  mac_id?: string;
  sim_type?: string;
  pre_post?: string;

  // Circles / roaming
  roaming_circle?: string;
  roaming_circle_indicator?: string;
  icr_operator_name?: string;
  home_circle?: string;

  // IPs & ports
  source_ip?: string;
  source_ip_private_v4?: string;
  source_ip_public_v4?: string;
  source_ip_public_v6?: string;
  source_port?: string;
  source_private_port?: string;
  source_public_port?: string;

  destination_ip?: string;
  destination_ip_v4?: string;
  destination_ip_v6?: string;
  destination_port?: string;

  translated_ip?: string;
  translated_port?: string;
  ip_allocation_type?: string;
  ip_type?: string;
  source_ip_info?: IpInfo | null;
  destination_ip_info?: IpInfo | null;
  translated_ip_info?: IpInfo | null;

  // Time fields
  session_start_time?: string;
  session_end_time?: string;
  event_start_time?: string;
  allocation_start_time?: string;
  allocation_end_time?: string;
  allocation_start_date?: string;
  allocation_end_date?: string;

  // Usage / duration
  duration_sec?: number;
  data_volume_uplink?: number;
  data_volume_downlink?: number;

  // Core network
  pgw_ip?: string;
  apn?: string;
  pdp_address_ipv4?: string;
  pdp_address_ipv6?: string;
  pdp_type?: string;

  // Radio / cell
  first_cell_id?: string;
  last_cell_id?: string;
  first_cell_name_location?: string;
  cgi?: string;
  cgi_lat?: number;
  cgi_long?: number;
  rat?: string;
  esim_flag?: string;
  access_tech?: string;

  // Charging
  charging_id?: string;

  // File tracking
  file_index?: number;
  file_name?: string;
}

const RAW_IPDR_MAP = mappingData as Record<string, string[]>;
const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const FIELD_KEYS: Array<keyof NormalizedIPDR> = [
  'operator',
  'record_id',
  'subscriber_name',
  'subscriber_address',
  'subscriber_contact',
  'subscriber_alt_contact',
  'subscriber_email',
  'subscriber_msisdn',
  'subscriber_alt_id',
  'subscriber_user_id',
  'imei',
  'imsi',
  'mac_id',
  'sim_type',
  'pre_post',
  'roaming_circle',
  'roaming_circle_indicator',
  'icr_operator_name',
  'home_circle',
  'source_ip',
  'source_ip_private_v4',
  'source_ip_public_v4',
  'source_ip_public_v6',
  'source_port',
  'source_private_port',
  'source_public_port',
  'destination_ip',
  'destination_ip_v4',
  'destination_ip_v6',
  'destination_port',
  'translated_ip',
  'translated_port',
  'ip_allocation_type',
  'ip_type',
  'source_ip_info',
  'destination_ip_info',
  'translated_ip_info',
  'session_start_time',
  'session_end_time',
  'event_start_time',
  'allocation_start_time',
  'allocation_end_time',
  'allocation_start_date',
  'allocation_end_date',
  'duration_sec',
  'data_volume_uplink',
  'data_volume_downlink',
  'pgw_ip',
  'apn',
  'pdp_address_ipv4',
  'pdp_address_ipv6',
  'pdp_type',
  'first_cell_id',
  'last_cell_id',
  'first_cell_name_location',
  'cgi',
  'cgi_lat',
  'cgi_long',
  'rat',
  'esim_flag',
  'access_tech',
  'charging_id',
  'file_index',
  'file_name'
];
const FIELD_ALIASES: Record<string, keyof NormalizedIPDR> = {
  msisdn_user_id: 'subscriber_msisdn',
  name: 'subscriber_name',
  address: 'subscriber_address',
  contact_no: 'subscriber_contact',
  contact_number: 'subscriber_contact',
  alternate_contact_no: 'subscriber_alt_contact',
  alternate_contact_number: 'subscriber_alt_contact',
  e_mail_address: 'subscriber_email',
  email_address: 'subscriber_email',
  source_ip_address: 'source_ip',
  destination_ip_address: 'destination_ip',
  translated_ip_address: 'translated_ip',
  source_port_address: 'source_port',
  destination_port_address: 'destination_port',
  translated_port_address: 'translated_port',
  start_date_time: 'session_start_time',
  end_date_time: 'session_end_time',
  session_start: 'session_start_time',
  session_end: 'session_end_time',
  allocation_start: 'allocation_start_time',
  allocation_end: 'allocation_end_time',
  static_dynamic_ip_address_allocation: 'ip_allocation_type',
  uplink_data_volume: 'data_volume_uplink',
  downlink_data_volume: 'data_volume_downlink',
  upload_volume: 'data_volume_uplink',
  download_volume: 'data_volume_downlink',
  upload_data: 'data_volume_uplink',
  download_data: 'data_volume_downlink',
  data_uploaded: 'data_volume_uplink',
  data_downloaded: 'data_volume_downlink',
  access_point_name: 'apn',
  pgw_ip_address: 'pgw_ip',
  session_duration_seconds: 'duration_sec',
  duration_seconds: 'duration_sec',
  duration_in_sec: 'duration_sec',
  source_public_ipv4: 'source_ip_public_v4',
  source_public_ipv6: 'source_ip_public_v6',
  source_private_ipv4: 'source_ip_private_v4',
  source_handset_port: 'source_private_port',
  source_public_port: 'source_public_port',
  ist_start_time_of_public_ip_address_allocation_hh_mm_ss: 'allocation_start_time',
  ist_end_time_of_public_ip_address_allocation_hh_mm_ss: 'allocation_end_time',
  start_date_of_public_ip_address_allocation_dd_mm_yyyy: 'allocation_start_date',
  end_date_of_public_ip_address_allocation_dd_mm_yyyy: 'allocation_end_date',
  roaming: 'roaming_circle',
  esim: 'esim_flag',
  cgi_latitude: 'cgi_lat',
  cgi_longitude: 'cgi_long'
};
const FIELD_LOOKUP: Record<string, keyof NormalizedIPDR> = {
  ...Object.fromEntries(FIELD_KEYS.map(key => [key, key])),
  ...FIELD_ALIASES
};
const buildHeaderMap = (): Record<string, keyof NormalizedIPDR> => {
  const headerMap: Record<string, keyof NormalizedIPDR> = {};
  Object.entries(RAW_IPDR_MAP).forEach(([label, variants]) => {
    const normalized = normalizeKey(label);
    const field = FIELD_LOOKUP[normalized];
    if (!field) return;
    const allHeaders = [label, ...variants];
    allHeaders.forEach(header => {
      headerMap[header] = field;
      headerMap[header.toLowerCase()] = field;
    });
  });
  return headerMap;
};
const IPDR_BASE_MAP = buildHeaderMap();
const IPDR_MAPS: Record<string, Record<string, keyof NormalizedIPDR>> = {
  VLI: IPDR_BASE_MAP,
  AIRTEL: IPDR_BASE_MAP,
  TYPE3: IPDR_BASE_MAP
};
const VLI_IPDR_MAP = IPDR_MAPS.VLI;

// Parse numeric value
function parseNumber(value: string | undefined): number | undefined {
  if (!value || value === '-' || value === '') return undefined;
  const num = parseFloat(value.replace(/,/g, ''));
  return isNaN(num) ? undefined : num;
}

// Parse CSV with quoted values
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' || char === "'") {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      let value = current.trim();
      // Remove surrounding quotes
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
  // Remove surrounding quotes
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.slice(1, -1);
  } else if (value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  result.push(value);
  return result;
}

// Find header row in CSV (skip metadata rows)
function findHeaderRow(lines: string[]): number {
  const ipdrKeywords = ['imsi', 'imei', 'msisdn', 'session', 'ip', 'source', 'destination', 'duration', 'uplink', 'downlink'];
  
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const lineLower = lines[i].toLowerCase();
    const columnCount = lines[i].split(',').length;
    
    if (columnCount < 5) continue;
    
    const matchCount = ipdrKeywords.filter(keyword => lineLower.includes(keyword)).length;
    if (matchCount >= 3) {
      console.log(`[IPDR Parser] Found header row at line ${i + 1} (matched ${matchCount} keywords)`);
      return i;
    }
  }
  return 0;
}

// Main IPDR parsing function
export function parseIPDR(csvContent: string, operator: IPDROperator): NormalizedIPDR[] {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim());
  
  if (lines.length < 2) {
    console.warn('[IPDR Parser] File has fewer than 2 lines');
    return [];
  }

  // Find header row
  const headerRowIndex = findHeaderRow(lines);
  console.log(`[IPDR Parser] Using line ${headerRowIndex + 1} as header row`);
  
  // Parse headers
  const rawHeaders = parseCSVLine(lines[headerRowIndex]);
  const mapping = IPDR_MAPS[operator.toUpperCase()] || VLI_IPDR_MAP;
  
  console.log(`[IPDR Parser] Headers found:`, rawHeaders);
  console.log(`[IPDR Parser] Using operator mapping: ${operator.toUpperCase()}`);
  
  // Map headers to normalized fields (try exact match first, then trimmed)
  const headerMapping: { index: number; field: keyof NormalizedIPDR }[] = [];
  
  rawHeaders.forEach((header, index) => {
    const trimmedHeader = header.trim();
    
    // Try exact match first
    let mappedField = mapping[trimmedHeader];
    
    // If no match, try lowercase
    if (!mappedField) {
      mappedField = mapping[trimmedHeader.toLowerCase()];
    }
    
    if (mappedField) {
      headerMapping.push({ index, field: mappedField });
      console.log(`[IPDR Parser] Mapped "${header}" -> ${mappedField}`);
    }
  });

  console.log(`[IPDR Parser] Mapped ${headerMapping.length} of ${rawHeaders.length} columns`);
  
  // Parse data rows
  const records: NormalizedIPDR[] = [];
  
  for (let i = headerRowIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    
    const values = parseCSVLine(line);
    if (values.length < 3) continue;
    
    const record: Record<string, unknown> = { operator: operator.toUpperCase() };
    
    headerMapping.forEach(({ index, field }) => {
      const value = values[index]?.trim();
      if (!value || value === '-' || value === '') return;
      
      // Handle numeric fields
      if (['duration_sec', 'data_volume_uplink', 'data_volume_downlink', 'cgi_lat', 'cgi_long'].includes(field)) {
        const numValue = parseNumber(value);
        if (numValue !== undefined) {
          record[field] = numValue;
        }
      } else {
        record[field] = value;
      }
    });
    
    // Combine date and time for session_start_time if both are present
    const normalized = record as unknown as NormalizedIPDR;

    if (normalized.allocation_start_date && normalized.session_start_time && !normalized.session_start_time.includes(' ')) {
      normalized.session_start_time = `${normalized.allocation_start_date} ${normalized.session_start_time}`;
    }

    // Only add if has some meaningful data
    if (normalized.imsi || normalized.imei || normalized.subscriber_msisdn || normalized.source_ip || normalized.source_ip_public_v4) {
      records.push(normalized);
    }
  }

  console.log(`[IPDR Parser] Parsed ${records.length} valid records`);
  
  // Debug: show sample record
  if (records.length > 0) {
    console.log('[IPDR Parser] Sample record:', records[0]);
  }
  
  return records;
}

// Export operator options
export const IPDR_OPERATORS: { value: IPDROperator; label: string }[] = [
  { value: 'VLI', label: 'VLI (Vodafone Idea)' },
  { value: 'AIRTEL', label: 'Airtel' },
  { value: 'TYPE3', label: 'Type3 / ISP' },
];
