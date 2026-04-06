import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, BarChart, Bar, PieChart, Pie, Cell, Legend } from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as XLSX from 'xlsx-js-style';
import { encodeSpreadsheetRows } from '../lib/security';
import { RecordTable } from './RecordTable';
import { AnalysisTabBar } from './AnalysisTabBar';
import { parseILD, type ILDOperator, type NormalizedILD } from '../utils/ildNormalization';
import { ildAPI, ildFileAPI } from '../lib/apis';

interface ILDAnalysisProps {
  caseId?: string;
  caseName?: string;
  operator?: string;
  parsedData?: NormalizedILD[];
  fileCount?: number;
  onBack?: () => void;
}

type TabId = 'overview' | 'records' | 'advanced' | 'map' | 'charts';
type SheetRow = Record<string, string | number | null>;

const formatDate = (date: Date) => date.toISOString().split('T')[0];
const formatTime = (date: Date) => date.toLocaleTimeString();

const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return [hrs, mins, secs].map(v => String(v).padStart(2, '0')).join(':');
};

const getProvider = (record: NormalizedILD, operator?: string) => {
  return record.carrier || record.orig_carr_name || record.term_carr_name || record.operator_name || operator || '';
};

const getDirectionInfo = (record: NormalizedILD) => {
  const type = (record.call_type || '').toUpperCase();
  const dir = (record.call_direction || '').toUpperCase();
  const combined = `${type} ${dir}`;
  const isSms = combined.includes('SMS') || combined.includes('MSG');
  let direction: 'IN' | 'OUT' | 'OTHER' = 'OTHER';
  if (combined.includes('IN') || combined.includes('MTC') || combined.includes('TERM') || combined.includes('INCOMING')) {
    direction = 'IN';
  } else if (combined.includes('OUT') || combined.includes('MOC') || combined.includes('ORIG') || combined.includes('OUTGOING')) {
    direction = 'OUT';
  }
  return { isSms, direction };
};

const getRecordTimeInfo = (record: NormalizedILD) => {
  const date = record.call_date?.trim() || '';
  const time = record.call_time?.trim() || '';
  let ts: number | null = null;
  if (date && time) {
    const dt = new Date(`${date}T${time}`);
    if (!isNaN(dt.getTime())) ts = dt.getTime();
  }
  if (ts === null && date) {
    const dt = new Date(date);
    if (!isNaN(dt.getTime())) ts = dt.getTime();
  }
  const key = `${date} ${time}`.trim();
  return { date, time, ts, key: key || null };
};

interface IldMapPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  count: number;
  details?: string;
}

const FitIldMapBounds: React.FC<{ points: IldMapPoint[] }> = ({ points }) => {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, points]);

  return null;
};

