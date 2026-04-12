import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { NormalizedCDR } from '../utils/normalization';
import { cdrAPI, fileAPI } from '../lib/apis';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import * as XLSX from 'xlsx-js-style';
import { encodeSpreadsheetRows } from '../lib/security';
import { RecordTable } from './RecordTable';
import { AnalysisTabBar } from './AnalysisTabBar';
import { useChatbotWorkspaceStore } from '../../stores/chatbotWorkspaceStore';
import { getMetricUiLabel } from '../../lib/caseQaCatalog';

// --- Types & Constants ---

interface AdvancedAnalyticsProps {
  caseId?: string;
  caseName?: string;
  operator?: string;
  parsedData?: NormalizedCDR[];
  fileCount?: number;
  onBack?: () => void;
}

const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const displayIMEI = (imei: string | null | undefined) => {
    if (!imei) return '-';
    if (/^\d+\.?\d*e[+-]\d+$/i.test(imei)) {
      try {
        const num = parseFloat(imei);
        return BigInt(Math.round(num)).toString();
      } catch {
        return imei;
      }
    }
    return imei;
};

type SheetRow = Record<string, string | number>;

const pad2 = (n: number) => n.toString().padStart(2, '0');

const formatDate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const formatDateTime = (d: Date) => `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;

const parseDate = (dateStr?: string) => {
  if (!dateStr) return null;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [dd, mm, yyyy] = dateStr.split('/');
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [yyyy, mm, dd] = dateStr.split('-');
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
};

const parseDateTime = (dateStr?: string, timeStr?: string) => {
  const date = parseDate(dateStr);
  if (!date) return null;
  const match = timeStr?.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return date;
  const h = Number(match[1]);
  const m = Number(match[2]);
  const s = Number(match[3] || '0');
  date.setHours(h, m, s, 0);
  return date;
};

interface CdrMapPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  count: number;
  details?: string;
}

const FitCdrMapBounds: React.FC<{ points: CdrMapPoint[] }> = ({ points }) => {
  const map = useMap();

  useEffect(() => {
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
    map.fitBounds(bounds, { padding: [20, 20] });
  }, [map, points]);

  return null;
};

const getHour = (timeStr?: string) => {
  const match = timeStr?.match(/(\d{1,2}):/);
  if (!match) return null;
  const h = Number(match[1]);
  return Number.isNaN(h) ? null : h;
};

const normalizeCallType = (callType?: string) => {
  const t = (callType || '').toUpperCase();
  const isSms = t.includes('SMS') || t.includes('MSG');
  const isIncoming = t.includes('IN') || t.includes('MTC') || t.includes('TERM');
  if (isSms) return isIncoming ? 'SMS_IN' : 'SMS_OUT';
  return isIncoming ? 'CALL_IN' : 'CALL_OUT';
};

const formatLatLong = (lat?: number, long?: number) => {
  if (lat === undefined || long === undefined) return '';
  if (lat === null || long === null) return '';
  return `${lat}, ${long}`;
};

const CDR_SHEET_DEFS = [
  { name: "_01_CDR_Format", label: "01 CDR Format" },
  { name: "_02_Relationship_Call_Frequ", label: "02 Relationship Call Frequency" },
  { name: "_03_Cell_ID_Frequency", label: "03 Cell ID Frequency" },
  { name: "_04_Movement_Analysis", label: "04 Movement Analysis" },
  { name: "_05_Imei_Used", label: "05 IMEI Used" },
  { name: "_06_State_Connection", label: "06 State Connection" },
  { name: "_07_ISD_Call", label: "07 ISD Call" },
  { name: "_08_Night_Call", label: "08 Night Call" },
  { name: "_09_Mobile_SwitchOFF", label: "09 Mobile Switch Off" }
];

const buildCdrSheets = (data: NormalizedCDR[], operator?: string, selectedSheetNames?: string[]) => {
  const sheet1Headers = [
    "CDR Party No", "Opposite Party No", "Opp Party-Name", "Opp Party-Full Address", "Opp Party-SP State",
    "CALL_DATE", "CALL_TIME", "Call_Type_Std", "CALL_DURATION", "FIRST_CELL_ID_A", "First_Cell_Site_Address",
    "First_Cell_Site_Name-City", "First_Lat_Long", "LAST_CELL_ID_A", "Last_Cell_Site_Address",
    "Last_Cell_Site_Name-City", "Last_Lat_Long", "ESN_IMEI_A", "IMSI_A", "CUST_TYPE", "SMSC_CENTER",
    "Home Circle", "ROAM_CIRCLE", "Opp Party-Activation Date", "Opp Party-Service Provider", "ID"
  ];

  const sheet1Rows: SheetRow[] = data.map((r, i) => ({
    "CDR Party No": r.a_party || '',
    "Opposite Party No": r.b_party || '',
    "Opp Party-Name": r.lrn_description || '',
    "Opp Party-Full Address": '',
    "Opp Party-SP State": r.roaming_circle || '',
    "CALL_DATE": r.call_date || '',
    "CALL_TIME": r.call_start_time || '',
    "Call_Type_Std": normalizeCallType(r.call_type),
    "CALL_DURATION": r.duration_sec || 0,
    "FIRST_CELL_ID_A": r.first_cell_id || '',
    "First_Cell_Site_Address": r.first_cell_desc || '',
    "First_Cell_Site_Name-City": r.first_cell_desc || '',
    "First_Lat_Long": formatLatLong(r.first_cell_lat, r.first_cell_long),
    "LAST_CELL_ID_A": r.last_cell_id || '',
    "Last_Cell_Site_Address": r.last_cell_desc || '',
    "Last_Cell_Site_Name-City": r.last_cell_desc || '',
    "Last_Lat_Long": formatLatLong(r.last_cell_lat, r.last_cell_long),
    "ESN_IMEI_A": r.imei || '',
    "IMSI_A": r.imsi || '',
    "CUST_TYPE": r.toc || '',
    "SMSC_CENTER": r.smsc_number || '',
    "Home Circle": '',
    "ROAM_CIRCLE": r.roaming_circle || '',
    "Opp Party-Activation Date": '',
    "Opp Party-Service Provider": operator || r.operator || '',
    "ID": r.record_id || i + 1
  }));

  const relationHeaders = [
    "ID", "CDR Party No", "Opposite Party No", "Opp Party-SP State",
    "Opp Party-Name", "Opp Party-Full Address", "Start_Date", "End_Date",
    "Date_Diff", "Total Event", "Call In", "Call Out", "SMS In", "SMS Out",
    "Call In_Duration", "Call Out_Duration", "Total_Duration"
  ];

  const relationMap = new Map<string, {
    id: number;
    aParty: string;
    bParty: string;
    roam: string;
    start: Date | null;
    end: Date | null;
    total: number;
    callIn: number;
    callOut: number;
    smsIn: number;
    smsOut: number;
    callInDur: number;
    callOutDur: number;
    totalDur: number;
  }>();

  let relationId = 1;
  data.forEach(r => {
    const a = r.a_party || '';
    const b = r.b_party || '';
    if (!b) return;
    const key = `${a}||${b}`;
    if (!relationMap.has(key)) {
      relationMap.set(key, {
        id: relationId++,
        aParty: a,
        bParty: b,
        roam: r.roaming_circle || '',
        start: null,
        end: null,
        total: 0,
        callIn: 0,
        callOut: 0,
        smsIn: 0,
        smsOut: 0,
        callInDur: 0,
        callOutDur: 0,
        totalDur: 0
      });
    }
    const entry = relationMap.get(key);
    if (!entry) return;
    const date = parseDate(r.call_date);
    if (date) {
      if (!entry.start || date < entry.start) entry.start = date;
      if (!entry.end || date > entry.end) entry.end = date;
    }
    const type = normalizeCallType(r.call_type);
    entry.total += 1;
    if (type === 'CALL_IN') {
      entry.callIn += 1;
      entry.callInDur += r.duration_sec || 0;
    } else if (type === 'CALL_OUT') {
      entry.callOut += 1;
      entry.callOutDur += r.duration_sec || 0;
    } else if (type === 'SMS_IN') {
      entry.smsIn += 1;
    } else {
      entry.smsOut += 1;
    }
    entry.totalDur += r.duration_sec || 0;
  });

  const relationRows: SheetRow[] = Array.from(relationMap.values()).map(r => {
    const dateDiff = r.start && r.end ? Math.max(0, Math.round((r.end.getTime() - r.start.getTime()) / (1000 * 60 * 60 * 24))) : 0;
    return {
      "ID": r.id,
      "CDR Party No": r.aParty,
      "Opposite Party No": r.bParty,
      "Opp Party-SP State": r.roam,
      "Opp Party-Name": r.bParty,
      "Opp Party-Full Address": '',
      "Start_Date": r.start ? formatDate(r.start) : '',
      "End_Date": r.end ? formatDate(r.end) : '',
      "Date_Diff": dateDiff,
      "Total Event": r.total,
      "Call In": r.callIn,
      "Call Out": r.callOut,
      "SMS In": r.smsIn,
      "SMS Out": r.smsOut,
      "Call In_Duration": r.callInDur,
      "Call Out_Duration": r.callOutDur,
      "Total_Duration": r.totalDur
    };
  });

  const cellHeaders = [
    "Id", "CDR Party No", "FIRST_CELL_ID_A", "First_Cell_Site_Address",
    "First_Lat_Long", "Total Event", "Call In", "Call Out", "SMS In", "SMS Out",
    "Call In_Duration", "Call Out_Duration", "Total_Duration", "ROAM_CIRCLE",
    "First_Cell_Site_Name-City"
  ];

  const cellMap = new Map<string, {
    id: number;
    aParty: string;
    cell: string;
    addr: string;
    latLong: string;
    roam: string;
    total: number;
    callIn: number;
    callOut: number;
    smsIn: number;
    smsOut: number;
    callInDur: number;
    callOutDur: number;
    totalDur: number;
  }>();

  let cellId = 1;
  data.forEach(r => {
    const a = r.a_party || '';
    const cell = r.first_cell_id || '';
    if (!cell) return;
    const key = `${a}||${cell}`;
    if (!cellMap.has(key)) {
      cellMap.set(key, {
        id: cellId++,
        aParty: a,
        cell,
        addr: r.first_cell_desc || '',
        latLong: formatLatLong(r.first_cell_lat, r.first_cell_long),
        roam: r.roaming_circle || '',
        total: 0,
        callIn: 0,
        callOut: 0,
        smsIn: 0,
        smsOut: 0,
        callInDur: 0,
        callOutDur: 0,
        totalDur: 0
      });
    }
    const entry = cellMap.get(key);
    if (!entry) return;
    const type = normalizeCallType(r.call_type);
    entry.total += 1;
    if (type === 'CALL_IN') {
      entry.callIn += 1;
      entry.callInDur += r.duration_sec || 0;
    } else if (type === 'CALL_OUT') {
      entry.callOut += 1;
      entry.callOutDur += r.duration_sec || 0;
    } else if (type === 'SMS_IN') {
      entry.smsIn += 1;
    } else {
      entry.smsOut += 1;
    }
    entry.totalDur += r.duration_sec || 0;
  });

  const cellRows: SheetRow[] = Array.from(cellMap.values()).map(r => ({
    "Id": r.id,
    "CDR Party No": r.aParty,
    "FIRST_CELL_ID_A": r.cell,
    "First_Cell_Site_Address": r.addr,
    "First_Lat_Long": r.latLong,
    "Total Event": r.total,
    "Call In": r.callIn,
    "Call Out": r.callOut,
    "SMS In": r.smsIn,
    "SMS Out": r.smsOut,
    "Call In_Duration": r.callInDur,
    "Call Out_Duration": r.callOutDur,
    "Total_Duration": r.totalDur,
    "ROAM_CIRCLE": r.roam,
    "First_Cell_Site_Name-City": r.addr
  }));

  const movementHeaders = [
    "ID", "CDR Party No", "Opposite Party No", "CALL_DATE", "CALL_TIME",
    "FIRST_CELL_ID_A", "First_Cell_Site_Name-City", "First_Cell_Site_Address", "First_Lat_Long"
  ];

  const movementRows: SheetRow[] = data.map((r, i) => ({
    "ID": i + 1,
    "CDR Party No": r.a_party || '',
    "Opposite Party No": r.b_party || '',
    "CALL_DATE": r.call_date || '',
    "CALL_TIME": r.call_start_time || '',
    "FIRST_CELL_ID_A": r.first_cell_id || '',
    "First_Cell_Site_Name-City": r.first_cell_desc || '',
    "First_Cell_Site_Address": r.first_cell_desc || '',
    "First_Lat_Long": formatLatLong(r.first_cell_lat, r.first_cell_long)
  }));

  const imeiHeaders = [
    "ID", "CDR Party No", "CDR Party-Name", "CDR Party-Full Address",
    "CDR Party-Service Provider", "IMEI", "First_Call", "Last_call",
    "Total Event", "Call In", "Call Out", "SMS In", "SMS Out",
    "Call In_Duration", "Call Out_Duration", "Total_Duration"
  ];

  const imeiMap = new Map<string, {
    id: number;
    aParty: string;
    imei: string;
    first: Date | null;
    last: Date | null;
    total: number;
    callIn: number;
    callOut: number;
    smsIn: number;
    smsOut: number;
    callInDur: number;
    callOutDur: number;
    totalDur: number;
  }>();

  let imeiId = 1;
  data.forEach(r => {
    const a = r.a_party || '';
    const imei = r.imei || '';
    if (!imei) return;
    const key = `${a}||${imei}`;
    if (!imeiMap.has(key)) {
      imeiMap.set(key, {
        id: imeiId++,
        aParty: a,
        imei,
        first: null,
        last: null,
        total: 0,
        callIn: 0,
        callOut: 0,
        smsIn: 0,
        smsOut: 0,
        callInDur: 0,
        callOutDur: 0,
        totalDur: 0
      });
    }
    const entry = imeiMap.get(key);
    if (!entry) return;
    const dt = parseDateTime(r.call_date, r.call_start_time);
    if (dt) {
      if (!entry.first || dt < entry.first) entry.first = dt;
      if (!entry.last || dt > entry.last) entry.last = dt;
    }
    const type = normalizeCallType(r.call_type);
    entry.total += 1;
    if (type === 'CALL_IN') {
      entry.callIn += 1;
      entry.callInDur += r.duration_sec || 0;
    } else if (type === 'CALL_OUT') {
      entry.callOut += 1;
      entry.callOutDur += r.duration_sec || 0;
    } else if (type === 'SMS_IN') {
      entry.smsIn += 1;
    } else {
      entry.smsOut += 1;
    }
    entry.totalDur += r.duration_sec || 0;
  });

  const imeiRows: SheetRow[] = Array.from(imeiMap.values()).map(r => ({
    "ID": r.id,
    "CDR Party No": r.aParty,
    "CDR Party-Name": '',
    "CDR Party-Full Address": '',
    "CDR Party-Service Provider": operator || '',
    "IMEI": r.imei,
    "First_Call": r.first ? formatDateTime(r.first) : '',
    "Last_call": r.last ? formatDateTime(r.last) : '',
    "Total Event": r.total,
    "Call In": r.callIn,
    "Call Out": r.callOut,
    "SMS In": r.smsIn,
    "SMS Out": r.smsOut,
    "Call In_Duration": r.callInDur,
    "Call Out_Duration": r.callOutDur,
    "Total_Duration": r.totalDur
  }));

  const stateHeaders = [
    "Id", "CDR Party No", "Connection of State", "Total Event",
    "Call In", "Call Out", "SMS In", "SMS Out",
    "Call In_Duration", "Call Out_Duration", "Total_Duration"
  ];

  const stateMap = new Map<string, {
    id: number;
    aParty: string;
    state: string;
    total: number;
    callIn: number;
    callOut: number;
    smsIn: number;
    smsOut: number;
    callInDur: number;
    callOutDur: number;
    totalDur: number;
  }>();

  let stateId = 1;
  data.forEach(r => {
    const a = r.a_party || '';
    const state = r.roaming_circle || '';
    if (!state) return;
    const key = `${a}||${state}`;
    if (!stateMap.has(key)) {
      stateMap.set(key, {
        id: stateId++,
        aParty: a,
        state,
        total: 0,
        callIn: 0,
        callOut: 0,
        smsIn: 0,
        smsOut: 0,
        callInDur: 0,
        callOutDur: 0,
        totalDur: 0
      });
    }
    const entry = stateMap.get(key);
    if (!entry) return;
    const type = normalizeCallType(r.call_type);
    entry.total += 1;
    if (type === 'CALL_IN') {
      entry.callIn += 1;
      entry.callInDur += r.duration_sec || 0;
    } else if (type === 'CALL_OUT') {
      entry.callOut += 1;
      entry.callOutDur += r.duration_sec || 0;
    } else if (type === 'SMS_IN') {
      entry.smsIn += 1;
    } else {
      entry.smsOut += 1;
    }
    entry.totalDur += r.duration_sec || 0;
  });

  const stateRows: SheetRow[] = Array.from(stateMap.values()).map(r => ({
    "Id": r.id,
    "CDR Party No": r.aParty,
    "Connection of State": r.state,
    "Total Event": r.total,
    "Call In": r.callIn,
    "Call Out": r.callOut,
    "SMS In": r.smsIn,
    "SMS Out": r.smsOut,
    "Call In_Duration": r.callInDur,
    "Call Out_Duration": r.callOutDur,
    "Total_Duration": r.totalDur
  }));

  const isdHeaders = [
    "CdrNo", "B Party", "Date", "Time", "Duration", "Call Type",
    "First Cell ID", "First Cell ID Address", "Last Cell ID",
    "Last Cell ID Address", "IMEI", "IMSI", "Roaming", "Operator"
  ];

  const isInternational = (num?: string) => {
    if (!num) return false;
    const s = num.trim();
    if (!s) return false;
    const numClean = s.replace(/\D/g, '');
    return s.startsWith('+') || s.startsWith('00') || numClean.length > 12;
  };

  const isdRows: SheetRow[] = data
    .filter(r => ['CALL_IN', 'CALL_OUT'].includes(normalizeCallType(r.call_type)) && isInternational(r.b_party))
    .map(r => ({
      "CdrNo": r.a_party || '',
      "B Party": r.b_party || '',
      "Date": r.call_date || '',
      "Time": r.call_start_time || '',
      "Duration": r.duration_sec || 0,
      "Call Type": normalizeCallType(r.call_type),
      "First Cell ID": r.first_cell_id || '',
      "First Cell ID Address": r.first_cell_desc || '',
      "Last Cell ID": r.last_cell_id || '',
      "Last Cell ID Address": r.last_cell_desc || '',
      "IMEI": r.imei || '',
      "IMSI": r.imsi || '',
      "Roaming": r.roaming_circle || '',
      "Operator": operator || r.operator || ''
    }));

  const nightHeaders = [
    "Id", "CDR Party No", "Opposite Party No", "Opp Party-Name",
    "Opp Party-Full Address", "Opp Party-SP State", "Total Event",
    "Call In", "Call Out", "SMS In", "SMS Out",
    "Call In_Duration", "Call Out_Duration", "Total_Duration"
  ];

  const nightMap = new Map<string, {
    id: number;
    aParty: string;
    bParty: string;
    roam: string;
    total: number;
    callIn: number;
    callOut: number;
    smsIn: number;
    smsOut: number;
    callInDur: number;
    callOutDur: number;
    totalDur: number;
  }>();

  let nightId = 1;
  data.forEach(r => {
    const hour = getHour(r.call_start_time);
    if (hour === null) return;
    if (!(hour >= 20 || hour < 7)) return;
    const a = r.a_party || '';
    const b = r.b_party || '';
    if (!b) return;
    const key = `${a}||${b}`;
    if (!nightMap.has(key)) {
      nightMap.set(key, {
        id: nightId++,
        aParty: a,
        bParty: b,
        roam: r.roaming_circle || '',
        total: 0,
        callIn: 0,
        callOut: 0,
        smsIn: 0,
        smsOut: 0,
        callInDur: 0,
        callOutDur: 0,
        totalDur: 0
      });
    }
    const entry = nightMap.get(key);
    if (!entry) return;
    const type = normalizeCallType(r.call_type);
    entry.total += 1;
    if (type === 'CALL_IN') {
      entry.callIn += 1;
      entry.callInDur += r.duration_sec || 0;
    } else if (type === 'CALL_OUT') {
      entry.callOut += 1;
      entry.callOutDur += r.duration_sec || 0;
    } else if (type === 'SMS_IN') {
      entry.smsIn += 1;
    } else {
      entry.smsOut += 1;
    }
    entry.totalDur += r.duration_sec || 0;
  });

  const nightRows: SheetRow[] = Array.from(nightMap.values()).map(r => ({
    "Id": r.id,
    "CDR Party No": r.aParty,
    "Opposite Party No": r.bParty,
    "Opp Party-Name": r.bParty,
    "Opp Party-Full Address": '',
    "Opp Party-SP State": r.roam,
    "Total Event": r.total,
    "Call In": r.callIn,
    "Call Out": r.callOut,
    "SMS In": r.smsIn,
    "SMS Out": r.smsOut,
    "Call In_Duration": r.callInDur,
    "Call Out_Duration": r.callOutDur,
    "Total_Duration": r.totalDur
  }));

  const switchHeaders = ["ID", "Start_Date", "End_Date", "Total_Day"];

  const switchRows: SheetRow[] = [];
  let switchId = 1;
  const dateMap = new Map<string, Date[]>();
  data.forEach(r => {
    const a = r.a_party || '';
    if (!a) return;
    const d = parseDate(r.call_date);
    if (!d) return;
    if (!dateMap.has(a)) dateMap.set(a, []);
    dateMap.get(a)?.push(d);
  });

  dateMap.forEach(dates => {
    const uniqueDates = Array.from(new Set(dates.map(d => formatDate(d))))
      .map(ds => parseDate(ds))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime());
    for (let i = 0; i < uniqueDates.length - 1; i++) {
      const diff = Math.round((uniqueDates[i + 1].getTime() - uniqueDates[i].getTime()) / (1000 * 60 * 60 * 24));
      if (diff > 1) {
        switchRows.push({
          "ID": switchId++,
          "Start_Date": formatDate(uniqueDates[i]),
          "End_Date": formatDate(uniqueDates[i + 1]),
          "Total_Day": diff
        });
      }
    }
  });

  const allSheets = [
    { name: "_01_CDR_Format", headers: sheet1Headers, rows: sheet1Rows },
    { name: "_02_Relationship_Call_Frequ", headers: relationHeaders, rows: relationRows },
    { name: "_03_Cell_ID_Frequency", headers: cellHeaders, rows: cellRows },
    { name: "_04_Movement_Analysis", headers: movementHeaders, rows: movementRows },
    { name: "_05_Imei_Used", headers: imeiHeaders, rows: imeiRows },
    { name: "_06_State_Connection", headers: stateHeaders, rows: stateRows },
    { name: "_07_ISD_Call", headers: isdHeaders, rows: isdRows },
    { name: "_08_Night_Call", headers: nightHeaders, rows: nightRows },
    { name: "_09_Mobile_SwitchOFF", headers: switchHeaders, rows: switchRows }
  ];
  if (!selectedSheetNames || selectedSheetNames.length === 0) return allSheets;
  const selected = new Set(selectedSheetNames);
  return allSheets.filter(sheet => selected.has(sheet.name));
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

// --- Main Component ---

export const AdvancedAnalytics: React.FC<AdvancedAnalyticsProps> = ({ caseId, caseName, operator, parsedData, fileCount = 1, onBack }) => {
  const setWorkspaceContext = useChatbotWorkspaceStore((state) => state.setWorkspaceContext);
  const clearWorkspaceContext = useChatbotWorkspaceStore((state) => state.clearWorkspaceContext);
  const [data, setData] = useState<NormalizedCDR[]>(parsedData || []);
  const [isLoading, setIsLoading] = useState(!parsedData || parsedData.length === 0);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'records' | 'analysis' | 'location'>('overview');
  const [chartRenderKey, setChartRenderKey] = useState(0);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isExporting, setIsExporting] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<{ id: number; file_name: string }[]>([]);
  const [selectedFileKeys, setSelectedFileKeys] = useState<string[]>([]);
  const [filesInitialized, setFilesInitialized] = useState(false);
  const [selectedSheetNames, setSelectedSheetNames] = useState<string[]>(() => CDR_SHEET_DEFS.map(sheet => sheet.name));
  const [isReportMenuOpen, setIsReportMenuOpen] = useState(false);

  // Records Tab Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [callTypeFilter, setCallTypeFilter] = useState('');
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

  useEffect(() => {
    if (selectedTab !== 'overview') return;
    setChartRenderKey((k) => k + 1);
    const t1 = window.setTimeout(() => {
      try {
        window.dispatchEvent(new Event('resize'));
      } catch {
        // ignore
      }
    }, 50);
    const t2 = window.setTimeout(() => {
      try {
        window.dispatchEvent(new Event('resize'));
      } catch {
        // ignore
      }
    }, 250);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [selectedTab]);

  useEffect(() => {
    if (selectedTab !== 'overview') return;
    // Data changes can happen after tab mount; force a re-measure.
    setChartRenderKey((k) => k + 1);
  }, [selectedTab, data.length, selectedFileKeys.length]);

  const loadCaseData = useCallback(async () => {
    if (!caseId) return;
    try {
      setIsLoading(true);
      const cdrData = await cdrAPI.getRecordsByCase(caseId);
      if (cdrData) {
        setData((Array.isArray(cdrData) ? cdrData : []) as NormalizedCDR[]);
      }
    } catch (error) {
      console.error('Error loading case data:', error);
    } finally {
      setIsLoading(false);
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
    if (!caseId) return;
    fileAPI.listByCase(caseId)
      .then((files) => {
        const mapped = Array.isArray(files)
          ? files.map(file => ({ id: file.id, file_name: file.file_name }))
          : [];
        setUploadedFiles(mapped);
      })
      .catch(() => {
        setUploadedFiles([]);
      });
  }, [caseId]);

  const getRecordFileKey = (record: NormalizedCDR) => {
    if (record.file_id) return `id:${record.file_id}`;
    const idx = record.file_index ?? 0;
    return `index:${idx}`;
  };

  const availableFiles = useMemo(() => {
    const counts = new Map<string, { key: string; name: string; count: number }>();
    data.forEach(record => {
      const key = getRecordFileKey(record);
      const fallbackName = record.file_name || (record.file_index !== undefined ? `File ${record.file_index + 1}` : 'File');
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
        if (record.file_name && existing.name.startsWith('File')) {
          existing.name = record.file_name;
        }
      } else {
        counts.set(key, { key, name: fallbackName, count: 1 });
      }
    });

    const filesFromUploads = uploadedFiles.map(file => {
      const key = `id:${file.id}`;
      const existing = counts.get(key);
      return {
        key,
        name: file.file_name,
        count: existing ? existing.count : 0
      };
    });

    const remaining = Array.from(counts.values()).filter(entry => !entry.key.startsWith('id:') || !uploadedFiles.some(file => `id:${file.id}` === entry.key));

    return [...filesFromUploads, ...remaining].filter(entry => entry.count > 0).sort((a, b) => a.name.localeCompare(b.name));
  }, [data, uploadedFiles]);

  useEffect(() => {
    if (availableFiles.length === 0) return;
    if (!filesInitialized) {
      setSelectedFileKeys(availableFiles.map(file => file.key));
      setFilesInitialized(true);
      return;
    }
    setSelectedFileKeys(prev => {
      const availableSet = new Set(availableFiles.map(file => file.key));
      const filtered = prev.filter(key => availableSet.has(key));
      return filtered.length > 0 ? filtered : availableFiles.map(file => file.key);
    });
  }, [availableFiles, filesInitialized]);

  const fileFilteredData = useMemo(() => {
    // Treat "no selection" as "all files" to avoid empty analytics after reloads/tab switches.
    if (selectedFileKeys.length === 0) return data;
    const selected = new Set(selectedFileKeys);
    return data.filter(record => selected.has(getRecordFileKey(record)));
  }, [data, selectedFileKeys, filesInitialized]);

  const activeFileCount = useMemo(() => {
    const unique = new Set(fileFilteredData.map(record => getRecordFileKey(record)));
    return unique.size || fileCount;
  }, [fileFilteredData, fileCount]);

  const selectedFileIds = useMemo(
    () => selectedFileKeys
      .filter((key) => key.startsWith('id:'))
      .map((key) => Number.parseInt(key.slice(3), 10))
      .filter((value) => Number.isFinite(value) && value > 0),
    [selectedFileKeys]
  );

  const selectedFileNames = useMemo(
    () => availableFiles
      .filter((file) => selectedFileKeys.includes(file.key))
      .map((file) => file.name),
    [availableFiles, selectedFileKeys]
  );

  const toggleFileKey = (key: string) => {
    setSelectedFileKeys(prev => {
      if (prev.includes(key)) {
        return prev.filter(k => k !== key);
      }
      return [...prev, key];
    });
  };

  const toggleSheetName = (name: string) => {
    setSelectedSheetNames(prev => {
      if (prev.includes(name)) {
        const next = prev.filter(n => n !== name);
        return next.length === 0 ? prev : next;
      }
      return [...prev, name];
    });
  };

  const handleExportExcel = async () => {
    if (isExporting) return;
    try {
      setIsExporting(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const sheets = buildCdrSheets(fileFilteredData, operator, selectedSheetNames);
      const workbook = XLSX.utils.book_new();
      for (const sheet of sheets) {
        const ws = XLSX.utils.aoa_to_sheet([sheet.headers]);
        XLSX.utils.sheet_add_json(ws, encodeSpreadsheetRows(sheet.rows), { header: sheet.headers, skipHeader: true, origin: 'A2' });
        applyHeaderStylesAndFilter(ws, sheet.headers, 'FF2563EB');
        XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
        applySheetTabColor(workbook, sheet.name, 'FF2563EB');
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const safeCase = (caseName || 'Case').replace(/\s+/g, '_');
      const fileName = `CDR_Analysis_${safeCase}_${formatDate(new Date())}.xlsx`;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      XLSX.writeFile(workbook, fileName);
    } finally {
      setIsExporting(false);
    }
  };

  // --- DATA PROCESSING HOOKS ---

  // 1. Filtered Data for Records Tab
  const filteredRecords = useMemo(() => {
    let filtered = fileFilteredData;

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r => 
        (r.a_party && r.a_party.includes(term)) ||
        (r.b_party && r.b_party.includes(term)) ||
        (r.imei && String(r.imei).includes(term)) ||
        (r.imsi && String(r.imsi).includes(term)) ||
        (r.first_cell_id && r.first_cell_id.includes(term))
      );
    }

    if (callTypeFilter) {
      filtered = filtered.filter(r => r.call_type?.toLowerCase() === callTypeFilter.toLowerCase());
    }

    if (dateFromFilter) {
      filtered = filtered.filter(r => r.call_date && r.call_date >= dateFromFilter);
    }
    if (dateToFilter) {
      filtered = filtered.filter(r => r.call_date && r.call_date <= dateToFilter);
    }

    if (durationMinFilter) {
      filtered = filtered.filter(r => r.duration_sec && r.duration_sec >= parseInt(durationMinFilter));
    }
    if (durationMaxFilter) {
      filtered = filtered.filter(r => r.duration_sec && r.duration_sec <= parseInt(durationMaxFilter));
    }

    return filtered;
  }, [fileFilteredData, searchTerm, callTypeFilter, dateFromFilter, dateToFilter, durationMinFilter, durationMaxFilter]);

  useEffect(() => {
    if (!caseId) {
      clearWorkspaceContext();
      return;
    }

    setWorkspaceContext({
      caseId,
      caseTag: caseName || null,
      module: 'cdr',
      view: selectedTab === 'analysis' ? 'advanced' : selectedTab,
      selectedFileIds,
      selectedFileKeys,
      selectedFileNames,
      filters: selectedTab === 'records'
        ? {
            search: searchTerm || null,
            callType: callTypeFilter || null,
            dateFrom: dateFromFilter || null,
            dateTo: dateToFilter || null,
            durationMin: durationMinFilter || null,
            durationMax: durationMaxFilter || null
          }
        : null,
      searchState: selectedTab === 'records'
        ? {
            query: searchTerm || null,
            resultCount: filteredRecords.length
          }
        : null,
      selectionTimestamp: new Date().toISOString()
    });
  }, [
    caseId,
    caseName,
    selectedTab,
    selectedFileIds,
    selectedFileKeys,
    selectedFileNames,
    searchTerm,
    callTypeFilter,
    dateFromFilter,
    dateToFilter,
    durationMinFilter,
    durationMaxFilter,
    filteredRecords.length,
    setWorkspaceContext,
    clearWorkspaceContext
  ]);

  useEffect(() => () => {
    clearWorkspaceContext();
  }, [clearWorkspaceContext]);

  // Pagination Logic
  useEffect(() => {
    setCurrentPage(1);
  }, [fileFilteredData, searchTerm, callTypeFilter, dateFromFilter, dateToFilter, durationMinFilter, durationMaxFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const currentPageData = filteredRecords.slice(startIndex, startIndex + itemsPerPage);
  const showingStart = filteredRecords.length === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(startIndex + itemsPerPage, filteredRecords.length);

  const goToPage = (page: number) => setCurrentPage(Math.max(1, Math.min(page, totalPages)));

  // 2. Stats Calculation
  const stats = useMemo(() => {
    const totalRecords = fileFilteredData.length;
    const uniqueAParties = new Set(fileFilteredData.map(r => r.a_party).filter(Boolean)).size;
    const uniqueBParties = new Set(fileFilteredData.map(r => r.b_party).filter(Boolean)).size;
    const totalDuration = fileFilteredData.reduce((sum, r) => sum + (r.duration_sec || 0), 0);
    const avgDuration = totalRecords > 0 ? Math.round(totalDuration / totalRecords) : 0;
    
    let incoming = 0, outgoing = 0, sms = 0;
    const callTypes = fileFilteredData.reduce((acc, r) => {
      const type = r.call_type || 'Unknown';
      acc[type] = (acc[type] || 0) + 1;
      
      const typeUpper = type.toUpperCase();
      if (typeUpper.includes('SMS') || typeUpper.includes('MSG')) sms++;
      else if (typeUpper.includes('IN') || typeUpper.includes('MTC') || typeUpper.includes('TERM')) incoming++;
      else outgoing++; // Default to outgoing for others (MOC, ORIG, etc) or unknown
      
      return acc;
    }, {} as Record<string, number>);

    return { totalRecords, uniqueAParties, uniqueBParties, avgDuration, callTypes, incoming, outgoing, sms };
  }, [fileFilteredData]);

  // 3. Max B Party Analysis
  const maxBPartyData = useMemo(() => {
    const counts: Record<string, { count: number; duration: number; incoming: number; outgoing: number }> = {};
    fileFilteredData.forEach(r => {
      const b = r.b_party;
      if (!b) return;
      if (!counts[b]) counts[b] = { count: 0, duration: 0, incoming: 0, outgoing: 0 };
      counts[b].count++;
      counts[b].duration += (r.duration_sec || 0);
      const type = (r.call_type || '').toLowerCase();
      if (type.includes('in') || type.includes('term')) counts[b].incoming++;
      else counts[b].outgoing++;
    });
    return Object.entries(counts)
      .map(([phone, stat]) => ({ phone, ...stat, durationStr: formatDuration(stat.duration) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);
  }, [fileFilteredData]);

  // 4. Max IMEI Analysis
  const maxImeiData = useMemo(() => {
    const counts: Record<string, number> = {};
    fileFilteredData.forEach(r => {
      const imei = r.imei;
      if (imei && imei !== '-') counts[imei] = (counts[imei] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([imei, count]) => ({ imei, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }, [fileFilteredData]);

  // 5. Max IMSI Analysis
  const maxImsiData = useMemo(() => {
    const counts: Record<string, number> = {};
    fileFilteredData.forEach(r => {
      const imsi = r.imsi;
      if (imsi && imsi !== '-') counts[imsi] = (counts[imsi] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([imsi, count]) => ({ imsi, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }, [fileFilteredData]);

  // 6. Max Location (Cell ID)
  const maxLocationData = useMemo(() => {
    const counts: Record<string, { count: number, duration: number }> = {};
    fileFilteredData.forEach(r => {
      const cell = r.first_cell_id;
      if (cell && cell !== '-' && cell !== '---') {
        if (!counts[cell]) counts[cell] = { count: 0, duration: 0 };
        counts[cell].count++;
        counts[cell].duration += (r.duration_sec || 0);
      }
    });
    return Object.entries(counts)
      .map(([cellId, stat]) => ({ cellId, count: stat.count, duration: formatDuration(stat.duration) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }, [fileFilteredData]);

  const cdrMapPoints = useMemo<CdrMapPoint[]>(() => {
    const points = new Map<string, CdrMapPoint>();

    fileFilteredData.forEach((record, index) => {
      const lat = Number(record.first_cell_lat ?? record.last_cell_lat);
      const lng = Number(record.first_cell_long ?? record.last_cell_long);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

      const label = record.first_cell_id || record.last_cell_id || `CDR Point ${index + 1}`;
      const key = `${label}:${lat.toFixed(6)}:${lng.toFixed(6)}`;
      if (!points.has(key)) {
        points.set(key, {
          id: key,
          label,
          lat,
          lng,
          count: 0,
          details: record.first_cell_desc || record.last_cell_desc || record.roaming_circle || ''
        });
      }
      points.get(key)!.count += 1;
    });

    return Array.from(points.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 3000);
  }, [fileFilteredData]);

  // 7. Other State
  const otherStateData = useMemo(() => {
    const counts: Record<string, number> = {};
    fileFilteredData.forEach(r => {
      const state = r.roaming_circle || r.lrn_lsa;
      if (state && state !== '-' && state.toLowerCase() !== 'null') {
        counts[state] = (counts[state] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .map(([state, count]) => ({ state, count }))
      .sort((a, b) => b.count - a.count);
  }, [fileFilteredData]);

  // 8. SMS Analysis
  const smsData = useMemo(() => {
    let sent = 0, received = 0;
    const contactStats: Record<string, number> = {};
    fileFilteredData.forEach(r => {
      const type = (r.call_type || '').toUpperCase();
      if (type.includes('SMS') || type.includes('SMT') || type.includes('SMO') || type.includes('DSM')) {
        if (type.includes('SMT') || type.includes('DSM')) received++;
        else sent++;
        if (r.b_party) contactStats[r.b_party] = (contactStats[r.b_party] || 0) + 1;
      }
    });
    const topContacts = Object.entries(contactStats)
      .map(([phone, count]) => ({ phone, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    return { total: sent + received, sent, received, topContacts };
  }, [fileFilteredData]);

  // 9. Night Stay (8PM-7AM)
  const nightStayData = useMemo(() => {
    const nightCalls: Array<{ date?: string; time?: string; bParty?: string; duration?: number | null; type?: string | null }> = [];
    fileFilteredData.forEach(r => {
      const timeStr = r.call_start_time || '';
      const hourMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
      if (hourMatch) {
        const hour = parseInt(hourMatch[1]);
        if (hour >= 20 || hour < 7) {
          nightCalls.push({
            date: r.call_date, time: timeStr, bParty: r.b_party,
            duration: r.duration_sec, type: r.call_type
          });
        }
      }
    });
    return nightCalls.sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 100);
  }, [fileFilteredData]);

  // 10. Regular Caller (Called >3 times)
  const regularCallerData = useMemo(() => {
    const stats: Record<string, { count: number, dates: Set<string> }> = {};
    fileFilteredData.forEach(r => {
      const b = r.b_party;
      if (!b) return;
      if (!stats[b]) stats[b] = { count: 0, dates: new Set() };
      stats[b].count++;
      if (r.call_date) stats[b].dates.add(r.call_date);
    });
    return Object.entries(stats)
      .filter(([, s]) => s.count >= 3)
      .map(([phone, s]) => ({ phone, count: s.count, daysActive: s.dates.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);
  }, [fileFilteredData]);

  // 11. ISD Calls
  const isdCallData = useMemo(() => {
    const isdCalls: Array<{ number: string; date?: string; time?: string; duration?: number | null }> = [];
    fileFilteredData.forEach(r => {
      const b = r.b_party || '';
      // Simple check: starts with + not +91, or 00, or long digits without 91/6-9 start
      // Reusing logic from previous version simplified
      const clean = b.replace(/[\s-]/g, '');
      const isIndian = clean.startsWith('+91') || (clean.startsWith('91') && clean.length === 12) || (clean.length === 10 && /^[6-9]/.test(clean));
      if (!isIndian && (clean.startsWith('+') || clean.startsWith('00') || clean.length > 11)) {
        isdCalls.push({ number: b, date: r.call_date, time: r.call_start_time, duration: r.duration_sec });
      }
    });
    return isdCalls.slice(0, 100);
  }, [fileFilteredData]);

  // 12. Common B Party (across files)
  const commonBPartyData = useMemo(() => {
    const fileGroups: Record<string, Set<string>> = {};
    
    fileFilteredData.forEach(r => {
      const key = getRecordFileKey(r);
      
      if (r.b_party) {
        if (!fileGroups[key]) fileGroups[key] = new Set();
        fileGroups[key].add(r.b_party);
      }
    });

    const keys = Object.keys(fileGroups);
    if (keys.length < 2 || activeFileCount <= 1) return { hasMultipleFiles: false, common: [] };

    let common = Array.from(fileGroups[keys[0]]);
    for (let i = 1; i < keys.length; i++) {
      common = common.filter(num => fileGroups[keys[i]].has(num));
    }

    return { hasMultipleFiles: true, common: common.slice(0, 50) };
  }, [fileFilteredData, activeFileCount]);

  // 12.1 Common IMEI (across files)
  const commonIMEIData = useMemo(() => {
    const fileGroups: Record<string, Set<string>> = {};
    
    fileFilteredData.forEach(r => {
      const key = getRecordFileKey(r);
      
      if (r.imei && r.imei !== '-') {
        if (!fileGroups[key]) fileGroups[key] = new Set();
        fileGroups[key].add(r.imei);
      }
    });

    const keys = Object.keys(fileGroups);
    if (keys.length < 2 || activeFileCount <= 1) return { hasMultipleFiles: false, common: [] };

    let common = Array.from(fileGroups[keys[0]]);
    for (let i = 1; i < keys.length; i++) {
      common = common.filter(num => fileGroups[keys[i]].has(num));
    }

    return { hasMultipleFiles: true, common: common.slice(0, 50) };
  }, [fileFilteredData, activeFileCount]);

  // 12.2 Common IMSI (across files)
  const commonIMSIData = useMemo(() => {
    const fileGroups: Record<string, Set<string>> = {};
    
    fileFilteredData.forEach(r => {
      const key = getRecordFileKey(r);
      
      if (r.imsi && r.imsi !== '-') {
        if (!fileGroups[key]) fileGroups[key] = new Set();
        fileGroups[key].add(r.imsi);
      }
    });

    const keys = Object.keys(fileGroups);
    if (keys.length < 2 || activeFileCount <= 1) return { hasMultipleFiles: false, common: [] };

    let common = Array.from(fileGroups[keys[0]]);
    for (let i = 1; i < keys.length; i++) {
      common = common.filter(num => fileGroups[keys[i]].has(num));
    }

    return { hasMultipleFiles: true, common: common.slice(0, 50) };
  }, [fileFilteredData, activeFileCount]);

  // 12.3 Common Location (Lat/Long or Cell ID)
  const commonLocationData = useMemo(() => {
    const fileGroups: Record<string, Set<string>> = {};
    const locDetails: Record<string, { lat: number, long: number, desc: string }> = {};
    
    fileFilteredData.forEach(r => {
      const key = getRecordFileKey(r);
      
      const cellId = r.first_cell_id;
      if (cellId && cellId !== '-' && cellId !== '---') {
        if (!fileGroups[key]) fileGroups[key] = new Set();
        fileGroups[key].add(cellId);
        
        // Store details for display
        if (!locDetails[cellId]) {
           locDetails[cellId] = { 
             lat: r.first_cell_lat || 0, 
             long: r.first_cell_long || 0,
             desc: r.first_cell_desc || ''
           };
        }
      }
    });

    const keys = Object.keys(fileGroups);
    if (keys.length < 2 || activeFileCount <= 1) return { hasMultipleFiles: false, common: [] };

    let commonIds = Array.from(fileGroups[keys[0]]);
    for (let i = 1; i < keys.length; i++) {
      commonIds = commonIds.filter(id => fileGroups[keys[i]].has(id));
    }

    const common = commonIds.map(id => ({
      cellId: id,
      ...locDetails[id]
    }));

    return { hasMultipleFiles: true, common: common.slice(0, 50) };
  }, [fileFilteredData, activeFileCount]);

  // 16. Home/Work Analysis
  const homeWorkData = useMemo(() => {
    const homeLocs: Record<string, { count: number, desc: string, lat: number, long: number }> = {};
    const workLocs: Record<string, { count: number, desc: string, lat: number, long: number }> = {};
    
    fileFilteredData.forEach(r => {
      const cellId = r.first_cell_id;
      if (!cellId || cellId === '-' || cellId === '---') return;
      
      const timeStr = r.call_start_time || '';
      const hourMatch = timeStr.match(/(\d{1,2}):/);
      if (!hourMatch) return;
      const hour = parseInt(hourMatch[1]);
      
      const lat = r.first_cell_lat || 0;
      const long = r.first_cell_long || 0;
      const desc = r.first_cell_desc || '';

      // Home: 10 PM (22) to 6 AM (6)
      if (hour >= 22 || hour < 6) {
        if (!homeLocs[cellId]) homeLocs[cellId] = { count: 0, desc, lat, long };
        homeLocs[cellId].count++;
      }
      
      // Work: 10 AM (10) to 5 PM (17)
      if (hour >= 10 && hour < 17) {
        if (!workLocs[cellId]) workLocs[cellId] = { count: 0, desc, lat, long };
        workLocs[cellId].count++;
      }
    });

    const topHome = Object.entries(homeLocs)
      .map(([cellId, stat]) => ({ cellId, ...stat, type: 'Home' }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const topWork = Object.entries(workLocs)
      .map(([cellId, stat]) => ({ cellId, ...stat, type: 'Work' }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { topHome, topWork };
  }, [fileFilteredData]);

  // 13. Hourly Activity
  const hourlyActivityData = useMemo(() => {
    const extractHour = (record: NormalizedCDR) => {
      const r = record as unknown as Record<string, unknown>;
      const callDate = typeof r.call_date === 'string' ? r.call_date : '';
      const candidates = [
        r.call_start_time,
        r.toc,
        r.call_time
      ]
        .filter((v) => typeof v === 'string')
        .map((v) => String(v || '').trim())
        .filter(Boolean);

      for (const value of candidates) {
        // ISO-like: 2023-01-01T10:05:22 or any string Date can parse
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d.getHours();

        // time-only: 10:05 or 10:05:22
        const m1 = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (m1) {
          const h = parseInt(m1[1], 10);
          if (h >= 0 && h < 24) return h;
        }

        // digits: HHMM or HHMMSS
        const m2 = value.match(/^(\d{2})(\d{2})(\d{2})?$/);
        if (m2) {
          const h = parseInt(m2[1], 10);
          if (h >= 0 && h < 24) return h;
        }

        // combine call_date + time fragment if possible
        if (callDate) {
          const m3 = value.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
          if (m3) {
            const combined = `${callDate}T${m3[1].padStart(2, '0')}:${m3[2]}:${(m3[3] || '00').padStart(2, '0')}`;
            const cd = new Date(combined);
            if (!Number.isNaN(cd.getTime())) return cd.getHours();
          }
        }
      }

      return null;
    };

    const hours = Array(24).fill(0).map((_, i) => ({ hour: i, count: 0 }));
    fileFilteredData.forEach(r => {
      const h = extractHour(r);
      if (h === null) return;
      hours[h].count++;
    });
    return hours;
  }, [fileFilteredData]);

  // 14. Day First/Last Call
  const dayFirstLastData = useMemo(() => {
    const days: Record<string, { date: string, first: string, last: string, duration: number, count: number }> = {};
    fileFilteredData.forEach(r => {
      const date = r.call_date;
      const time = r.call_start_time;
      if (!date || !time) return;
      
      if (!days[date]) {
        days[date] = { date, first: time, last: time, duration: 0, count: 0 };
      }
      
      if (time < days[date].first) days[date].first = time;
      if (time > days[date].last) days[date].last = time;
      days[date].duration += (r.duration_sec || 0);
      days[date].count++;
    });
    return Object.values(days).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [fileFilteredData]);

  // 15. Roaming Period
  const roamingPeriodData = useMemo(() => {
    const periods: Array<{ circle: string; start: string; end: string; count: number }> = [];
    let currentPeriod: { circle: string; start: string; end: string; count: number } | null = null;
    
    // Sort data by date/time first
    const sorted = [...fileFilteredData].sort((a, b) => {
      const da = new Date(`${a.call_date} ${a.call_start_time}`).getTime();
      const db = new Date(`${b.call_date} ${b.call_start_time}`).getTime();
      return da - db;
    });

    sorted.forEach(r => {
      const roaming = r.roaming_circle;
      if (roaming && roaming !== '-' && roaming.toLowerCase() !== 'null') {
        if (!currentPeriod || currentPeriod.circle !== roaming) {
          if (currentPeriod) periods.push(currentPeriod);
          currentPeriod = { circle: roaming, start: `${r.call_date} ${r.call_start_time}`, end: `${r.call_date} ${r.call_start_time}`, count: 0 };
        }
        currentPeriod.end = `${r.call_date} ${r.call_start_time}`;
        currentPeriod.count++;
      } else {
        if (currentPeriod) {
          periods.push(currentPeriod);
          currentPeriod = null;
        }
      }
    });
    if (currentPeriod) periods.push(currentPeriod);
    return periods;
  }, [fileFilteredData]);


  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <span className="material-symbols-outlined text-4xl text-blue-500 animate-spin">sync</span>
        <p className="mt-4 text-slate-600 dark:text-slate-400">Loading CDR Data...</p>
      </div>
    );
  }

  return (
    <div className="analysis-shell relative z-0 flex h-full flex-col overflow-hidden font-display">
      {/* Header */}
      <header className="analysis-topbar flex min-h-20 shrink-0 items-center justify-between px-6 py-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="material-symbols-outlined text-slate-700 dark:text-white text-2xl hover:text-blue-500 transition-colors">
              arrow_back
            </button>
          )}
          <span className="material-symbols-outlined text-slate-700 dark:text-white text-2xl">analytics</span>
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">CDR Analysis</h1>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-mono">Case: {caseName || 'Unknown'} • {operator || 'AUTO'}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              onClick={() => setIsReportMenuOpen(v => !v)}
              className="flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors"
            >
              <span className="material-symbols-outlined text-sm">tune</span>
              Reports
            </button>
            {isReportMenuOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg p-3 z-20">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Select Reports</span>
                  <button
                    onClick={() => setSelectedSheetNames(CDR_SHEET_DEFS.map(sheet => sheet.name))}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700"
                  >
                    Select All
                  </button>
                </div>
                <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                  {CDR_SHEET_DEFS.map(sheet => (
                    <label key={sheet.name} className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={selectedSheetNames.includes(sheet.name)}
                        onChange={() => toggleSheetName(sheet.name)}
                        className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                      />
                      <span className="truncate">{sheet.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <button onClick={handleExportExcel} disabled={isExporting} className="flex items-center gap-2 px-3 py-1 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
            <span className={`material-symbols-outlined text-sm ${isExporting ? 'animate-spin' : ''}`}>{isExporting ? 'progress_activity' : 'file_download'}</span>
            {isExporting ? 'Exporting...' : 'Export Excel'}
          </button>
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-xs font-mono">
            <span className="material-symbols-outlined text-sm">schedule</span>
            {currentTime.toLocaleTimeString()}
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <AnalysisTabBar
        value={selectedTab}
        onChange={setSelectedTab}
        tabs={[
          { id: 'overview', label: 'Overview', icon: 'overview' },
          { id: 'records', label: 'Records', icon: 'records' },
          { id: 'analysis', label: 'Advanced Analysis', icon: 'analysis' },
          { id: 'location', label: 'Location & Roaming', icon: 'map' }
        ]}
      />

      {isExporting && (
        <div className="fixed inset-0 z-[100] bg-slate-900/30 backdrop-blur-[1px] flex items-center justify-center">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 px-5 py-4 flex items-center gap-3">
            <span className="material-symbols-outlined animate-spin text-blue-600 dark:text-blue-400">progress_activity</span>
            <div>
              <div className="text-sm font-semibold text-slate-900 dark:text-white">Preparing Excel export</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Large exports may take time.</div>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="analysis-content custom-scrollbar flex-1 overflow-y-auto p-6">
        {availableFiles.length > 1 && (
          <div className="max-w-7xl mx-auto mb-6">
            <div className="analysis-panel">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">File Selection</h3>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                  Selected {selectedFileKeys.length} of {availableFiles.length}
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                {availableFiles.map(file => (
                  <label key={file.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={selectedFileKeys.includes(file.key)}
                      onChange={() => toggleFileKey(file.key)}
                      className="h-4 w-4 rounded border-slate-300 dark:border-slate-600"
                    />
                    <span className="whitespace-nowrap">{file.name}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">({file.count})</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-2 mt-4">
                <button
                  onClick={() => setSelectedFileKeys(availableFiles.map(file => file.key))}
                  className="px-3 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Select All
                </button>
                <button
                  onClick={() => setSelectedFileKeys([])}
                  className="px-3 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* OVERVIEW TAB */}
        {selectedTab === 'overview' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { label: getMetricUiLabel('total_records', 'Total Records'), value: stats.totalRecords.toLocaleString(), icon: 'description', color: 'blue' },
                { label: getMetricUiLabel('unique_a_parties', 'Unique A-Parties'), value: stats.uniqueAParties.toLocaleString(), icon: 'person', color: 'green' },
                { label: getMetricUiLabel('unique_b_parties', 'Unique B-Parties'), value: stats.uniqueBParties.toLocaleString(), icon: 'group', color: 'purple' },
                { label: getMetricUiLabel('avg_duration_sec', 'Avg Duration'), value: `${stats.avgDuration}s`, icon: 'timer', color: 'orange' }
              ].map((stat, i) => (
                <div key={i} className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-800 dark:bg-[#111c38]">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`material-symbols-outlined text-2xl text-${stat.color}-500`}>{stat.icon}</span>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{stat.label}</h3>
                  </div>
                  <p className={`text-3xl font-black text-${stat.color}-600 dark:text-${stat.color}-400`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Hourly Activity Chart */}
            <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#111c38]">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Hourly Call Activity</h3>
              <div className="h-64">
                <ResponsiveContainer
                  key={`hourly-${chartRenderKey}`}
                  width="99%"
                  height={256}
                  minWidth={320}
                  minHeight={200}
                >
                  <LineChart data={hourlyActivityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" opacity={0.24} />
                    <XAxis dataKey="hour" />
                    <YAxis />
                    <Tooltip contentStyle={{ borderRadius: '14px', border: '1px solid #dbe4f0', backgroundColor: '#ffffff' }} />
                    <Line type="monotone" dataKey="count" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 4, fill: '#1d4ed8' }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Call Type Chart */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#111c38]">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Call Types</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={Object.entries(stats.callTypes).map(([name, value]) => ({ name, value }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" opacity={0.24} />
                      <XAxis dataKey="name" tick={{fontSize: 10}} interval={0} angle={-45} textAnchor="end" />
                      <YAxis />
                      <Tooltip contentStyle={{ borderRadius: '14px', border: '1px solid #dbe4f0', backgroundColor: '#ffffff' }} />
                      <Bar dataKey="value" fill="#3b82f6" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Direction Pie Chart */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#111c38]">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Call Direction</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Incoming', value: stats.incoming },
                          { name: 'Outgoing', value: stats.outgoing },
                          { name: 'SMS', value: stats.sms }
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        <Cell fill="#1d4ed8" />
                        <Cell fill="#3b82f6" />
                        <Cell fill="#93c5fd" />
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '14px', border: '1px solid #dbe4f0', backgroundColor: '#ffffff' }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Top B Parties Preview */}
              <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-[#111c38]">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Top 5 B-Parties</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-700">
                        <th className="text-left py-2">Number</th>
                        <th className="text-left py-2">Count</th>
                        <th className="text-left py-2">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {maxBPartyData.slice(0, 5).map((row, i) => (
                        <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                          <td className="py-2 font-mono">{row.phone}</td>
                          <td className="py-2">{row.count}</td>
                          <td className="py-2">{row.durationStr}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Top Locations Preview */}
              <div className="analysis-panel lg:col-span-3">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Top Locations</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {maxLocationData.slice(0, 6).map((loc, i) => (
                    <div key={i} className="analysis-panel-soft flex items-center gap-3 p-3">
                      <div className="bg-blue-100 dark:bg-blue-900/30 p-2 rounded-full text-blue-600 dark:text-blue-400">
                        <span className="material-symbols-outlined text-xl">location_on</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold truncate">{loc.cellId}</div>
                        <div className="text-xs text-slate-500">{loc.count} calls • {loc.duration}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RECORDS TAB */}
        {selectedTab === 'records' && (
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Filters */}
            <div className="analysis-panel">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Filters</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
                <input 
                  placeholder="Search..." 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                />
                <input 
                  placeholder="Call Type (e.g. MOC)" 
                  value={callTypeFilter} 
                  onChange={e => setCallTypeFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                />
                <input 
                  type="date" 
                  value={dateFromFilter}  
                  onChange={e => setDateFromFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                />
                <input 
                  type="date" 
                  value={dateToFilter} 
                  onChange={e => setDateToFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                />
                <input 
                  placeholder="Min Duration (s)" 
                  type="number"
                  value={durationMinFilter} 
                  onChange={e => setDurationMinFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                />
                <input 
                  placeholder="Max Duration (s)" 
                  type="number"
                  value={durationMaxFilter} 
                  onChange={e => setDurationMaxFilter(e.target.value)}
                  className="px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg outline-none"
                />
              </div>
            </div>

            {/* Table */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="max-h-[600px] overflow-y-auto">
                <RecordTable rows={currentPageData as unknown as Record<string, unknown>[]} maxRows={50} />
              </div>
              
              {/* Pagination */}
              <div className="p-4 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-sm text-slate-500">
                  Showing {showingStart}-{showingEnd} of {filteredRecords.length}
                </span>
                <div className="flex gap-2">
                  <button 
                    disabled={currentPage === 1}
                    onClick={() => goToPage(currentPage - 1)}
                    className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded disabled:opacity-50"
                  >Prev</button>
                  <span className="px-3 py-1">{currentPage} / {totalPages}</span>
                  <button 
                    disabled={currentPage === totalPages}
                    onClick={() => goToPage(currentPage + 1)}
                    className="px-3 py-1 bg-slate-100 dark:bg-slate-700 rounded disabled:opacity-50"
                  >Next</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ANALYSIS TAB */}
        {selectedTab === 'analysis' && (
          <div className="max-w-7xl mx-auto space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              
              {/* Max B Party */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-blue-500">contacts</span> Max B-Party
                </h3>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {maxBPartyData.map((item, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                      <div>
                        <div className="font-mono font-medium">{item.phone}</div>
                        <div className="text-xs text-slate-500">{item.durationStr} • {item.incoming} In / {item.outgoing} Out</div>
                      </div>
                      <div className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-sm font-bold">{item.count}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Max IMEI */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-purple-500">smartphone</span> Max IMEI
                </h3>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {maxImeiData.map((item, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="font-mono text-sm">{displayIMEI(item.imei)}</div>
                      <div className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-sm font-bold">{item.count}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Max IMSI */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-indigo-500">sim_card</span> Max IMSI
                </h3>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {maxImsiData.map((item, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="font-mono text-sm">{item.imsi}</div>
                      <div className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-sm font-bold">{item.count}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* SMS Analysis */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-green-500">sms</span> SMS Analysis
                </h3>
                <div className="mb-4 grid grid-cols-2 gap-2 text-center">
                   <div className="bg-slate-50 dark:bg-slate-900 p-2 rounded">
                      <div className="text-xl font-bold">{smsData.sent}</div>
                      <div className="text-xs text-slate-500">Sent</div>
                   </div>
                   <div className="bg-slate-50 dark:bg-slate-900 p-2 rounded">
                      <div className="text-xl font-bold">{smsData.received}</div>
                      <div className="text-xs text-slate-500">Received</div>
                   </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  <h4 className="text-xs font-bold uppercase text-slate-500 mb-2">Top Contacts</h4>
                  {smsData.topContacts.map((item, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="font-mono text-sm">{item.phone}</div>
                      <div className="bg-green-100 text-green-700 px-2 py-1 rounded text-sm font-bold">{item.count}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Night Stay */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-500">nights_stay</span> Night Activity (8PM-7AM)
                </h3>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {nightStayData.length > 0 ? nightStayData.map((item, i) => (
                    <div key={i} className="py-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex justify-between">
                         <div className="font-mono text-sm font-bold">{item.bParty}</div>
                         <div className="text-xs font-mono">{item.time}</div>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">Duration: {item.duration}s • Date: {item.date}</div>
                    </div>
                  )) : (
                    <div className="text-center text-slate-500 py-10">No night calls found</div>
                  )}
                </div>
              </div>

              {/* Regular Callers */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-teal-500">history</span> Regular Callers
                </h3>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {regularCallerData.map((item, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                      <div>
                        <div className="font-mono text-sm">{item.phone}</div>
                        <div className="text-xs text-slate-500">{item.daysActive} days active</div>
                      </div>
                      <div className="bg-teal-100 text-teal-700 px-2 py-1 rounded text-sm font-bold">{item.count}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ISD Calls */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-red-500">public</span> {getMetricUiLabel('international_calls', 'International Calls')}
                </h3>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                   {isdCallData.length > 0 ? isdCallData.map((item, i) => (
                    <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                      <div>
                        <div className="font-mono text-sm text-red-600 font-medium">{item.number}</div>
                        <div className="text-xs text-slate-500">{item.date} {item.time}</div>
                      </div>
                      <div className="text-xs font-mono">{item.duration}s</div>
                    </div>
                  )) : (
                    <div className="text-center text-slate-500 py-10">No international calls detected</div>
                  )}
                </div>
              </div>

              {/* Day Wise First/Last Call */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-orange-500">schedule</span> {getMetricUiLabel('daily_first_last_call', 'Daily First/Last Call')}
                </h3>
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                   {dayFirstLastData.length > 0 ? dayFirstLastData.map((item, i) => (
                    <div key={i} className="py-2 border-b border-slate-100 dark:border-slate-800">
                      <div className="flex justify-between items-center mb-1">
                        <div className="font-bold text-sm">{item.date}</div>
                        <div className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-xs font-bold">{item.count} calls</div>
                      </div>
                      <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                         <span>First: {item.first}</span>
                         <span>Last: {item.last}</span>
                      </div>
                    </div>
                  )) : (
                    <div className="text-center text-slate-500 py-10">No data available</div>
                  )}
                </div>
              </div>

              {/* Home/Work Analysis */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                  <span className="material-symbols-outlined text-cyan-500">home_work</span> Home & Work
                </h3>
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4">
                  <div>
                    <h4 className="text-xs font-bold uppercase text-slate-500 mb-2 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">home</span> Home (10PM - 6AM)
                    </h4>
                    {homeWorkData.topHome.length > 0 ? homeWorkData.topHome.map((item, i) => (
                      <div key={i} className="py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <div className="flex justify-between">
                          <span className="font-mono text-xs font-bold truncate max-w-[120px]">{item.cellId}</span>
                          <span className="bg-cyan-100 text-cyan-700 px-1.5 rounded text-xs font-bold">{item.count}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">{item.desc}</div>
                      </div>
                    )) : <div className="text-xs text-slate-400 italic">No home locations identified</div>}
                  </div>
                  
                  <div>
                    <h4 className="text-xs font-bold uppercase text-slate-500 mb-2 flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm">work</span> Work (10AM - 5PM)
                    </h4>
                    {homeWorkData.topWork.length > 0 ? homeWorkData.topWork.map((item, i) => (
                      <div key={i} className="py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                        <div className="flex justify-between">
                          <span className="font-mono text-xs font-bold truncate max-w-[120px]">{item.cellId}</span>
                          <span className="bg-orange-100 text-orange-700 px-1.5 rounded text-xs font-bold">{item.count}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">{item.desc}</div>
                      </div>
                    )) : <div className="text-xs text-slate-400 italic">No work locations identified</div>}
                  </div>
                </div>
              </div>
              
              {/* Common B Party (if multiple files) */}
              {commonBPartyData.hasMultipleFiles && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-pink-500">compare_arrows</span> Common Numbers
                  </h3>
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                     {commonBPartyData.common.length > 0 ? commonBPartyData.common.map((item, i) => (
                      <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                        <div className="font-mono text-sm font-bold text-pink-600">{item}</div>
                        <div className="text-xs text-slate-500">Present in all files</div>
                      </div>
                    )) : (
                      <div className="text-center text-slate-500 py-10">No common numbers found across files</div>
                    )}
                  </div>
                </div>
              )}

              {/* Common IMEI (if multiple files) */}
              {commonIMEIData.hasMultipleFiles && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-purple-500">phonelink_ring</span> Common IMEI
                  </h3>
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                     {commonIMEIData.common.length > 0 ? commonIMEIData.common.map((item, i) => (
                      <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                        <div className="font-mono text-sm font-bold text-purple-600">{displayIMEI(item)}</div>
                        <div className="text-xs text-slate-500">Present in all files</div>
                      </div>
                    )) : (
                      <div className="text-center text-slate-500 py-10">No common IMEI found across files</div>
                    )}
                  </div>
                </div>
              )}

              {/* Common IMSI (if multiple files) */}
              {commonIMSIData.hasMultipleFiles && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-indigo-500">sim_card</span> Common IMSI
                  </h3>
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                     {commonIMSIData.common.length > 0 ? commonIMSIData.common.map((item, i) => (
                      <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                        <div className="font-mono text-sm font-bold text-indigo-600">{item}</div>
                        <div className="text-xs text-slate-500">Present in all files</div>
                      </div>
                    )) : (
                      <div className="text-center text-slate-500 py-10">No common IMSI found across files</div>
                    )}
                  </div>
                </div>
              )}

              {/* Common Location (if multiple files) */}
              {commonLocationData.hasMultipleFiles && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col h-96">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
                    <span className="material-symbols-outlined text-red-500">location_on</span> Common Location
                  </h3>
                  <div className="flex-1 overflow-y-auto custom-scrollbar">
                     {commonLocationData.common.length > 0 ? commonLocationData.common.map((item, i) => (
                      <div key={i} className="py-2 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex justify-between items-center mb-1">
                          <div className="font-mono text-sm font-bold text-red-600">{item.cellId}</div>
                          <div className="text-xs text-slate-500">Common</div>
                        </div>
                        <div className="text-xs text-slate-600 dark:text-slate-400 truncate">
                          {item.desc || 'No Description'}
                        </div>
                        {(item.lat !== 0 || item.long !== 0) && (
                          <div className="text-xs text-slate-500 font-mono mt-1">
                            {item.lat}, {item.long}
                          </div>
                        )}
                      </div>
                    )) : (
                      <div className="text-center text-slate-500 py-10">No common locations found across files</div>
                    )}
                  </div>
                </div>
              )}

            </div>
          </div>
        )}

        {/* LOCATION TAB */}
        {selectedTab === 'location' && (
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 md:col-span-2">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">CDR Map View</h3>
                <span className="text-xs text-slate-500 dark:text-slate-400">{cdrMapPoints.length} points</span>
              </div>
              <div className="h-[520px] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                {cdrMapPoints.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-500 dark:text-slate-400">
                    <div className="text-center px-6">
                      <span className="material-symbols-outlined text-5xl mb-2">location_off</span>
                      <div className="font-semibold">No CDR coordinates found</div>
                      <div className="text-sm">Need first/last cell latitude and longitude in the records.</div>
                    </div>
                  </div>
                ) : (
                  <MapContainer center={[20.5937, 78.9629]} zoom={5} style={{ height: '100%', width: '100%' }}>
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <FitCdrMapBounds points={cdrMapPoints} />
                    {cdrMapPoints.map((point) => {
                      const radius = Math.max(4, Math.min(14, 4 + Math.log10(point.count + 1) * 4));
                      return (
                        <CircleMarker
                          key={point.id}
                          center={[point.lat, point.lng]}
                          radius={radius}
                          pathOptions={{ color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.65, weight: 1.5 }}
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
             {/* Cell ID Analysis */}
             <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Max Cell ID Location</h3>
              <div className="max-h-96 overflow-y-auto">
                {maxLocationData.map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                    <div>
                      <div className="font-mono text-sm">{item.cellId}</div>
                      <div className="text-xs text-slate-500">{item.duration} duration</div>
                    </div>
                    <div className="bg-orange-100 text-orange-700 px-2 py-1 rounded text-sm font-bold">{item.count}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Other State */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Other State / Roaming Summary</h3>
              <div className="max-h-96 overflow-y-auto">
                {otherStateData.map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800">
                    <div className="font-medium">{item.state}</div>
                    <div className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-sm font-bold">{item.count} calls</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Roaming Periods */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-6 md:col-span-2">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">Roaming Periods</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 dark:bg-slate-900">
                    <tr>
                      <th className="px-4 py-2">Circle</th>
                      <th className="px-4 py-2">Start Time</th>
                      <th className="px-4 py-2">End Time</th>
                      <th className="px-4 py-2">Count</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {roamingPeriodData.map((period, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-2 font-medium">{period.circle}</td>
                        <td className="px-4 py-2">{period.start}</td>
                        <td className="px-4 py-2">{period.end}</td>
                        <td className="px-4 py-2">{period.count}</td>
                      </tr>
                    ))}
                    {roamingPeriodData.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-4 py-8 text-center text-slate-500">No roaming periods detected</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
