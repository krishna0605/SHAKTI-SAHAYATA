import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar } from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { type NormalizedIPDR } from '../utils/ipdrNormalization';
import * as XLSX from 'xlsx-js-style';
import { ipdrAPI } from '../lib/apis';
import { encodeSpreadsheetRows } from '../lib/security';
import { RecordTable } from './RecordTable';
import { AnalysisTabBar } from './AnalysisTabBar';
import { usePaginatedAnalysisRecords } from './usePaginatedAnalysisRecords';
import { useChatbotWorkspaceStore } from '../../stores/chatbotWorkspaceStore';
import { getMetricUiLabel } from '../../lib/caseQaCatalog';
import { markPerformanceEvent, trackPerformanceAsync } from '../../lib/performance';

interface ModuleConfig {
  id: string;
  title: string;
  icon: string;
  tag: string;
  color: string;
}

const MODULES: ModuleConfig[] = [
  { id: 'top_msisdn', title: getMetricUiLabel('top_msisdn', 'Top MSISDN'), icon: 'phone_android', tag: 'ANALYTICS', color: 'emerald' },
  { id: 'top_imei', title: 'Top IMEI', icon: 'smartphone', tag: 'DEVICE', color: 'orange' },
  { id: 'top_imsi', title: 'Top IMSI', icon: 'sim_card', tag: 'SIM', color: 'indigo' },
  { id: 'ip_analysis', title: 'IP Analysis', icon: 'lan', tag: 'NETWORK', color: 'cyan' },
  { id: 'ip_scrutiny', title: 'IP Scrutiny', icon: 'policy', tag: 'INTEL', color: 'blue' },
  { id: 'data_usage', title: 'Data Usage Summary', icon: 'data_usage', tag: 'TRAFFIC', color: 'purple' },
  { id: 'common_msisdn', title: 'Common Mobile Numbers', icon: 'group', tag: 'COMPARE', color: 'teal' },
  { id: 'common_imei', title: 'Common IMEI', icon: 'devices', tag: 'COMPARE', color: 'rose' },
  { id: 'imei_multi_sim', title: 'IMEI Multi SIM', icon: 'sim_card_download', tag: 'DETECTION', color: 'amber' },
  { id: 'sim_multi_imei', title: 'SIM Multi IMEI', icon: 'perm_device_information', tag: 'DETECTION', color: 'lime' },
  { id: 'roaming_summary', title: 'Other State Summary', icon: 'map', tag: 'ROAMING', color: 'violet' },
];