const applyHeaderStylesAndFilter = (ws: XLSX.WorkSheet, headers: string[], headerColor = 'FFF59E0B') => {
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
    const fillColor = row % 2 === 0 ? 'FFFDF6E3' : 'FFFFFFFF';
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

const buildIldSheets = (records: NormalizedILD[], operator?: string) => {
  const mappingHeaders = [
    'ILD',
    'B_Party',
    'B_Party_SDR',
    'Provider',
    'Type',
    'Total_Calls',
    'Out_Calls',
    'In_Calls',
    'Out_SMS',
    'In_SMS',
    'Other_Calls',
    'Total_Duration',
    'Total_Days',
    'Total_CellIDs',
    'Total_IMEI',
    'Total_IMSI',
    'First_Call_Date',
    'First_Call_Time',
    'Last_Call_Date',
    'Last_Call_Time'
  ];

  const mappingMap = new Map<string, {
    ild: string;
    bParty: string;
    provider: string;
    totalCalls: number;
    outCalls: number;
    inCalls: number;
    outSms: number;
    inSms: number;
    otherCalls: number;
    totalDuration: number;
    dates: Set<string>;
    cellIds: Set<string>;
    imei: Set<string>;
    imsi: Set<string>;
    types: Set<string>;
    firstTs: number | null;
    lastTs: number | null;
    firstKey: string | null;
    lastKey: string | null;
    firstDate: string;
    firstTime: string;
    lastDate: string;
    lastTime: string;
  }>();

  records.forEach(record => {
    const ild = record.calling_party_number?.trim() || 'UNKNOWN';
    const bParty = record.called_party_number?.trim() || 'UNKNOWN';
    const provider = getProvider(record, operator);
    const key = `${ild}||${bParty}||${provider}`;
    if (!mappingMap.has(key)) {
      mappingMap.set(key, {
        ild,
        bParty,
        provider,
        totalCalls: 0,
        outCalls: 0,
        inCalls: 0,
        outSms: 0,
        inSms: 0,
        otherCalls: 0,
        totalDuration: 0,
        dates: new Set(),
        cellIds: new Set(),
        imei: new Set(),
        imsi: new Set(),
        types: new Set(),
        firstTs: null,
        lastTs: null,
        firstKey: null,
        lastKey: null,
        firstDate: '',
        firstTime: '',
        lastDate: '',
        lastTime: ''
      });
    }
    const entry = mappingMap.get(key);
    if (!entry) return;
    const { isSms, direction } = getDirectionInfo(record);
    entry.totalCalls += 1;
    if (isSms) {
      if (direction === 'IN') entry.inSms += 1;
      else if (direction === 'OUT') entry.outSms += 1;
      else entry.otherCalls += 1;
    } else {
      if (direction === 'IN') entry.inCalls += 1;
      else if (direction === 'OUT') entry.outCalls += 1;
      else entry.otherCalls += 1;
    }
    entry.totalDuration += record.call_duration_sec || 0;
    if (record.call_date) entry.dates.add(record.call_date);
    const cellId = record.first_cell_id || record.last_cell_id;
    if (cellId) entry.cellIds.add(cellId);
    if (record.call_type) entry.types.add(record.call_type);
    if (record.call_direction) entry.types.add(record.call_direction);

    const timeInfo = getRecordTimeInfo(record);
    if (timeInfo.ts !== null) {
      if (entry.firstTs === null || timeInfo.ts < entry.firstTs) {
        entry.firstTs = timeInfo.ts;
        entry.firstDate = timeInfo.date;
        entry.firstTime = timeInfo.time;
      }
      if (entry.lastTs === null || timeInfo.ts > entry.lastTs) {
        entry.lastTs = timeInfo.ts;
        entry.lastDate = timeInfo.date;
        entry.lastTime = timeInfo.time;
      }
    } else if (timeInfo.key) {
      if (!entry.firstKey || timeInfo.key < entry.firstKey) {
        entry.firstKey = timeInfo.key;
        entry.firstDate = timeInfo.date;
        entry.firstTime = timeInfo.time;
      }
      if (!entry.lastKey || timeInfo.key > entry.lastKey) {
        entry.lastKey = timeInfo.key;
        entry.lastDate = timeInfo.date;
        entry.lastTime = timeInfo.time;
      }
    }
  });

  const mappingRows: SheetRow[] = Array.from(mappingMap.values()).map(entry => ({
    ILD: entry.ild,
    B_Party: entry.bParty,
    B_Party_SDR: '',
    Provider: entry.provider,
    Type: entry.types.size <= 1 ? (entry.types.values().next().value || 'UNKNOWN') : 'MIXED',
    Total_Calls: entry.totalCalls,
    Out_Calls: entry.outCalls,
    In_Calls: entry.inCalls,
    Out_SMS: entry.outSms,
    In_SMS: entry.inSms,
    Other_Calls: entry.otherCalls,
    Total_Duration: entry.totalDuration,
    Total_Days: entry.dates.size,
    Total_CellIDs: entry.cellIds.size,
    Total_IMEI: entry.imei.size,
    Total_IMSI: entry.imsi.size,
    First_Call_Date: entry.firstDate,
    First_Call_Time: entry.firstTime,
    Last_Call_Date: entry.lastDate,
    Last_Call_Time: entry.lastTime
  }));

  const mappingCompactHeaders = ['ILD', 'B_Party', 'B_Party_SDR', 'Total_Calls', 'Provider'];
  const mappingCompactRows: SheetRow[] = mappingRows.map(row => ({
    ILD: row.ILD || '',
    B_Party: row.B_Party || '',
    B_Party_SDR: row.B_Party_SDR || '',
    Total_Calls: row.Total_Calls || 0,
    Provider: row.Provider || ''
  }));

  const maxDirectionHeaders = ['ILD', 'B_Party', 'B_Party_SDR', 'Total_Duration', 'Provider'];
  const maxDirectionMap = new Map<string, SheetRow & { totalDuration: number; totalCalls: number }>();
  mappingRows.forEach(row => {
    const ild = String(row.ILD || '');
    const totalDuration = Number(row.Total_Duration || 0);
    const totalCalls = Number(row.Total_Calls || 0);
    const current = maxDirectionMap.get(ild);
    if (!current || totalDuration > current.totalDuration || (totalDuration === current.totalDuration && totalCalls > current.totalCalls)) {
      maxDirectionMap.set(ild, {
        ILD: row.ILD || '',
        B_Party: row.B_Party || '',
        B_Party_SDR: row.B_Party_SDR || '',
        Total_Duration: totalDuration,
        Provider: row.Provider || '',
        totalDuration,
        totalCalls
      });
    }
  });
  const maxDirectionRows: SheetRow[] = Array.from(maxDirectionMap.values()).map(row => ({
    ILD: row.ILD || '',
    B_Party: row.B_Party || '',
    B_Party_SDR: row.B_Party_SDR || '',
    Total_Duration: row.Total_Duration || 0,
    Provider: row.Provider || ''
  }));

  const maxStayHeaders = ['ILD', 'Cell_ID', 'Total_Calls', 'Tower_Address', 'Latitude', 'Longitude', 'Azimuth'];
  const cellMap = new Map<string, { ild: string; cellId: string; totalCalls: number }>();
  records.forEach(record => {
    const ild = record.calling_party_number?.trim() || 'UNKNOWN';
    const cellId = record.first_cell_id || record.last_cell_id;
    if (!cellId) return;
    const key = `${ild}||${cellId}`;
    if (!cellMap.has(key)) {
      cellMap.set(key, { ild, cellId, totalCalls: 0 });
    }
    const entry = cellMap.get(key);
    if (entry) entry.totalCalls += 1;
  });
  const maxStayByIld = new Map<string, { ild: string; cellId: string; totalCalls: number }>();
  cellMap.forEach(entry => {
    const current = maxStayByIld.get(entry.ild);
    if (!current || entry.totalCalls > current.totalCalls) {
      maxStayByIld.set(entry.ild, entry);
    }
  });
  const maxStayRows: SheetRow[] = Array.from(maxStayByIld.values()).map(entry => ({
    ILD: entry.ild,
    Cell_ID: entry.cellId,
    Total_Calls: entry.totalCalls,
    Tower_Address: '',
    Latitude: '',
    Longitude: '',
    Azimuth: ''
  }));

  const maxStayCallsHeaders = ['ILD', 'B_Party', 'B_Party_SDR', 'Cell_ID', 'Total_Calls', 'Tower_Address', 'Latitude', 'Longitude', 'Azimuth'];
  const maxStayCallsRows: SheetRow[] = Array.from(maxStayByIld.values()).map(entry => {
    const bPartyMap = new Map<string, number>();
    records.forEach(record => {
      const ild = record.calling_party_number?.trim() || 'UNKNOWN';
      const cellId = record.first_cell_id || record.last_cell_id;
      if (ild !== entry.ild || cellId !== entry.cellId) return;
      const bParty = record.called_party_number?.trim() || 'UNKNOWN';
      bPartyMap.set(bParty, (bPartyMap.get(bParty) || 0) + 1);
    });
    let maxBParty = '';
    let maxCalls = 0;
    bPartyMap.forEach((count, bParty) => {
      if (count > maxCalls) {
        maxCalls = count;
        maxBParty = bParty;
      }
    });
    return {
      ILD: entry.ild,
      B_Party: maxBParty,
      B_Party_SDR: '',
      Cell_ID: entry.cellId,
      Total_Calls: maxCalls,
      Tower_Address: '',
      Latitude: '',
      Longitude: '',
      Azimuth: ''
    };
  });

  const otherStateHeaders = ['ILD', 'Circle', 'Total_Calls', 'Out_Calls', 'In_Calls', 'Out_SMS', 'In_SMS', 'Other_Calls', 'Total_Duration'];
  const circleCounts = new Map<string, Map<string, number>>();
  records.forEach(record => {
    const ild = record.calling_party_number?.trim() || 'UNKNOWN';
    const circle = record.circle?.trim() || '';
    if (!circle) return;
    if (!circleCounts.has(ild)) circleCounts.set(ild, new Map());
    const map = circleCounts.get(ild);
    if (!map) return;
    map.set(circle, (map.get(circle) || 0) + 1);
  });
  const homeCircleByIld = new Map<string, string>();
  circleCounts.forEach((map, ild) => {
    let home = '';
    let max = 0;
    map.forEach((count, circle) => {
      if (count > max) {
        max = count;
        home = circle;
      }
    });
    if (home) homeCircleByIld.set(ild, home);
  });

  const otherStateMap = new Map<string, {
    ild: string;
    circle: string;
    totalCalls: number;
    outCalls: number;
    inCalls: number;
    outSms: number;
    inSms: number;
    otherCalls: number;
    totalDuration: number;
  }>();
  records.forEach(record => {
    const ild = record.calling_party_number?.trim() || 'UNKNOWN';
    const circle = record.circle?.trim() || '';
    const homeCircle = homeCircleByIld.get(ild);
    if (!circle || (homeCircle && circle === homeCircle)) return;
    const key = `${ild}||${circle}`;
    if (!otherStateMap.has(key)) {
      otherStateMap.set(key, {
        ild,
        circle,
        totalCalls: 0,
        outCalls: 0,
        inCalls: 0,
        outSms: 0,
        inSms: 0,
        otherCalls: 0,
        totalDuration: 0
      });
    }
    const entry = otherStateMap.get(key);
    if (!entry) return;
    const { isSms, direction } = getDirectionInfo(record);
    entry.totalCalls += 1;
    if (isSms) {
      if (direction === 'IN') entry.inSms += 1;
      else if (direction === 'OUT') entry.outSms += 1;
      else entry.otherCalls += 1;
    } else {
      if (direction === 'IN') entry.inCalls += 1;
      else if (direction === 'OUT') entry.outCalls += 1;
      else entry.otherCalls += 1;
    }
    entry.totalDuration += record.call_duration_sec || 0;
  });
  const otherStateRows: SheetRow[] = Array.from(otherStateMap.values()).map(entry => ({
    ILD: entry.ild,
    Circle: entry.circle,
    Total_Calls: entry.totalCalls,
    Out_Calls: entry.outCalls,
    In_Calls: entry.inCalls,
    Out_SMS: entry.outSms,
    In_SMS: entry.inSms,
    Other_Calls: entry.otherCalls,
    Total_Duration: entry.totalDuration
  }));

  return [
    { name: '1_Mapping', headers: mappingHeaders, rows: mappingRows },
    { name: '2_Mapping', headers: mappingCompactHeaders, rows: mappingCompactRows },
    { name: '3_MaxDirection', headers: maxDirectionHeaders, rows: maxDirectionRows },
    { name: '4_MaxStay', headers: maxStayHeaders, rows: maxStayRows },
    { name: '5_MaxStay_Calls', headers: maxStayCallsHeaders, rows: maxStayCallsRows },
    { name: '6_OtherStateContactSummary', headers: otherStateHeaders, rows: otherStateRows }
  ];
};

export const ILDAnalysis: React.FC<ILDAnalysisProps> = ({ caseId, caseName, operator, parsedData, fileCount = 1, onBack }) => {
  const [data, setData] = useState<NormalizedILD[]>(parsedData || []);
  const [isLoading, setIsLoading] = useState(!parsedData || parsedData.length === 0);
  const [selectedTab, setSelectedTab] = useState<TabId>('overview');
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'success' | 'error'>('idle');
  const [isExporting, setIsExporting] = useState(false);
  const [fileCountState, setFileCountState] = useState(fileCount);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [callTypeFilter, setCallTypeFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const [durationMinFilter, setDurationMinFilter] = useState('');
  const [durationMaxFilter, setDurationMaxFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(50);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadCaseData = useCallback(async () => {
    try {
      setIsLoading(true);
      const records = await ildAPI.getRecordsByCase(caseId || '') as NormalizedILD[];
      const parsed: NormalizedILD[] = records.map((record) => ({
        operator: record.operator || operator || '',
        call_time: record.call_time || '',
        call_date: record.call_date || '',
        calling_party_number: record.calling_party_number || '',
        called_party_number: record.called_party_number || '',
        call_duration_sec: record.call_duration_sec || 0,
        orig_switch_id: record.orig_switch_id || '',
        org_trunc_group: record.org_trunc_group || '',
        term_trunc_group: record.term_trunc_group || '',
        call_direction: record.call_direction || '',
        call_type: record.call_type || '',
        orig_carr_name: record.orig_carr_name || '',
        term_carr_name: record.term_carr_name || '',
        call_status: record.call_status || '',
        first_cell_id: record.first_cell_id || '',
        last_cell_id: record.last_cell_id || '',
        circle: record.circle || '',
        carrier: record.carrier || '',
        operator_name: record.operator_name || ''
      }));
      setData(parsed);
    } catch (error) {
      console.error('Failed to load ILD records:', error);
    } finally {
      setIsLoading(false);
    }
  }, [caseId, operator]);

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

  const handleAddFilesClick = () => {
    fileInputRef.current?.click();
  };

  const handleAddFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setSelectedFiles(prev => [...prev, ...list]);
  };

  const handleUploadFilesToCase = async () => {
    if (!caseId || !operator || selectedFiles.length === 0) return;
    try {
      setUploadStatus('uploading');
      let allParsed: NormalizedILD[] = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const content = await file.text();
        const fileIndex = fileCountState + i;
        const parsed = parseILD(content, operator as ILDOperator).map(r => ({ ...r, file_index: fileIndex, file_name: file.name }));
        allParsed = allParsed.concat(parsed);
        await ildFileAPI.upload(caseId, file, operator);
      }
      try {
        await ildAPI.insertRecords(caseId, allParsed);
      } catch (insertError: unknown) {
        const message = insertError instanceof Error ? insertError.message : String(insertError);
        console.warn('[ILDAnalysis] Insert failed for added files:', message);
      }
      await loadCaseData();
      setFileCountState(prev => prev + selectedFiles.length);
      setSelectedFiles([]);
      setUploadStatus('success');
    } catch {
      setUploadStatus('error');
    } finally {
      setTimeout(() => setUploadStatus('idle'), 1500);
    }
  };

  const handleExportExcel = async () => {
    if (isExporting) return;
    try {
      setIsExporting(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const sheets = buildIldSheets(data, operator);
      const workbook = XLSX.utils.book_new();
      for (const sheet of sheets) {
        const ws = XLSX.utils.aoa_to_sheet([sheet.headers]);
        XLSX.utils.sheet_add_json(ws, encodeSpreadsheetRows(sheet.rows), { header: sheet.headers, skipHeader: true, origin: 'A2' });
        applyHeaderStylesAndFilter(ws, sheet.headers, 'FFF59E0B');
        XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
        applySheetTabColor(workbook, sheet.name, 'FFF59E0B');
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const safeCase = (caseName || 'Case').replace(/\s+/g, '_');
      const fileName = `ILD_Analysis_${safeCase}_${formatDate(new Date())}.xlsx`;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      XLSX.writeFile(workbook, fileName);
    } finally {
      setIsExporting(false);
    }
  };

  const filteredRecords = useMemo(() => {
    let filtered = data;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r =>
        (r.calling_party_number && r.calling_party_number.toLowerCase().includes(term)) ||
        (r.called_party_number && r.called_party_number.toLowerCase().includes(term)) ||
        (r.first_cell_id && r.first_cell_id.toLowerCase().includes(term)) ||
        (r.circle && r.circle.toLowerCase().includes(term))
      );
    }
    if (callTypeFilter) {
      const ct = callTypeFilter.toLowerCase();
      filtered = filtered.filter(r => (r.call_type || '').toLowerCase().includes(ct));
    }
    if (directionFilter) {
      const df = directionFilter.toLowerCase();
      filtered = filtered.filter(r => (r.call_direction || '').toLowerCase().includes(df) || (r.call_type || '').toLowerCase().includes(df));
    }
    if (dateFromFilter) {
      filtered = filtered.filter(r => r.call_date && r.call_date >= dateFromFilter);
    }
    if (dateToFilter) {
      filtered = filtered.filter(r => r.call_date && r.call_date <= dateToFilter);
    }
    if (durationMinFilter) {
      filtered = filtered.filter(r => (r.call_duration_sec || 0) >= parseInt(durationMinFilter));
    }
    if (durationMaxFilter) {
      filtered = filtered.filter(r => (r.call_duration_sec || 0) <= parseInt(durationMaxFilter));
    }
    return filtered;
  }, [data, searchTerm, callTypeFilter, directionFilter, dateFromFilter, dateToFilter, durationMinFilter, durationMaxFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [data, searchTerm, callTypeFilter, directionFilter, dateFromFilter, dateToFilter, durationMinFilter, durationMaxFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentPageData = filteredRecords.slice(startIndex, startIndex + itemsPerPage);
  const showingStart = filteredRecords.length === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(startIndex + itemsPerPage, filteredRecords.length);

  const stats = useMemo(() => {
    const totalRecords = data.length;
    const uniqueIld = new Set(data.map(r => r.calling_party_number).filter(Boolean)).size;
    const uniqueBParty = new Set(data.map(r => r.called_party_number).filter(Boolean)).size;
    const totalDuration = data.reduce((sum, r) => sum + (r.call_duration_sec || 0), 0);
    const uniqueCircles = new Set(data.map(r => r.circle).filter(Boolean)).size;
    let incoming = 0;
    let outgoing = 0;
    let sms = 0;
    let other = 0;
    data.forEach(r => {
      const { isSms, direction } = getDirectionInfo(r);
      if (isSms) {
        sms += 1;
      } else if (direction === 'IN') {
        incoming += 1;
      } else if (direction === 'OUT') {
        outgoing += 1;
      } else {
        other += 1;
      }
    });
    return { totalRecords, uniqueIld, uniqueBParty, totalDuration, uniqueCircles, incoming, outgoing, sms, other };
  }, [data]);

  const dailyActivityData = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(r => {
      const date = r.call_date || '';
      if (!date) return;
      counts[date] = (counts[date] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const topIldData = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(r => {
      const ild = r.calling_party_number || '';
      if (!ild) return;
      counts[ild] = (counts[ild] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [data]);

  const topBPartyData = useMemo(() => {
    const counts: Record<string, number> = {};
    data.forEach(r => {
      const b = r.called_party_number || '';
      if (!b) return;
      counts[b] = (counts[b] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [data]);

  const mapPoints = useMemo<IldMapPoint[]>(() => {
    const points = new Map<string, IldMapPoint>();

    data.forEach((record, index) => {
      const row = record as unknown as Record<string, unknown>;
      const rawLat = row.first_cell_lat ?? row.last_cell_lat ?? row.latitude ?? row.lat;
      const rawLng = row.first_cell_long ?? row.last_cell_long ?? row.longitude ?? row.lng;
      const lat = Number(rawLat);
      const lng = Number(rawLng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

      const label = record.first_cell_id || record.last_cell_id || `ILD Point ${index + 1}`;
      const key = `${label}:${lat.toFixed(6)}:${lng.toFixed(6)}`;
      if (!points.has(key)) {
        points.set(key, {
          id: key,
          label,
          lat,
          lng,
          count: 0,
          details: record.circle || record.called_party_number || ''
        });
      }
      points.get(key)!.count += 1;
    });

    return Array.from(points.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3000);
  }, [data]);

  const maxDirectionData = useMemo(() => {
    const sheets = buildIldSheets(data, operator);
    const sheet = sheets.find(s => s.name === '3_MaxDirection');
    return sheet ? sheet.rows : [];
  }, [data, operator]);

  const maxStayData = useMemo(() => {
    const sheets = buildIldSheets(data, operator);
    const sheet = sheets.find(s => s.name === '4_MaxStay');
    return sheet ? sheet.rows : [];
  }, [data, operator]);

  const otherStateSummary = useMemo(() => {
    const sheets = buildIldSheets(data, operator);
    const sheet = sheets.find(s => s.name === '6_OtherStateContactSummary');
    return sheet ? sheet.rows : [];
  }, [data, operator]);

  const directionPieData = useMemo(() => ([
    { name: 'Incoming', value: stats.incoming },
    { name: 'Outgoing', value: stats.outgoing },
    { name: 'SMS', value: stats.sms },
    { name: 'Other', value: stats.other }
  ]), [stats]);

  return (
    <div className="analysis-shell relative z-0 flex h-full flex-col overflow-hidden font-display">
      <header className="analysis-topbar flex min-h-20 shrink-0 items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="material-symbols-outlined text-slate-700 dark:text-white text-2xl hover:text-amber-500 transition-colors">
              arrow_back
            </button>
          )}
          <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-2xl">call_merge</span>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">ILD Analysis</h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Case: {caseName || 'Unknown'} • {operator || 'AUTO'} • {fileCountState} file(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xls,.xlsx"
            multiple
            className="hidden"
            onChange={(e) => handleAddFilesSelected(e.target.files)}
          />
          <button
            onClick={handleAddFilesClick}
            className="flex items-center gap-2 px-3 py-1 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">attach_file</span>
            Add Files
          </button>
          {selectedFiles.length > 0 && (
            <button
              onClick={handleUploadFilesToCase}
              className="flex items-center gap-2 px-3 py-1 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
              disabled={uploadStatus === 'uploading'}
            >
              <span className="material-symbols-outlined text-sm">cloud_upload</span>
              Upload {selectedFiles.length}
            </button>
          )}
          <button onClick={handleExportExcel} disabled={isExporting} className="flex items-center gap-2 px-3 py-1 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            <span className={`material-symbols-outlined text-sm ${isExporting ? 'animate-spin' : ''}`}>{isExporting ? 'progress_activity' : 'file_download'}</span>
            {isExporting ? 'Exporting...' : 'Export Excel'}
          </button>
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs font-mono">
            <span className="material-symbols-outlined text-sm">schedule</span>
            {formatTime(currentTime)}
          </div>
        </div>
      </header>

      <AnalysisTabBar
        value={selectedTab}
        onChange={setSelectedTab}
        tabs={[
          { id: 'overview', label: 'Overview', icon: 'overview' },
          { id: 'records', label: 'Records', icon: 'records' },
          { id: 'advanced', label: 'Advanced Analysis', icon: 'advanced' },
          { id: 'map', label: 'Map', icon: 'map' },
          { id: 'charts', label: 'Charts', icon: 'charts' }
        ]}
      />

      {isExporting && (
        <div className="fixed inset-0 z-[100] bg-slate-900/30 backdrop-blur-[1px] flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center gap-3">
            <span className="material-symbols-outlined animate-spin text-amber-600 dark:text-amber-400">progress_activity</span>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Preparing Excel export</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Please wait...</div>
            </div>
          </div>
        </div>
      )}

      <div className="analysis-content custom-scrollbar flex-1 overflow-y-auto p-6">
        {isLoading && (
          <div className="text-center text-slate-500 py-10">Loading ILD records...</div>
        )}

        {!isLoading && selectedTab === 'overview' && (
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { label: 'Total Records', value: stats.totalRecords.toLocaleString(), icon: 'description', color: 'amber' },
                { label: 'Unique ILD', value: stats.uniqueIld.toLocaleString(), icon: 'call', color: 'blue' },
                { label: 'Unique B-Parties', value: stats.uniqueBParty.toLocaleString(), icon: 'group', color: 'purple' },
                { label: 'Total Duration', value: formatDuration(stats.totalDuration), icon: 'timer', color: 'orange' }
              ].map((stat, i) => (
                <div key={i} className="analysis-panel">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`material-symbols-outlined text-2xl text-${stat.color}-500`}>{stat.icon}</span>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{stat.label}</h3>
                  </div>
                  <p className={`text-3xl font-black text-${stat.color}-600 dark:text-${stat.color}-400`}>{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="analysis-panel">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Daily ILD Activity</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dailyActivityData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                      <XAxis dataKey="date" />
                      <YAxis />
                      <Tooltip />
                      <Line type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="analysis-panel">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Call Direction Mix</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={directionPieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={80} paddingAngle={4}>
                        <Cell fill="#10b981" />
                        <Cell fill="#3b82f6" />
                        <Cell fill="#f59e0b" />
                        <Cell fill="#94a3b8" />
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Top ILD Numbers</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topIldData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#f59e0b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Top B-Parties</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topBPartyData}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="value" fill="#6366f1" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isLoading && selectedTab === 'records' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Search ILD, B-Party, Cell, Circle" className="px-3 py-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm" />
              <input value={callTypeFilter} onChange={e => setCallTypeFilter(e.target.value)} placeholder="Call Type" className="px-3 py-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm" />
              <input value={directionFilter} onChange={e => setDirectionFilter(e.target.value)} placeholder="Direction" className="px-3 py-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm" />
              <input type="date" value={dateFromFilter} onChange={e => setDateFromFilter(e.target.value)} className="px-3 py-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm" />
              <input type="date" value={dateToFilter} onChange={e => setDateToFilter(e.target.value)} className="px-3 py-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm" />
              <div className="flex gap-2">
                <input value={durationMinFilter} onChange={e => setDurationMinFilter(e.target.value)} placeholder="Min Sec" className="px-3 py-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm w-full" />
                <input value={durationMaxFilter} onChange={e => setDurationMaxFilter(e.target.value)} placeholder="Max Sec" className="px-3 py-2 rounded bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm w-full" />
              </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="max-h-[600px] overflow-y-auto">
                <RecordTable rows={currentPageData as unknown as Record<string, unknown>[]} maxRows={50} />
              </div>
              <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  Showing {showingStart}-{showingEnd} of {filteredRecords.length}
                </span>
                <div className="flex gap-2">
                  <button disabled={currentPage === 1} onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded disabled:opacity-50">Prev</button>
                  <span className="px-3 py-1">{currentPage} / {totalPages}</span>
                  <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded disabled:opacity-50">Next</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {!isLoading && selectedTab === 'advanced' && (
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Max Direction</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                    <tr>
                      <th className="px-4 py-2 text-left">ILD</th>
                      <th className="px-4 py-2 text-left">B-Party</th>
                      <th className="px-4 py-2 text-left">Duration</th>
                      <th className="px-4 py-2 text-left">Provider</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maxDirectionData.map((row, i) => (
                      <tr key={i} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-4 py-2 font-mono">{row.ILD as string}</td>
                        <td className="px-4 py-2 font-mono">{row.B_Party as string}</td>
                        <td className="px-4 py-2">{row.Total_Duration as number}</td>
                        <td className="px-4 py-2">{row.Provider as string}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Max Stay Cell</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                    <tr>
                      <th className="px-4 py-2 text-left">ILD</th>
                      <th className="px-4 py-2 text-left">Cell ID</th>
                      <th className="px-4 py-2 text-left">Total Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maxStayData.map((row, i) => (
                      <tr key={i} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-4 py-2 font-mono">{row.ILD as string}</td>
                        <td className="px-4 py-2 font-mono">{row.Cell_ID as string}</td>
                        <td className="px-4 py-2">{row.Total_Calls as number}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 lg:col-span-2">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Other State Contact Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs uppercase text-slate-500 font-semibold">
                    <tr>
                      <th className="px-4 py-2 text-left">ILD</th>
                      <th className="px-4 py-2 text-left">Circle</th>
                      <th className="px-4 py-2 text-left">Total Calls</th>
                      <th className="px-4 py-2 text-left">Out</th>
                      <th className="px-4 py-2 text-left">In</th>
                      <th className="px-4 py-2 text-left">Out SMS</th>
                      <th className="px-4 py-2 text-left">In SMS</th>
                      <th className="px-4 py-2 text-left">Other</th>
                      <th className="px-4 py-2 text-left">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherStateSummary.map((row, i) => (
                      <tr key={i} className="border-t border-slate-200 dark:border-slate-700">
                        <td className="px-4 py-2 font-mono">{row.ILD as string}</td>
                        <td className="px-4 py-2">{row.Circle as string}</td>
                        <td className="px-4 py-2">{row.Total_Calls as number}</td>
                        <td className="px-4 py-2">{row.Out_Calls as number}</td>
                        <td className="px-4 py-2">{row.In_Calls as number}</td>
                        <td className="px-4 py-2">{row.Out_SMS as number}</td>
                        <td className="px-4 py-2">{row.In_SMS as number}</td>
                        <td className="px-4 py-2">{row.Other_Calls as number}</td>
                        <td className="px-4 py-2">{row.Total_Duration as number}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {!isLoading && selectedTab === 'map' && (
          <div className="max-w-7xl mx-auto space-y-4">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">ILD Map View</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Tower-coordinate based hotspots ({mapPoints.length} points)
              </p>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="h-[620px]">
                {mapPoints.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 dark:text-slate-400">
                    <div className="text-center px-6">
                      <span className="material-symbols-outlined text-5xl mb-2">location_off</span>
                      <div className="font-semibold">No ILD coordinates found</div>
                      <div className="text-sm">Current ILD records include cell IDs but no latitude/longitude values.</div>
                    </div>
                  </div>
                ) : (
                  <MapContainer center={[20.5937, 78.9629]} zoom={5} style={{ height: '100%', width: '100%' }}>
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <FitIldMapBounds points={mapPoints} />
                    {mapPoints.map((point) => {
                      const radius = Math.max(4, Math.min(14, 4 + Math.log10(point.count + 1) * 4));
                      return (
                        <CircleMarker
                          key={point.id}
                          center={[point.lat, point.lng]}
                          radius={radius}
                          pathOptions={{ color: '#d97706', fillColor: '#f59e0b', fillOpacity: 0.68, weight: 1.5 }}
                        >
                          <Popup>
                            <div className="text-sm">
                              <div className="font-semibold">{point.label}</div>
                              <div>Calls: {point.count}</div>
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
        {!isLoading && selectedTab === 'charts' && (
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 h-80">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Daily Activity</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyActivityData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 h-80">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Direction Split</h3>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={directionPieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={4}>
                    <Cell fill="#10b981" />
                    <Cell fill="#3b82f6" />
                    <Cell fill="#f59e0b" />
                    <Cell fill="#94a3b8" />
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 h-80">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Top ILD Numbers</h3>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topIldData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#f59e0b" />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 h-80">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Top B-Parties</h3>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topBPartyData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-35} textAnchor="end" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="value" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
