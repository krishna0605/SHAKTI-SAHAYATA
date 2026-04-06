import React, { useEffect, useMemo, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { AnalysisTabBar } from './AnalysisTabBar';

/* ===================== DATA ===================== */

type CDR = {
  rank: number;
  phone: string;
  count: number;
  duration: string;
  in: number;
  active: string;
  a_party: string;
  call_type: string;
  date: string;
  time: string;
  cell_id: string;
  imei: string;
  imsi: string;
};

const B_PARTY_DATA: CDR[] = [
  {
    rank: 1,
    phone: '9925012345',
    count: 142,
    duration: '04:15:32',
    in: 70,
    active: '2 hours ago',
    a_party: '9876543210',
    call_type: 'MOC',
    date: '2023-10-24',
    time: '10:05:22',
    cell_id: '404-12-32112',
    imei: '123456789012345',
    imsi: '404120001234567'
  },
  {
    rank: 2,
    phone: '9876543210',
    count: 89,
    duration: '02:45:10',
    in: 20,
    active: 'Yesterday',
    a_party: '9876543210',
    call_type: 'MTC',
    date: '2023-10-24',
    time: '10:15:00',
    cell_id: '404-12-32115',
    imei: '123456789012346',
    imsi: '404120001234568'
  }
];

/* ===================== HELPERS ===================== */

const parseDurationToSeconds = (d: string): number => {
  const [h, m, s] = d.split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

const displayBigNumber = (v?: string) => v ?? '-';

/* ===================== COMPONENT ===================== */

export const CDRAnalysis: React.FC = () => {
  const [time, setTime] = useState(new Date());
  const [selectedTab, setSelectedTab] = useState<'overview' | 'map'>('overview');
  const [selectedOverviewTab, setSelectedOverviewTab] =
    useState<'overview' | 'records' | 'charts'>('overview');

  /* ===================== TIMER ===================== */

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  /* ===================== STATS ===================== */

  const stats = useMemo(() => {
    const callTypes: Record<string, number> = {};
    const imeiMap: Record<string, number> = {};
    const imsiMap: Record<string, number> = {};

    let totalDuration = 0;

    B_PARTY_DATA.forEach(r => {
      callTypes[r.call_type] = (callTypes[r.call_type] || 0) + 1;
      imeiMap[r.imei] = (imeiMap[r.imei] || 0) + 1;
      imsiMap[r.imsi] = (imsiMap[r.imsi] || 0) + 1;
      totalDuration += parseDurationToSeconds(r.duration);
    });

    return {
      total: B_PARTY_DATA.length,
      avgDuration:
        B_PARTY_DATA.length > 0
          ? Math.round(totalDuration / B_PARTY_DATA.length)
          : 0,
      callTypes,
      imeis: Object.entries(imeiMap),
      imsis: Object.entries(imsiMap)
    };
  }, []);

  /* ===================== RENDER ===================== */

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white">
      {/* HEADER */}
      <header className="h-16 border-b flex items-center justify-between px-6 bg-white dark:bg-slate-800">
        <h1 className="text-xl font-bold">CDR Analysis</h1>
        <span className="font-mono">
          {time.toLocaleTimeString()}
        </span>
      </header>

      {/* CONTENT */}
      <div className="flex-1 p-6 space-y-6 overflow-y-auto">
        {/* MAIN TABS */}
        <AnalysisTabBar
          value={selectedTab}
          onChange={setSelectedTab}
          tabs={[
            { id: 'overview', label: 'Overview', icon: 'overview' },
            { id: 'map', label: 'Map View', icon: 'map' },
          ]}
          className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[#111c38]"
        />

        {/* OVERVIEW */}
        {selectedTab === 'overview' && (
          <div className="space-y-6">
            {/* SUB TABS */}
            <AnalysisTabBar
              value={selectedOverviewTab}
              onChange={setSelectedOverviewTab}
              tabs={[
                { id: 'overview', label: 'Overview', icon: 'overview' },
                { id: 'records', label: 'Records', icon: 'records' },
                { id: 'charts', label: 'Charts', icon: 'charts' },
              ]}
              className="rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[#111c38]"
            />

            {/* OVERVIEW PANEL */}
            {selectedOverviewTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-[#111c38]">
                  Total Records: {stats.total}
                </div>
                <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-[#111c38]">
                  Avg Duration: {stats.avgDuration}s
                </div>
              </div>
            )}

            {/* RECORDS PANEL */}
            {selectedOverviewTab === 'records' && (
              <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-800 dark:bg-[#111c38]">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th>A Party</th>
                      <th>B Party</th>
                      <th>Type</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {B_PARTY_DATA.map((r, i) => (
                      <tr key={i}>
                        <td>{r.a_party}</td>
                        <td>{r.phone}</td>
                        <td>{r.call_type}</td>
                        <td>{r.duration}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* CHARTS PANEL */}
            {selectedOverviewTab === 'charts' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={stats.imeis.map(([k, v]) => ({
                        name: displayBigNumber(k),
                        value: v
                      }))}
                      dataKey="value"
                      outerRadius={80}
                    >
                      {stats.imeis.map((_, i) => (
                        <Cell key={i} fill={['#3b82f6', '#22c55e'][i % 2]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>

                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={Object.entries(stats.callTypes).map(([k, v]) => ({
                      name: k,
                      value: v
                    }))}
                  >
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="value" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* MAP */}
        {selectedTab === 'map' && (
          <div className="rounded-2xl border border-slate-200/80 bg-white p-10 text-center shadow-sm dark:border-slate-800 dark:bg-[#111c38]">
            Map View Coming Soon
          </div>
        )}
      </div>
    </div>
  );
};