const toFiniteNumber = (value: unknown, fallback = 0) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined) return fallback;
  const parsed = Number.parseFloat(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatBytes = (bytes: number) => {
  const safeBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (safeBytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(safeBytes) / Math.log(k));
  return parseFloat((safeBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDuration = (seconds: number) => {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  if (safeSeconds === 0) return '0s';
  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = safeSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

type SheetRow = Record<string, string | number | null | undefined>;
type ClassificationRule = {
  keywords: string[];
  regexes: RegExp[];
  ports: string[];
  ips: string[];
};

const formatDate = (date: Date) => {
  const pad2 = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
};

const formatIpInfo = (info: unknown) => {
  if (!info) return '';
  if (typeof info === 'string') return info;
  if (typeof info !== 'object') return String(info);
  const data = info as Record<string, unknown>;
  const parts = [
    data.ip,
    data.asn,
    data.as_name,
    data.as_domain,
    data.country,
    data.country_code,
    data.continent
  ]
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '')
    .map((value) => String(value));
  return parts.join(' | ');
};

const getIpCountry = (info: unknown) => {
  if (!info || typeof info !== 'object') return '';
  const data = info as Record<string, unknown>;
  return String(data.country || data.country_code || '').trim();
};

const getIpAsn = (info: unknown) => {
  if (!info || typeof info !== 'object') return '';
  const data = info as Record<string, unknown>;
  const asn = String(data.asn || '').trim();
  const asName = String(data.as_name || '').trim();
  if (asn && asName) return `${asn} ${asName}`;
  return asn || asName;
};

const IPDR_CLASSIFICATION_SHEETS = [
  'VPN',
  'Video Conference',
  'Unknown',
  'TSP',
  'Tool / Utility',
  'Social Media',
  'Social Video',
  'Proxy',
  'Messaging + Video Conference',
  'Messaging',
  'ISP',
  'Hosting',
  'Government',
  'File Transfer',
  'Email',
  'Education',
  'Business',
  'Broadband',
  'Banking'
];

const DEFAULT_CATEGORY_PRIORITY = [
  'Messaging + Video Conference',
  'Video Conference',
  'Messaging',
  'Social Video',
  'Social Media',
  'VPN',
  'Proxy',
  'Tool / Utility',
  'File Transfer',
  'Email',
  'Banking',
  'Business',
  'Education',
  'Government',
  'Hosting',
  'ISP',
  'TSP',
  'Broadband',
  'Unknown'
];

const DEFAULT_CLASSIFICATION_RULES: Record<string, ClassificationRule> = {
  'VPN': {
    keywords: ['vpn', 'openvpn', 'wireguard', 'ipsec', 'ikev2', 'l2tp', 'pptp', 'tunnel'],
    regexes: [/\bvpn\b/i, /\btunnel\b/i],
    ports: ['1194', '1701', '1723', '500', '4500', '51820'],
    ips: []
  },
  'Proxy': {
    keywords: ['proxy', 'socks', 'http proxy', 'https proxy'],
    regexes: [/\bproxy\b/i, /\bsocks\d*\b/i],
    ports: ['8080', '3128', '8000', '8888'],
    ips: []
  },
  'Video Conference': {
    keywords: ['zoom', 'google meet', 'meet', 'teams', 'webex', 'skype', 'bluejeans', 'gotomeeting', 'jitsi'],
    regexes: [/\bvideo\s*conf/i, /\bconference\b/i],
    ports: ['3478', '3479', '3480', '3481'],
    ips: []
  },
  'Messaging + Video Conference': {
    keywords: ['whatsapp', 'telegram', 'signal', 'wechat', 'viber', 'line', 'messenger', 'imo', 'skype', 'teams'],
    regexes: [/\bwhatsapp\b/i, /\btelegram\b/i],
    ports: [],
    ips: []
  },
  'Messaging': {
    keywords: ['sms', 'mms', 'whatsapp', 'telegram', 'signal', 'wechat', 'viber', 'line', 'messenger', 'imo', 'discord', 'slack'],
    regexes: [/\bmessage\b/i, /\bchat\b/i],
    ports: [],
    ips: []
  },
  'Social Media': {
    keywords: ['facebook', 'instagram', 'twitter', 'x.com', 'linkedin', 'snapchat', 'tiktok', 'reddit', 'pinterest'],
    regexes: [/\bsocial\b/i],
    ports: [],
    ips: []
  },
  'Social Video': {
    keywords: ['youtube', 'tiktok', 'vimeo', 'dailymotion', 'twitch', 'netflix', 'prime video', 'hotstar', 'hulu'],
    regexes: [/\bvideo\b/i],
    ports: [],
    ips: []
  },
  'File Transfer': {
    keywords: ['ftp', 'sftp', 'ftps', 'scp', 'rsync', 'file transfer', 'dropbox', 'onedrive', 'google drive', 'mega'],
    regexes: [/\bftp\b/i, /\bsftp\b/i],
    ports: ['20', '21', '22', '69'],
    ips: []
  },
  'Email': {
    keywords: ['smtp', 'imap', 'pop3', 'mail', 'gmail', 'outlook', 'yahoo mail', 'office365', 'exchange'],
    regexes: [/\bmail\b/i],
    ports: ['25', '465', '587', '110', '995', '143', '993'],
    ips: []
  },
  'Banking': {
    keywords: ['bank', 'netbank', 'upi', 'payment', 'wallet', 'paytm', 'phonepe', 'gpay', 'google pay', 'paypal'],
    regexes: [/\bpay\b/i, /\bbank\b/i],
    ports: [],
    ips: []
  },
  'Business': {
    keywords: ['sap', 'oracle', 'salesforce', 'crm', 'erp', 'office365', 'microsoft 365', 'sharepoint'],
    regexes: [/\bcrm\b/i, /\berp\b/i],
    ports: [],
    ips: []
  },
  'Education': {
    keywords: ['moodle', 'coursera', 'udemy', 'edx', 'khanacademy', 'byjus', 'unacademy', 'classroom'],
    regexes: [/\bedu\b/i, /\bclass\b/i],
    ports: [],
    ips: []
  },
  'Government': {
    keywords: ['gov', 'government', 'nic', 'uidai', 'nrega', 'incometax', 'gst', 'mca', 'irctc'],
    regexes: [/\b\.gov\b/i, /\bnic\b/i],
    ports: [],
    ips: []
  },
  'Hosting': {
    keywords: ['aws', 'azure', 'gcp', 'google cloud', 'digitalocean', 'cloudflare', 'heroku', 'hosting', 'cdn', 'server'],
    regexes: [/\bcloud\b/i, /\bhosting\b/i],
    ports: [],
    ips: []
  },
  'ISP': {
    keywords: ['isp', 'internet service provider', 'broadband', 'fiber', 'dsl'],
    regexes: [/\bisp\b/i],
    ports: [],
    ips: []
  },
  'TSP': {
    keywords: ['tsp', 'telecom', 'telco', 'mobile operator'],
    regexes: [/\btsp\b/i],
    ports: [],
    ips: []
  },
  'Broadband': {
    keywords: ['broadband', 'ftth', 'fiber', 'dsl', 'adsl', 'vdsl', 'satellite'],
    regexes: [/\bbroadband\b/i],
    ports: [],
    ips: []
  },
  'Tool / Utility': {
    keywords: ['tool', 'utility', 'update', 'antivirus', 'backup', 'software update', 'driver', 'patch'],
    regexes: [/\butility\b/i, /\bupdate\b/i],
    ports: [],
    ips: []
  }
};

const toSafeSheetName = (name: string) => {
  const replacements: Record<string, string> = {
    '/': '／',
    '\\': '＼',
    '?': '？',
    '*': '＊',
    '[': '［',
    ']': '］',
    ':': '：'
  };
  const safe = Array.from(name).map(char => replacements[char] || char).join('');
  return safe.slice(0, 31);
};

const toText = (value: unknown) => {
  if (value === null || value === undefined) return '';
  return String(value);
};

const extractPorts = (value: string): string[] => value.match(/\d+/g) ?? [];

const extractIps = (value: string): string[] => {
  const ipv4 = value.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) ?? [];
  const ipv6 = value.match(/\b[0-9a-fA-F:]{2,}\b/g) ?? [];
  return [...ipv4, ...ipv6.filter(ip => ip.includes(':'))];
};

const parseIpv4 = (value: string) => {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(part => Number(part));
  if (nums.some(num => Number.isNaN(num) || num < 0 || num > 255)) return null;
  return nums;
};

const ipv4ToInt = (parts: number[]) => ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];

const ipv4InCidr = (ip: string, cidr: string) => {
  const [base, maskBitsText] = cidr.split('/');
  const maskBits = Number(maskBitsText);
  const ipParts = parseIpv4(ip);
  const baseParts = parseIpv4(base);
  if (!ipParts || !baseParts || Number.isNaN(maskBits) || maskBits < 0 || maskBits > 32) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  const ipInt = ipv4ToInt(ipParts);
  const baseInt = ipv4ToInt(baseParts);
  return (ipInt & mask) === (baseInt & mask);
};

const matchIpRule = (ipValue: string, ruleIps: string[]) => {
  return ruleIps.some(entry => {
    if (entry.includes('/')) {
      return ipv4InCidr(ipValue, entry);
    }
    return ipValue.toLowerCase() === entry.toLowerCase();
  });
};

const matchCategoriesForValue = (value: unknown, rules: Record<string, ClassificationRule>) => {
  const text = toText(value).toLowerCase();
  if (!text) return [];
  const found: string[] = [];
  const textPorts = extractPorts(text);
  const textIps = extractIps(text);
  Object.entries(rules).forEach(([category, rule]) => {
    if (rule.ips.length > 0 && textIps.length > 0) {
      if (textIps.some(ip => matchIpRule(ip, rule.ips))) {
        found.push(category);
        return;
      }
    }
    if (rule.keywords.some(keyword => text.includes(keyword))) {
      found.push(category);
      return;
    }
    if (rule.regexes.some(rx => rx.test(text))) {
      found.push(category);
      return;
    }
    if (rule.ports.length > 0 && textPorts.length > 0) {
      if (rule.ports.some(port => textPorts.includes(port))) {
        found.push(category);
      }
    }
  });
  return found;
};

const getClassificationValues = (row: NormalizedIPDR) => {
  const rowAny = row as unknown as Record<string, unknown>;
  return [
    rowAny['VPN/Proxy/Tor'],
    rowAny['Usage'],
    rowAny['App/Hostname'],
    rowAny['Domains'],
    rowAny['Isp/Org'],
    rowAny['Port Category'],
    rowAny['Port Info'],
    rowAny['Destination Port'] ?? row.destination_port,
    rowAny['Destination IP'] ?? row.destination_ip ?? row.destination_ip_v4 ?? row.destination_ip_v6,
    rowAny['Source IP'] ?? row.source_ip ?? row.source_ip_public_v4 ?? row.source_ip_private_v4 ?? row.source_ip_public_v6,
    rowAny['Translated IP'] ?? row.translated_ip,
    row.ip_type,
    row.apn,
    row.pgw_ip,
    row.translated_port
  ];
};

const classifyRow = (row: NormalizedIPDR) => {
  for (const value of getClassificationValues(row)) {
    const matches = matchCategoriesForValue(value, DEFAULT_CLASSIFICATION_RULES);
    if (matches.length > 0) {
      for (const category of DEFAULT_CATEGORY_PRIORITY) {
        if (matches.includes(category)) return category;
      }
    }
  }
  return 'Unknown';
};

const buildIpdrSheets = (
  rows: NormalizedIPDR[],
  summary: { totalRecords: number; totalVolume: string; uniqueIPs: number; uniqueMSISDNs: number }
) => {
  const recordHeaders = [
    'MSISDN',
    'IMSI',
    'IMEI',
    'Source IP',
    'Destination IP',
    'Source Country',
    'Destination Country',
    'Source ASN',
    'Destination ASN',
    'Source IP Info',
    'Destination IP Info',
    'Translated IP Info',
    'Source Port',
    'Destination Port',
    'Session Start',
    'Session End',
    'Duration (sec)',
    'Upload (bytes)',
    'Download (bytes)',
    'Roaming Circle',
    'Home Circle',
    'APN',
    'PGW IP',
    'File Name'
  ];

  const recordRows: SheetRow[] = rows.map(r => ({
    'MSISDN': r.subscriber_msisdn || '',
    'IMSI': r.imsi || '',
    'IMEI': r.imei || '',
    'Source IP': r.source_ip || r.source_ip_public_v4 || r.source_ip_private_v4 || '',
    'Destination IP': r.destination_ip || r.destination_ip_v4 || r.destination_ip_v6 || '',
    'Source Country': getIpCountry(r.source_ip_info),
    'Destination Country': getIpCountry(r.destination_ip_info),
    'Source ASN': getIpAsn(r.source_ip_info),
    'Destination ASN': getIpAsn(r.destination_ip_info),
    'Source IP Info': formatIpInfo(r.source_ip_info),
    'Destination IP Info': formatIpInfo(r.destination_ip_info),
    'Translated IP Info': formatIpInfo(r.translated_ip_info),
    'Source Port': r.source_port || r.source_public_port || r.source_private_port || '',
    'Destination Port': r.destination_port || '',
    'Session Start': r.session_start_time || r.event_start_time || r.allocation_start_time || '',
    'Session End': r.session_end_time || r.allocation_end_time || '',
    'Duration (sec)': r.duration_sec ?? 0,
    'Upload (bytes)': r.data_volume_uplink ?? 0,
    'Download (bytes)': r.data_volume_downlink ?? 0,
    'Roaming Circle': r.roaming_circle || '',
    'Home Circle': r.home_circle || '',
    'APN': r.apn || '',
    'PGW IP': r.pgw_ip || '',
    'File Name': r.file_name || ''
  }));

  const summaryRows: SheetRow[] = [
    { Metric: 'Total Records', Value: summary.totalRecords },
    { Metric: 'Total Volume', Value: summary.totalVolume },
    { Metric: 'Unique IPs', Value: summary.uniqueIPs },
    { Metric: 'Unique MSISDNs', Value: summary.uniqueMSISDNs }
  ];

  const bucketMap = new Map<string, SheetRow[]>();
  IPDR_CLASSIFICATION_SHEETS.forEach(category => bucketMap.set(category, []));

  rows.forEach((row, idx) => {
    const category = classifyRow(row);
    const target = bucketMap.get(category) || bucketMap.get('Unknown');
    if (target) target.push(recordRows[idx]);
  });

  const categorySheets = IPDR_CLASSIFICATION_SHEETS.map(category => ({
    name: category,
    safeName: toSafeSheetName(category),
    headers: recordHeaders,
    rows: bucketMap.get(category) || []
  }));

  return [
    ...categorySheets,
    { name: 'Summary', safeName: toSafeSheetName('Summary'), headers: ['Metric', 'Value'], rows: summaryRows }
  ];
};

const applyHeaderStylesAndFilter = (ws: XLSX.WorkSheet, headers: string[], headerColor = 'FF2563EB') => {
  const ref = ws['!ref'] || XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.max(headers.length - 1, 0) } });
  const range = XLSX.utils.decode_range(ref);
  range.e.c = Math.max(range.e.c, headers.length - 1);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };

  headers.forEach((_, col) => {
    const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
    const cell = ws[cellAddress];
    if (!cell) return;
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFFFF' } },
      fill: { patternType: 'solid', fgColor: { rgb: headerColor } },
      alignment: { horizontal: 'center', vertical: 'center' }
    };
  });

  for (let row = 1; row <= range.e.r; row += 1) {
    const fillColor = row % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';
    for (let col = 0; col <= range.e.c; col += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = ws[cellAddress];
      if (!cell) continue;
      cell.s = {
        ...(cell.s || {}),
        fill: { patternType: 'solid', fgColor: { rgb: fillColor } }
      };
    }
  }
};

type SheetMeta = XLSX.SheetProps & { TabColor?: { rgb: string } };

const applySheetTabColor = (workbook: XLSX.WorkBook, sheetName: string, color: string) => {
  if (!workbook.Workbook) workbook.Workbook = { Sheets: [] };
  if (!workbook.Workbook.Sheets) workbook.Workbook.Sheets = [];
  const sheets = workbook.Workbook.Sheets as SheetMeta[];
  const existing = sheets.find(entry => entry.name === sheetName);
  if (existing) {
    existing.TabColor = { rgb: color };
    return;
  }
  sheets.push({ name: sheetName, TabColor: { rgb: color } });
};

const getColorClass = (color: string) => {
  switch (color) {
    case 'blue':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400';
    case 'emerald':
      return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400';
    case 'orange':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400';
    case 'indigo':
      return 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400';
    case 'cyan':
      return 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-400';
    case 'purple':
      return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400';
    case 'teal':
      return 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400';
    case 'rose':
      return 'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400';
    case 'amber':
      return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400';
    case 'lime':
      return 'bg-lime-100 dark:bg-lime-900/30 text-lime-700 dark:text-lime-400';
    case 'violet':
      return 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400';
    case 'slate':
      return 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300';
    default:
      return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400';
  }
};

interface IpdrMapPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  count: number;
  details?: string;
}

const FitIpdrMapBounds: React.FC<{ points: IpdrMapPoint[] }> = ({ points }) => {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, points]);

  return null;
};

interface IPDRAnalyticsProps {
  caseId: string;
  caseName: string;
  operator: string;
  parsedData: NormalizedIPDR[];
  fileCount: number;
  onBack: () => void;
}

export default function IPDRAnalytics({ caseId, caseName, operator, parsedData, fileCount, onBack }: IPDRAnalyticsProps) {
  const setWorkspaceContext = useChatbotWorkspaceStore((state) => state.setWorkspaceContext);
  const clearWorkspaceContext = useChatbotWorkspaceStore((state) => state.clearWorkspaceContext);
  const [data, setData] = useState<NormalizedIPDR[]>(parsedData || []);
  const [isLoading, setIsLoading] = useState(!parsedData || parsedData.length === 0);
  const [summary, setSummary] = useState<{
    totalRecords?: number;
    uniqueIps?: number;
    uniqueMsisdn?: number;
    totalVolumeBytes?: number;
  } | null>(null);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'records' | 'analysis' | 'map' | 'charts'>('overview');
  const [filteredData, setFilteredData] = useState<NormalizedIPDR[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);
  const [isExporting, setIsExporting] = useState(false);
  const fileCountState = fileCount;
  const [msisdnFilter, setMsisdnFilter] = useState('');
  const [imeiFilter, setImeiFilter] = useState('');
  const [imsiFilter, setImsiFilter] = useState('');
  const [ipFilter, setIpFilter] = useState('');

  useEffect(() => {
    markPerformanceEvent('ipdr.route-entered', { caseId: caseId || null });
  }, [caseId]);

  useEffect(() => {
    markPerformanceEvent('ipdr.shell-rendered', { caseId: caseId || null });
  }, [caseId]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadCaseData = useCallback(async () => {
    if (!caseId) return;
    try {
      setIsLoading(true);
      const records = await ipdrAPI.getRecordsByCase(caseId);
      startTransition(() => {
        setData((Array.isArray(records) ? records : []) as NormalizedIPDR[]);
      });
    } catch (error) {
      console.error('Failed to load IPDR records:', error);
    } finally {
      setIsLoading(false);
    }
  }, [caseId]);

  const loadCaseSummary = useCallback(async () => {
    if (!caseId) return;
    try {
      const nextSummary = await trackPerformanceAsync(
        'ipdr.summary.load',
        () => ipdrAPI.getSummary(caseId),
        { caseId }
      );
      setSummary((nextSummary && typeof nextSummary === 'object') ? nextSummary as typeof summary : null);
    } catch (error) {
      console.error('Failed to load IPDR summary:', error);
    }
  }, [caseId]);

  useEffect(() => {
    if (parsedData && parsedData.length > 0) {
      setData(parsedData);
      setIsLoading(false);
    } else if (caseId) {
      loadCaseData();
    } else {
      setIsLoading(false);
    }
  }, [caseId, parsedData, loadCaseData]);

  useEffect(() => {
    if (!caseId) {
      setSummary(null);
      return;
    }
    loadCaseSummary();
  }, [caseId, loadCaseSummary]);

  useEffect(() => {
    if (summary) {
      markPerformanceEvent('ipdr.summary.loaded', {
        caseId: caseId || null,
        totalRecords: Number(summary.totalRecords || 0)
      });
    }
  }, [caseId, summary]);

  useEffect(() => {
    markPerformanceEvent('ipdr.tab-opened', { caseId: caseId || null, tab: selectedTab });
    if (selectedTab === 'analysis' || selectedTab === 'map' || selectedTab === 'charts') {
      markPerformanceEvent('ipdr.heavy-tab-rendered', { caseId: caseId || null, tab: selectedTab });
    }
  }, [caseId, selectedTab]);

  // Filter Logic
  useEffect(() => {
    let result = data;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(r => 
        (r.subscriber_msisdn?.includes(term)) ||
        (r.imei?.includes(term)) ||
        (r.imsi?.includes(term)) ||
        (r.source_ip?.includes(term)) ||
        (r.destination_ip?.includes(term))
      );
    }

    if (msisdnFilter) result = result.filter(r => r.subscriber_msisdn?.includes(msisdnFilter));
    if (imeiFilter) result = result.filter(r => r.imei?.includes(imeiFilter));
    if (imsiFilter) result = result.filter(r => r.imsi?.includes(imsiFilter));
    if (ipFilter) result = result.filter(r => (r.source_ip?.includes(ipFilter)) || (r.destination_ip?.includes(ipFilter)));

    setFilteredData(result);
    setCurrentPage(1);
  }, [data, searchTerm, msisdnFilter, imeiFilter, imsiFilter, ipFilter]);

  // Stats
  const stats = useMemo(() => {
    const totalVolume = data.reduce((acc, r) => {
      const up = toFiniteNumber(r.data_volume_uplink);
      const down = toFiniteNumber(r.data_volume_downlink);
      return acc + up + down;
    }, 0);
    const uniqueIPs = new Set([...data.map(r => r.source_ip), ...data.map(r => r.destination_ip)].filter(Boolean)).size;
    const uniqueMSISDNs = new Set(data.map(r => r.subscriber_msisdn).filter(Boolean)).size;
    
    return {
      totalRecords: data.length,
      totalVolume: formatBytes(totalVolume),
      uniqueIPs,
      uniqueMSISDNs
    };
  }, [data]);

  const overviewStats = useMemo(() => {
    if (data.length > 0 || !summary) return stats;
    return {
      totalRecords: Number(summary.totalRecords || 0),
      totalVolume: formatBytes(Number(summary.totalVolumeBytes || 0)),
      uniqueIPs: Number(summary.uniqueIps || 0),
      uniqueMSISDNs: Number(summary.uniqueMsisdn || 0)
    };
  }, [data.length, stats, summary]);

  const trafficByHourData = useMemo(() => {
    const hours = Array(24).fill(0).map((_, i) => ({ hour: i, uplinkMB: 0, downlinkMB: 0, totalMB: 0 }));
    data.forEach(r => {
      const t = r.session_start_time || r.event_start_time || r.allocation_start_time || '';
      const match = t.match(/(\d{1,2}):/);
      let h = undefined as number | undefined;
      if (match) {
        const hh = parseInt(match[1]);
        if (!Number.isNaN(hh) && hh >= 0 && hh < 24) h = hh;
      }
      const uplink = toFiniteNumber(r.data_volume_uplink);
      const downlink = toFiniteNumber(r.data_volume_downlink);
      const uplinkMB = uplink / (1024 * 1024);
      const downlinkMB = downlink / (1024 * 1024);
      if (typeof h === 'number') {
        hours[h].uplinkMB += uplinkMB;
        hours[h].downlinkMB += downlinkMB;
        hours[h].totalMB += uplinkMB + downlinkMB;
      } else {
        hours[0].uplinkMB += uplinkMB;
        hours[0].downlinkMB += downlinkMB;
        hours[0].totalMB += uplinkMB + downlinkMB;
      }
    });
    return hours.map(h => ({ ...h, hourLabel: h.hour.toString().padStart(2, '0') }));
  }, [data]);

  const topPortsData = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(r => {
      const ports = [
        r.destination_port,
        r.source_public_port,
        r.source_port,
        r.source_private_port,
        r.translated_port
      ].filter(Boolean) as string[];
      const p = ports[0];
      if (!p) return;
      const key = String(p);
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
  }, [data]);

  const topMsisdnData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const counts: Record<string, { count: number; totalData: number; totalDuration: number }> = {};
    data.forEach(row => {
      const msisdn = row.subscriber_msisdn;
      if (!msisdn || msisdn === '-') return;
      if (!counts[msisdn]) counts[msisdn] = { count: 0, totalData: 0, totalDuration: 0 };
      counts[msisdn].count++;
      const up = toFiniteNumber(row.data_volume_uplink);
      const down = toFiniteNumber(row.data_volume_downlink);
      counts[msisdn].totalData += up + down;
      counts[msisdn].totalDuration += toFiniteNumber(row.duration_sec);
    });
    return Object.entries(counts)
      .map(([msisdn, stat]) => ({ msisdn, ...stat }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }, [data]);

  const topImeiData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const counts: Record<string, { count: number; msisdns: Set<string> }> = {};
    data.forEach(row => {
      const imei = row.imei;
      if (!imei || imei === '-') return;
      if (!counts[imei]) counts[imei] = { count: 0, msisdns: new Set() };
      counts[imei].count++;
      if (row.subscriber_msisdn) counts[imei].msisdns.add(row.subscriber_msisdn);
    });
    return Object.entries(counts)
      .map(([imei, stat]) => ({ imei, count: stat.count, uniqueMsisdns: stat.msisdns.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }, [data]);

  const topImsiData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const counts: Record<string, number> = {};
    data.forEach(row => {
      const imsi = row.imsi;
      if (!imsi || imsi === '-') return;
      counts[imsi] = (counts[imsi] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([imsi, count]) => ({ imsi, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }, [data]);

  const topMsisdnChartData = useMemo(() => {
    return topMsisdnData.slice(0, 10).map(row => ({
      name: row.msisdn,
      value: row.count
    }));
  }, [topMsisdnData]);

  const topImeiChartData = useMemo(() => {
    return topImeiData.slice(0, 10).map(row => ({
      name: row.imei,
      value: row.count
    }));
  }, [topImeiData]);

  const topImsiChartData = useMemo(() => {
    return topImsiData.slice(0, 10).map(row => ({
      name: row.imsi,
      value: row.count
    }));
  }, [topImsiData]);

  const ipAnalysisData = useMemo(() => {
    if (!data || data.length === 0) return { sourceIps: [], destIps: [] };
    const srcCounts: Record<string, number> = {};
    const dstCounts: Record<string, number> = {};
    data.forEach(row => {
      const srcIp = row.source_ip || row.source_ip_public_v4 || row.source_ip_private_v4;
      const dstIp = row.destination_ip || row.destination_ip_v4;
      if (srcIp && srcIp !== '-') srcCounts[srcIp] = (srcCounts[srcIp] || 0) + 1;
      if (dstIp && dstIp !== '-') dstCounts[dstIp] = (dstCounts[dstIp] || 0) + 1;
    });
    return {
      sourceIps: Object.entries(srcCounts).map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count).slice(0, 20),
      destIps: Object.entries(dstCounts).map(([ip, count]) => ({ ip, count })).sort((a, b) => b.count - a.count).slice(0, 20),
    };
  }, [data]);

  const ipIntelData = useMemo(() => {
    const sourceCountries: Record<string, number> = {};
    const destinationCountries: Record<string, number> = {};
    const sourceAsns: Record<string, number> = {};
    const destinationAsns: Record<string, number> = {};

    for (const row of data) {
      const srcCountry = getIpCountry(row.source_ip_info);
      const dstCountry = getIpCountry(row.destination_ip_info);
      const srcAsn = getIpAsn(row.source_ip_info);
      const dstAsn = getIpAsn(row.destination_ip_info);

      if (srcCountry) sourceCountries[srcCountry] = (sourceCountries[srcCountry] || 0) + 1;
      if (dstCountry) destinationCountries[dstCountry] = (destinationCountries[dstCountry] || 0) + 1;
      if (srcAsn) sourceAsns[srcAsn] = (sourceAsns[srcAsn] || 0) + 1;
      if (dstAsn) destinationAsns[dstAsn] = (destinationAsns[dstAsn] || 0) + 1;
    }

    const toTop = (input: Record<string, number>) =>
      Object.entries(input).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 12);

    return {
      sourceCountries: toTop(sourceCountries),
      destinationCountries: toTop(destinationCountries),
      sourceAsns: toTop(sourceAsns),
      destinationAsns: toTop(destinationAsns)
    };
  }, [data]);

  const ipScrutinyData = useMemo(() => {
    const suspiciousAsnKeyword = /(vpn|proxy|hosting|cloud|digitalocean|ovh|hetzner|amazon|google|microsoft|oracle|linode|tor)/i;
    const foreignRows = data.filter((row) => {
      const country = getIpCountry(row.destination_ip_info) || getIpCountry(row.source_ip_info);
      return country && !/^india$/i.test(country) && !/^in$/i.test(country);
    });

    const asnCounts: Record<string, number> = {};
    for (const row of data) {
      const labels = [getIpAsn(row.source_ip_info), getIpAsn(row.destination_ip_info)].filter(Boolean);
      for (const label of labels) {
        if (!suspiciousAsnKeyword.test(label)) continue;
        asnCounts[label] = (asnCounts[label] || 0) + 1;
      }
    }

    const fanoutMap = new Map<string, Set<string>>();
    const sessionMap: Record<string, number> = {};
    for (const row of data) {
      const msisdn = row.subscriber_msisdn || '';
      const dstIp = row.destination_ip || row.destination_ip_v4 || row.destination_ip_v6 || '';
      if (!msisdn || !dstIp) continue;
      if (!fanoutMap.has(msisdn)) fanoutMap.set(msisdn, new Set());
      fanoutMap.get(msisdn)!.add(dstIp);
      sessionMap[msisdn] = (sessionMap[msisdn] || 0) + 1;
    }

    const highFanout = Array.from(fanoutMap.entries())
      .map(([msisdn, ips]) => ({ msisdn, uniqueDestIps: ips.size, sessions: sessionMap[msisdn] || 0 }))
      .filter((entry) => entry.uniqueDestIps >= 15)
      .sort((a, b) => b.uniqueDestIps - a.uniqueDestIps || b.sessions - a.sessions)
      .slice(0, 20);

    const topSuspiciousAsn = Object.entries(asnCounts)
      .map(([asn, count]) => ({ asn, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return {
      foreignSessions: foreignRows.length,
      foreignRatio: data.length > 0 ? Math.round((foreignRows.length / data.length) * 1000) / 10 : 0,
      topSuspiciousAsn,
      highFanout
    };
  }, [data]);

  const dataUsageData = useMemo(() => {
    if (!data || data.length === 0) return { totalUp: 0, totalDown: 0, totalDuration: 0, sessions: 0 };
    let totalUp = 0;
    let totalDown = 0;
    let totalDuration = 0;
    data.forEach(row => {
      totalUp += toFiniteNumber(row.data_volume_uplink);
      totalDown += toFiniteNumber(row.data_volume_downlink);
      totalDuration += toFiniteNumber(row.duration_sec);
    });
    return { totalUp, totalDown, totalDuration, sessions: data.length };
  }, [data]);

  const commonMsisdnData = useMemo(() => {
    if (!data || data.length === 0 || fileCountState < 2) return { hasMultipleFiles: fileCountState >= 2, common: [] as Array<{ number: string; totalCount: number }> };
    const fileStats: Record<number, Set<string>> = {};
    data.forEach(row => {
      const fileIndex = (row as { file_index?: number }).file_index ?? 0;
      const msisdn = row.subscriber_msisdn;
      if (!msisdn || msisdn === '-') return;
      if (!fileStats[fileIndex]) fileStats[fileIndex] = new Set();
      fileStats[fileIndex].add(msisdn);
    });
    const fileSets = Object.values(fileStats);
    if (fileSets.length < 2) return { hasMultipleFiles: false, common: [] as Array<{ number: string; totalCount: number }> };
    let commonNumbers = new Set(fileSets[0]);
    for (let i = 1; i < fileSets.length; i++) {
      commonNumbers = new Set([...commonNumbers].filter(x => fileSets[i].has(x)));
    }
    const commonWithCounts = [...commonNumbers].map(number => {
      let totalCount = 0;
      data.forEach(row => {
        if (row.subscriber_msisdn === number) totalCount++;
      });
      return { number, totalCount };
    }).sort((a, b) => b.totalCount - a.totalCount);
    return { hasMultipleFiles: true, common: commonWithCounts };
  }, [data, fileCountState]);

  const commonImeiData = useMemo(() => {
    if (!data || data.length === 0 || fileCountState < 2) return { hasMultipleFiles: fileCountState >= 2, common: [] as Array<{ imei: string; totalCount: number }> };
    const fileStats: Record<number, Set<string>> = {};
    data.forEach(row => {
      const fileIndex = (row as { file_index?: number }).file_index ?? 0;
      const imei = row.imei;
      if (!imei || imei === '-') return;
      if (!fileStats[fileIndex]) fileStats[fileIndex] = new Set();
      fileStats[fileIndex].add(imei);
    });
    const fileSets = Object.values(fileStats);
    if (fileSets.length < 2) return { hasMultipleFiles: false, common: [] as Array<{ imei: string; totalCount: number }> };
    let commonImeis = new Set(fileSets[0]);
    for (let i = 1; i < fileSets.length; i++) {
      commonImeis = new Set([...commonImeis].filter(x => fileSets[i].has(x)));
    }
    const commonWithCounts = [...commonImeis].map(imei => {
      let totalCount = 0;
      data.forEach(row => {
        if (row.imei === imei) totalCount++;
      });
      return { imei, totalCount };
    }).sort((a, b) => b.totalCount - a.totalCount);
    return { hasMultipleFiles: true, common: commonWithCounts };
  }, [data, fileCountState]);

  const imeiMultiSimData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const imeiImsi: Record<string, Set<string>> = {};
    data.forEach(row => {
      const imei = row.imei;
      const imsi = row.imsi || row.subscriber_msisdn;
      if (!imei || imei === '-' || !imsi || imsi === '-') return;
      if (!imeiImsi[imei]) imeiImsi[imei] = new Set();
      imeiImsi[imei].add(imsi);
    });
    return Object.entries(imeiImsi)
      .filter(([, sims]) => sims.size > 1)
      .map(([imei, sims]) => ({ imei, sims: [...sims], simCount: sims.size }))
      .sort((a, b) => b.simCount - a.simCount)
      .slice(0, 50);
  }, [data]);

  const simMultiImeiData = useMemo(() => {
    if (!data || data.length === 0) return [];
    const imsiImei: Record<string, Set<string>> = {};
    data.forEach(row => {
      const imsi = row.imsi || row.subscriber_msisdn;
      const imei = row.imei;
      if (!imsi || imsi === '-' || !imei || imei === '-') return;
      if (!imsiImei[imsi]) imsiImei[imsi] = new Set();
      imsiImei[imsi].add(imei);
    });
    return Object.entries(imsiImei)
      .filter(([, imeis]) => imeis.size > 1)
      .map(([imsi, imeis]) => ({ imsi, imeis: [...imeis], imeiCount: imeis.size }))
      .sort((a, b) => b.imeiCount - a.imeiCount)
      .slice(0, 50);
  }, [data]);

  const roamingSummaryData = useMemo(() => {
    if (!data || data.length === 0) return { hasData: false, circles: [] as Array<{ circle: string; count: number }> };
    const circleCounts: Record<string, number> = {};
    data.forEach(row => {
      const circle = row.roaming_circle || row.home_circle;
      if (!circle || circle === '-') return;
      circleCounts[circle] = (circleCounts[circle] || 0) + 1;
    });
    const circles = Object.entries(circleCounts)
      .map(([circle, count]) => ({ circle, count }))
      .sort((a, b) => b.count - a.count);
    return { hasData: circles.length > 0, circles };
  }, [data]);

  const roamingChartData = useMemo(() => {
    return roamingSummaryData.circles.slice(0, 10).map(row => ({
      name: row.circle,
      value: row.count
    }));
  }, [roamingSummaryData]);

  const mapPoints = useMemo<IpdrMapPoint[]>(() => {
    const points = new Map<string, IpdrMapPoint>();

    data.forEach((row, index) => {
      const lat = Number(row.cgi_lat);
      const lng = Number(row.cgi_long);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

      const label = row.cgi || row.first_cell_id || row.last_cell_id || `IPDR Point ${index + 1}`;
      const key = `${label}:${lat.toFixed(6)}:${lng.toFixed(6)}`;
      if (!points.has(key)) {
        points.set(key, {
          id: key,
          label,
          lat,
          lng,
          count: 0,
          details: row.first_cell_name_location || row.subscriber_msisdn || row.destination_ip || ''
        });
      }
      points.get(key)!.count += 1;
    });

    return Array.from(points.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3000);
  }, [data]);

  useEffect(() => {
    if (!caseId) {
      clearWorkspaceContext();
      return;
    }

    setWorkspaceContext({
      caseId,
      caseTag: caseName || null,
      module: 'ipdr',
      view: selectedTab === 'analysis' ? 'advanced' : selectedTab,
      filters: selectedTab === 'records'
        ? {
            search: searchTerm || null,
            msisdn: msisdnFilter || null,
            imei: imeiFilter || null,
            imsi: imsiFilter || null,
            ip: ipFilter || null
          }
        : null,
      searchState: selectedTab === 'records'
        ? {
            query: searchTerm || null,
            resultCount: recordsResultCount
          }
        : null,
      mapState: selectedTab === 'map'
        ? {
            pointCount: mapPoints.length
          }
        : null,
      selectionTimestamp: new Date().toISOString()
    });
  }, [
    caseId,
    caseName,
    selectedTab,
    searchTerm,
    msisdnFilter,
    imeiFilter,
    imsiFilter,
    ipFilter,
    filteredData.length,
    mapPoints.length,
    setWorkspaceContext,
    clearWorkspaceContext
  ]);

  useEffect(() => () => {
    clearWorkspaceContext();
  }, [clearWorkspaceContext]);

  const recordsQueryKey = useMemo(
    () => [searchTerm, msisdnFilter, imeiFilter, imsiFilter, ipFilter].join('|'),
    [searchTerm, msisdnFilter, imeiFilter, imsiFilter, ipFilter]
  );

  const {
    data: remoteRecords,
    loading: recordsLoading,
    error: recordsError,
    pagination: recordsPagination,
    totalPages: remoteTotalPages,
    showingStart: remoteShowingStart,
    showingEnd: remoteShowingEnd
  } = usePaginatedAnalysisRecords<NormalizedIPDR>({
    enabled: Boolean(caseId && selectedTab === 'records'),
    moduleKey: 'ipdr',
    page: currentPage,
    pageSize: itemsPerPage,
    fetchPage: async () => {
      const response = await ipdrAPI.getRecordsPage(caseId!, {
        page: currentPage,
        pageSize: itemsPerPage,
        search: searchTerm || undefined,
        msisdn: msisdnFilter || undefined,
        imei: imeiFilter || undefined,
        imsi: imsiFilter || undefined,
        ip: ipFilter || undefined,
      });
      return response as { data: NormalizedIPDR[]; pagination: { page: number; pageSize: number; total: number } };
    },
    deps: [recordsQueryKey]
  });

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredData.length / itemsPerPage));
  const paginatedData = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );
  const showingStart = filteredData.length === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
  const showingEnd = Math.min(currentPage * itemsPerPage, filteredData.length);
  const recordsRows = caseId ? remoteRecords : paginatedData;
  const recordsTotalPages = caseId ? remoteTotalPages : totalPages;
  const recordsShowingStart = caseId ? remoteShowingStart : showingStart;
  const recordsShowingEnd = caseId ? remoteShowingEnd : showingEnd;
  const recordsResultCount = caseId ? recordsPagination.total : filteredData.length;

  const handleExportExcel = async () => {
    if (isExporting) return;
    try {
      setIsExporting(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const sheets = buildIpdrSheets(data, stats);
      const workbook = XLSX.utils.book_new();
      for (const sheet of sheets) {
        const ws = XLSX.utils.aoa_to_sheet([sheet.headers]);
        XLSX.utils.sheet_add_json(ws, encodeSpreadsheetRows(sheet.rows), { header: sheet.headers, skipHeader: true, origin: 'A2' });
        applyHeaderStylesAndFilter(ws, sheet.headers, 'FF2563EB');
        XLSX.utils.book_append_sheet(workbook, ws, sheet.safeName);
        applySheetTabColor(workbook, sheet.safeName, 'FF2563EB');
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const safeCase = (caseName || 'Case').replace(/\s+/g, '_');
      const fileName = `IPDR_Analysis_${safeCase}_${formatDate(new Date())}.xlsx`;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      XLSX.writeFile(workbook, fileName);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="analysis-shell flex h-full flex-col">
      {/* Header */}
      <header className="analysis-topbar flex min-h-20 shrink-0 items-center justify-between px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onBack} className="material-symbols-outlined text-slate-500 hover:text-blue-500">arrow_back</button>
          <span className="material-symbols-outlined text-blue-500">wifi_tethering</span>
          <div>
            <h1 className="text-xl font-bold">IPDR Analytics</h1>
            <p className="text-xs text-slate-500">{caseName} • {operator || 'AUTO'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={handleExportExcel} disabled={isExporting} className="px-3 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">{isExporting ? 'Exporting...' : 'Export Excel'}</button>
          </div>
        </div>
        <div className="font-mono text-sm">{currentTime.toLocaleTimeString()}</div>
      </header>

      {isExporting && (
        <div className="fixed inset-0 z-[100] bg-slate-900/30 backdrop-blur-[1px] flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center gap-3">
            <span className="material-symbols-outlined animate-spin text-blue-600 dark:text-blue-400">progress_activity</span>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Preparing Excel export</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Please wait...</div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <AnalysisTabBar
        value={selectedTab}
        onChange={setSelectedTab}
        tabs={[
          { id: 'overview', label: 'Overview', icon: 'overview' },
          { id: 'records', label: 'Records', icon: 'records' },
          { id: 'analysis', label: 'Advanced Analysis', icon: 'analysis' },
          { id: 'map', label: 'Map View', icon: 'map' },
          { id: 'charts', label: 'Charts', icon: 'charts' }
        ]}
      />

      {/* Content */}
      <div className="analysis-content custom-scrollbar flex-1 overflow-y-auto p-6">
        {isLoading && data.length === 0 ? (
          <div className="mb-6 rounded-2xl border border-cyan-200 bg-cyan-50/80 px-4 py-3 text-sm text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-200">
            Loading IPDR records in the background. Summary cards stay available while the detailed dataset finishes loading.
          </div>
        ) : null}

        {selectedTab === 'overview' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="analysis-panel p-4">
                <div className="text-sm text-slate-500">{getMetricUiLabel('total_records', 'Total Records')}</div>
                <div className="text-2xl font-bold">{overviewStats.totalRecords.toLocaleString()}</div>
              </div>
              <div className="analysis-panel p-4">
                <div className="text-sm text-slate-500">Data Volume</div>
                <div className="text-2xl font-bold">{overviewStats.totalVolume}</div>
              </div>
              <div className="analysis-panel p-4">
                <div className="text-sm text-slate-500">Unique IPs</div>
                <div className="text-2xl font-bold">{overviewStats.uniqueIPs.toLocaleString()}</div>
              </div>
              <div className="analysis-panel p-4">
                <div className="text-sm text-slate-500">Unique MSISDNs</div>
                <div className="text-2xl font-bold">{overviewStats.uniqueMSISDNs.toLocaleString()}</div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="analysis-panel h-80">
                  <div className="text-lg font-bold mb-4">Hourly Traffic Volume (MB)</div>
                  <div className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trafficByHourData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                        <XAxis dataKey="hourLabel" />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="uplinkMB" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="downlinkMB" stroke="#10b981" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
               </div>
               <div className="analysis-panel h-80">
                  <div className="text-lg font-bold mb-4">Top Ports</div>
                  <div className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topPortsData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                        <XAxis dataKey="name" tick={{fontSize: 10}} interval={0} angle={-45} textAnchor="end" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill="#f59e0b" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
               </div>
            </div>
          </div>
        )}

        {selectedTab === 'records' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="analysis-panel grid grid-cols-1 gap-4 p-4 md:grid-cols-3 lg:grid-cols-6">
              <input 
                placeholder="Search..." 
                className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              <input 
                placeholder="Filter MSISDN" 
                className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                value={msisdnFilter}
                onChange={e => setMsisdnFilter(e.target.value)}
              />
              <input 
                placeholder="Filter IMEI" 
                className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                value={imeiFilter}
                onChange={e => setImeiFilter(e.target.value)}
              />
              <input 
                placeholder="Filter IMSI" 
                className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                value={imsiFilter}
                onChange={e => setImsiFilter(e.target.value)}
              />
              <input 
                placeholder="Filter IP" 
                className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                value={ipFilter}
                onChange={e => setIpFilter(e.target.value)}
              />
              <button 
                onClick={() => { setSearchTerm(''); setMsisdnFilter(''); setImeiFilter(''); setImsiFilter(''); setIpFilter(''); }}
                className="px-3 py-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
              >
                Clear Filters
              </button>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              {recordsError ? (
                <div className="border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {recordsError}
                </div>
              ) : null}
              {recordsLoading ? (
                <div className="border-b border-cyan-200 bg-cyan-50 px-4 py-3 text-sm text-cyan-700 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-200">
                  Loading IPDR records...
                </div>
              ) : null}
              <div className="max-h-[50vh] overflow-y-auto">
                <RecordTable rows={recordsRows as unknown as Record<string, unknown>[]} maxRows={50} />
              </div>
              <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
               <span className="text-sm text-slate-500">Showing {recordsShowingStart}-{recordsShowingEnd} of {recordsResultCount} records</span>
                 <div className="flex gap-2">
                    <button 
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded disabled:opacity-50"
                    >Prev</button>
                    <button 
                      disabled={currentPage === recordsTotalPages}
                      onClick={() => setCurrentPage(p => Math.min(recordsTotalPages, p + 1))}
                      className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded disabled:opacity-50"
                    >Next</button>
                 </div>
              </div>
            </div>
          </div>
        )}
        {selectedTab === 'analysis' && (
          <div className="space-y-4">
            <div className="max-w-7xl mx-auto space-y-4">
              {MODULES.map(module => {
                return (
                  <div key={module.id} className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden shadow-sm">
                    <div className="w-full p-4 flex items-center justify-between bg-slate-50/60 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${getColorClass(module.color)}`}>
                          <span className="material-symbols-outlined text-lg">{module.icon}</span>
                        </div>
                        <div className="text-left">
                          <h3 className="font-bold text-slate-900 dark:text-white text-sm">{module.title}</h3>
                          <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${getColorClass(module.color)}`}>{module.tag}</span>
                        </div>
                      </div>
                    </div>
                    <div className="p-4">
                        {module.id === 'top_msisdn' && (
                          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                                <tr>
                                  <th className="px-4 py-3 text-left">MSISDN</th>
                                  <th className="px-4 py-3 text-right">Sessions</th>
                                  <th className="px-4 py-3 text-right">Total Data</th>
                                  <th className="px-4 py-3 text-right">Total Duration</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {topMsisdnData.map((row, i) => (
                                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                    <td className="px-4 py-3 font-mono text-emerald-600 dark:text-emerald-400 font-medium">{row.msisdn}</td>
                                    <td className="px-4 py-3 text-right font-bold">{row.count}</td>
                                    <td className="px-4 py-3 text-right text-slate-500">{formatBytes(row.totalData)}</td>
                                    <td className="px-4 py-3 text-right text-slate-500">{formatDuration(row.totalDuration)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {module.id === 'top_imei' && (
                          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                                <tr>
                                  <th className="px-4 py-3 text-left">IMEI</th>
                                  <th className="px-4 py-3 text-right">Count</th>
                                  <th className="px-4 py-3 text-right">Unique MSISDNs</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {topImeiData.map((row, i) => (
                                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                    <td className="px-4 py-3 font-mono text-orange-600 dark:text-orange-400">{row.imei}</td>
                                    <td className="px-4 py-3 text-right font-bold">{row.count}</td>
                                    <td className="px-4 py-3 text-right text-slate-500">{row.uniqueMsisdns}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {module.id === 'top_imsi' && (
                          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-sm">
                              <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                                <tr>
                                  <th className="px-4 py-3 text-left">IMSI</th>
                                  <th className="px-4 py-3 text-right">Count</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                {topImsiData.map((row, i) => (
                                  <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                    <td className="px-4 py-3 font-mono text-indigo-600 dark:text-indigo-400">{row.imsi}</td>
                                    <td className="px-4 py-3 text-right font-bold">{row.count}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {module.id === 'ip_analysis' && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                              <div className="px-4 py-2 bg-cyan-50 dark:bg-cyan-900/20 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-xs font-bold text-cyan-700 dark:text-cyan-400">Top Source IPs</span>
                              </div>
                              <table className="w-full text-sm">
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {ipAnalysisData.sourceIps.map((row, i) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-2 font-mono text-sm">{row.ip}</td>
                                      <td className="px-4 py-2 text-right font-bold">{row.count}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                              <div className="px-4 py-2 bg-purple-50 dark:bg-purple-900/20 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-xs font-bold text-purple-700 dark:text-purple-400">Top Destination IPs</span>
                              </div>
                              <table className="w-full text-sm">
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {ipAnalysisData.destIps.map((row, i) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-2 font-mono text-sm">{row.ip}</td>
                                      <td className="px-4 py-2 text-right font-bold">{row.count}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                              <div className="px-4 py-2 bg-sky-50 dark:bg-sky-900/20 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-xs font-bold text-sky-700 dark:text-sky-400">Source Countries / ASNs</span>
                              </div>
                              <table className="w-full text-sm">
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {ipIntelData.sourceCountries.map((row, i) => (
                                    <tr key={`sc-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-2 text-sm">{row.label}</td>
                                      <td className="px-4 py-2 text-right font-bold">{row.count}</td>
                                    </tr>
                                  ))}
                                  {ipIntelData.sourceAsns.slice(0, 8).map((row, i) => (
                                    <tr key={`sa-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{row.label}</td>
                                      <td className="px-4 py-2 text-right font-bold">{row.count}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                              <div className="px-4 py-2 bg-violet-50 dark:bg-violet-900/20 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-xs font-bold text-violet-700 dark:text-violet-400">Destination Countries / ASNs</span>
                              </div>
                              <table className="w-full text-sm">
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {ipIntelData.destinationCountries.map((row, i) => (
                                    <tr key={`dc-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-2 text-sm">{row.label}</td>
                                      <td className="px-4 py-2 text-right font-bold">{row.count}</td>
                                    </tr>
                                  ))}
                                  {ipIntelData.destinationAsns.slice(0, 8).map((row, i) => (
                                    <tr key={`da-${i}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300">{row.label}</td>
                                      <td className="px-4 py-2 text-right font-bold">{row.count}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {module.id === 'ip_scrutiny' && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                              <div className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase">Foreign Session Exposure</div>
                              <div className="mt-2 text-2xl font-bold text-blue-800 dark:text-blue-200">{ipScrutinyData.foreignSessions}</div>
                              <div className="text-xs text-blue-700 dark:text-blue-300">{ipScrutinyData.foreignRatio}% of total sessions</div>
                            </div>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                              <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/30 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Suspicious ASN/Hosting Patterns</span>
                              </div>
                              <table className="w-full text-sm">
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {ipScrutinyData.topSuspiciousAsn.slice(0, 10).map((row, i) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-2 text-xs">{row.asn}</td>
                                      <td className="px-4 py-2 text-right font-bold">{row.count}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div className="md:col-span-2 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                              <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-b border-slate-200 dark:border-slate-700">
                                <span className="text-xs font-bold text-amber-700 dark:text-amber-300">High Fan-out Numbers (many destination IPs)</span>
                              </div>
                              <table className="w-full text-sm">
                                <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                                  <tr>
                                    <th className="px-4 py-2 text-left">MSISDN</th>
                                    <th className="px-4 py-2 text-right">Unique Dest IPs</th>
                                    <th className="px-4 py-2 text-right">Sessions</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {ipScrutinyData.highFanout.map((row, i) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-2 font-mono">{row.msisdn}</td>
                                      <td className="px-4 py-2 text-right font-bold">{row.uniqueDestIps}</td>
                                      <td className="px-4 py-2 text-right">{row.sessions}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}
                        {module.id === 'data_usage' && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
                              <span className="material-symbols-outlined text-emerald-500 text-2xl">upload</span>
                              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-2">{formatBytes(dataUsageData.totalUp)}</p>
                              <p className="text-xs text-emerald-600">Total Upload</p>
                            </div>
                            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                              <span className="material-symbols-outlined text-blue-500 text-2xl">download</span>
                              <p className="text-2xl font-bold text-blue-700 dark:text-blue-400 mt-2">{formatBytes(dataUsageData.totalDown)}</p>
                              <p className="text-xs text-blue-600">Total Download</p>
                            </div>
                            <div className="p-4 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800">
                              <span className="material-symbols-outlined text-purple-500 text-2xl">timer</span>
                              <p className="text-2xl font-bold text-purple-700 dark:text-purple-400 mt-2">{formatDuration(dataUsageData.totalDuration)}</p>
                              <p className="text-xs text-purple-600">Total Duration</p>
                            </div>
                            <div className="p-4 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                              <span className="material-symbols-outlined text-slate-500 text-2xl">dataset</span>
                              <p className="text-2xl font-bold text-slate-700 dark:text-slate-300 mt-2">{dataUsageData.sessions.toLocaleString()}</p>
                              <p className="text-xs text-slate-600">Total Sessions</p>
                            </div>
                          </div>
                        )}
                        {module.id === 'common_msisdn' && (
                          commonMsisdnData.hasMultipleFiles ? (
                            commonMsisdnData.common.length > 0 ? (
                              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                                <div className="p-3 bg-teal-50 dark:bg-teal-900/20 border-b">
                                  <p className="text-xs text-teal-700 dark:text-teal-400">Found {commonMsisdnData.common.length} common mobile numbers across files</p>
                                </div>
                                <table className="w-full text-sm">
                                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                                    <tr>
                                      <th className="px-4 py-3 text-left">Common MSISDN</th>
                                      <th className="px-4 py-3 text-right">Total Occurrences</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {commonMsisdnData.common.slice(0, 50).map((row, i) => (
                                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="px-4 py-3 font-mono text-teal-600 dark:text-teal-400">{row.number}</td>
                                        <td className="px-4 py-3 text-right font-bold">{row.totalCount}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="p-6 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-center">
                                <span className="material-symbols-outlined text-amber-500 text-3xl mb-2">search_off</span>
                                <p className="text-amber-700 dark:text-amber-400 font-medium">No Common Mobile Numbers Found</p>
                              </div>
                            )
                          ) : (
                            <div className="p-6 bg-teal-50 dark:bg-teal-900/20 rounded-lg border border-teal-200 dark:border-teal-800 text-center">
                              <span className="material-symbols-outlined text-teal-500 text-4xl mb-3">compare_arrows</span>
                              <p className="text-teal-700 dark:text-teal-400 font-bold text-lg">Compare IPDR Files</p>
                              <p className="text-sm text-teal-600 dark:text-teal-500 mt-2">Upload 2 or more IPDR files to find common mobile numbers.</p>
                            </div>
                          )
                        )}
                        {module.id === 'common_imei' && (
                          commonImeiData.hasMultipleFiles ? (
                            commonImeiData.common.length > 0 ? (
                              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                                <div className="p-3 bg-rose-50 dark:bg-rose-900/20 border-b">
                                  <p className="text-xs text-rose-700 dark:text-rose-400">Found {commonImeiData.common.length} common IMEI across files</p>
                                </div>
                                <table className="w-full text-sm">
                                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                                    <tr>
                                      <th className="px-4 py-3 text-left">Common IMEI</th>
                                      <th className="px-4 py-3 text-right">Total Occurrences</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {commonImeiData.common.slice(0, 50).map((row, i) => (
                                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="px-4 py-3 font-mono text-rose-600 dark:text-rose-400">{row.imei}</td>
                                        <td className="px-4 py-3 text-right font-bold">{row.totalCount}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="p-6 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-center">
                                <span className="material-symbols-outlined text-amber-500 text-3xl mb-2">search_off</span>
                                <p className="text-amber-700 dark:text-amber-400 font-medium">No Common IMEI Found</p>
                              </div>
                            )
                          ) : (
                            <div className="p-6 bg-rose-50 dark:bg-rose-900/20 rounded-lg border border-rose-200 dark:border-rose-800 text-center">
                              <span className="material-symbols-outlined text-rose-500 text-4xl mb-3">devices</span>
                              <p className="text-rose-700 dark:text-rose-400 font-bold text-lg">Compare IPDR Files</p>
                              <p className="text-sm text-rose-600 dark:text-rose-500 mt-2">Upload 2 or more IPDR files to find common IMEI.</p>
                            </div>
                          )
                        )}
                        {module.id === 'imei_multi_sim' && (
                          imeiMultiSimData.length > 0 ? (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 border-b">
                                <p className="text-xs text-amber-700 dark:text-amber-400">Found {imeiMultiSimData.length} devices with multiple SIMs</p>
                              </div>
                              <table className="w-full text-sm">
                                <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                                  <tr>
                                    <th className="px-4 py-3 text-left">IMEI</th>
                                    <th className="px-4 py-3 text-right">SIM Count</th>
                                    <th className="px-4 py-3 text-left">SIMs/IMSIs</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {imeiMultiSimData.map((row, i) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-3 font-mono text-amber-600 dark:text-amber-400">{row.imei}</td>
                                      <td className="px-4 py-3 text-right font-bold">{row.simCount}</td>
                                      <td className="px-4 py-3 text-xs text-slate-500">{row.sims.slice(0, 3).join(', ')}{row.sims.length > 3 ? '...' : ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="p-6 bg-slate-50 dark:bg-slate-900/30 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                              <span className="material-symbols-outlined text-slate-400 text-3xl mb-2">check_circle</span>
                              <p className="text-slate-600 dark:text-slate-400 font-medium">No IMEI with multiple SIMs found</p>
                            </div>
                          )
                        )}
                        {module.id === 'sim_multi_imei' && (
                          simMultiImeiData.length > 0 ? (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                              <div className="p-3 bg-lime-50 dark:bg-lime-900/20 border-b">
                                <p className="text-xs text-lime-700 dark:text-lime-400">Found {simMultiImeiData.length} SIMs with multiple devices</p>
                              </div>
                              <table className="w-full text-sm">
                                <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                                  <tr>
                                    <th className="px-4 py-3 text-left">IMSI/MSISDN</th>
                                    <th className="px-4 py-3 text-right">Device Count</th>
                                    <th className="px-4 py-3 text-left">Devices (IMEI)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {simMultiImeiData.map((row, i) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-3 font-mono text-lime-600 dark:text-lime-400">{row.imsi}</td>
                                      <td className="px-4 py-3 text-right font-bold">{row.imeiCount}</td>
                                      <td className="px-4 py-3 text-xs text-slate-500">{row.imeis.slice(0, 3).join(', ')}{row.imeis.length > 3 ? '...' : ''}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="p-6 bg-slate-50 dark:bg-slate-900/30 rounded-lg border border-slate-200 dark:border-slate-700 text-center">
                              <span className="material-symbols-outlined text-slate-400 text-3xl mb-2">check_circle</span>
                              <p className="text-slate-600 dark:text-slate-400 font-medium">No SIM with multiple devices found</p>
                            </div>
                          )
                        )}
                        {module.id === 'roaming_summary' && (
                          roamingSummaryData.hasData ? (
                            <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                              <table className="w-full text-sm">
                                <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                                  <tr>
                                    <th className="px-4 py-3 text-left">Circle / State</th>
                                    <th className="px-4 py-3 text-right">Session Count</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                  {roamingSummaryData.circles.map((row, i) => (
                                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-4 py-3 font-medium text-violet-600 dark:text-violet-400">{row.circle}</td>
                                      <td className="px-4 py-3 text-right font-bold">{row.count}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="p-6 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-center">
                              <span className="material-symbols-outlined text-amber-500 text-3xl mb-2">info</span>
                              <p className="text-amber-700 dark:text-amber-400 font-medium">Roaming data not available</p>
                              <p className="text-sm text-amber-600 dark:text-amber-500 mt-1">This IPDR file does not contain roaming circle information.</p>
                            </div>
                          )
                        )}
                  
                      </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {selectedTab === 'map' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div>
                <div className="text-lg font-bold">IPDR Map View</div>
                <div className="text-sm text-slate-500">CGI latitude/longitude based hotspots ({mapPoints.length} points)</div>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="h-[620px]">
                {mapPoints.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 dark:text-slate-400">
                    <div className="text-center px-6">
                      <span className="material-symbols-outlined text-5xl mb-2">location_off</span>
                      <div className="font-semibold">No IPDR coordinates found</div>
                      <div className="text-sm">Need `cgi_lat` and `cgi_long` fields in uploaded data.</div>
                    </div>
                  </div>
                ) : (
                  <MapContainer
                    center={[20.5937, 78.9629]}
                    zoom={5}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <FitIpdrMapBounds points={mapPoints} />
                    {mapPoints.map((point) => {
                      const radius = Math.max(4, Math.min(14, 4 + Math.log10(point.count + 1) * 4));
                      return (
                        <CircleMarker
                          key={point.id}
                          center={[point.lat, point.lng]}
                          radius={radius}
                          pathOptions={{ color: '#0ea5e9', fillColor: '#38bdf8', fillOpacity: 0.65, weight: 1.5 }}
                        >
                          <Popup>
                            <div className="text-sm">
                              <div className="font-semibold">{point.label}</div>
                              <div>Sessions: {point.count}</div>
                              {point.details ? <div>{point.details}</div> : null}
                              <div>{point.lat.toFixed(6)}, {point.lng.toFixed(6)}</div>
                            </div>
                          </Popup>
                        </CircleMarker>
                      );
                    })}
                  </MapContainer>
                )}
              </div>
            </div>
          </div>
        )}
        {selectedTab === 'charts' && (
          <div className="space-y-6">
            {data.length === 0 ? (
              <div className="p-6 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 text-center">
                <span className="material-symbols-outlined text-amber-500 text-3xl mb-2">info</span>
                <p className="text-amber-700 dark:text-amber-400 font-medium">No IPDR data available</p>
                <p className="text-sm text-amber-600 dark:text-amber-500 mt-1">Upload IPDR files to view charts.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 h-80">
                  <div className="text-lg font-bold mb-4">Hourly Traffic (Total MB)</div>
                  <div className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trafficByHourData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                        <XAxis dataKey="hourLabel" />
                        <YAxis />
                        <Tooltip />
                        <Line type="monotone" dataKey="totalMB" stroke="#3b82f6" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 h-80">
                  <div className="text-lg font-bold mb-4">Top Ports</div>
                  <div className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topPortsData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill="#f59e0b" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 h-80">
                  <div className="text-lg font-bold mb-4">{`${getMetricUiLabel('top_msisdn', 'Top MSISDN')} (Sessions)`}</div>
                  <div className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topMsisdnChartData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill="#10b981" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 h-80">
                  <div className="text-lg font-bold mb-4">Top IMEI (Sessions)</div>
                  <div className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topImeiChartData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill="#f97316" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 h-80">
                  <div className="text-lg font-bold mb-4">Top IMSI (Sessions)</div>
                  <div className="h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topImsiChartData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" />
                        <YAxis />
                        <Tooltip />
                        <Bar dataKey="value" fill="#6366f1" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="bg-white dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 h-80">
                  <div className="text-lg font-bold mb-4">Roaming Circles</div>
                  <div className="h-full">
                    {roamingChartData.length === 0 ? (
                      <div className="h-full flex items-center justify-center text-slate-500">No roaming data</div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={roamingChartData}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" />
                          <YAxis />
                          <Tooltip />
                          <Bar dataKey="value" fill="#8b5cf6" />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
