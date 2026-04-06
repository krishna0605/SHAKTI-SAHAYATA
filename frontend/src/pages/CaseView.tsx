import { useState, useEffect, lazy, Suspense } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { caseAPI, fileAPI, recordCountAPI } from '../components/lib/apis';
import { useCaseContextStore } from '../stores/caseContextStore';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const DATA_TYPES = [
  { key: 'cdr', label: 'CDR', icon: '📞', desc: 'Call Detail Records' },
  { key: 'ipdr', label: 'IPDR', icon: '🌐', desc: 'IP Detail Records' },
  { key: 'sdr', label: 'SDR', icon: '👤', desc: 'Subscriber Detail Records' },
  { key: 'tower', label: 'Tower Dump', icon: '📡', desc: 'Tower Dump Records' },
  { key: 'ild', label: 'ILD', icon: '🌍', desc: 'International Long Distance' },
];

const tiltCardClass =
  'transform-gpu transition duration-300 hover:[transform:perspective(1200px)_rotateX(3deg)_rotateY(-3deg)_translateY(-4px)] hover:shadow-[0_22px_50px_rgba(10,19,51,0.18)]';

const tiltShellClass =
  'transform-gpu transition duration-300 hover:[transform:perspective(1800px)_rotateX(1.5deg)_rotateY(-1.5deg)_translateY(-2px)]';

// Lazy-load analysis & upload components (named exports → default via .then)
const CDRUpload = lazy(() => import('../components/upload/CDRUpload').then(m => ({ default: m.CDRUpload })));
const IPDRUpload = lazy(() => import('../components/upload/IPDRUpload').then(m => ({ default: m.IPDRUpload })));
const SDRUpload = lazy(() => import('../components/upload/SDRUpload').then(m => ({ default: m.SDRUpload })));
const TowerDumpUpload = lazy(() => import('../components/upload/TowerDumpUpload').then(m => ({ default: m.TowerDump })));
const ILDUpload = lazy(() => import('../components/upload/ILDUpload').then(m => ({ default: m.ILDUpload })));

const CDRAdvancedAnalysis = lazy(() => import('../components/analysis/CDRAdvancedAnalysis').then(m => ({ default: m.AdvancedAnalytics })));
// IPDRAnalytics already has a default export
const IPDRAnalytics = lazy(() => import('../components/analysis/IPDRAnalytics'));
const SDRSearch = lazy(() => import('../components/analysis/SDRSearch').then(m => ({ default: m.SDRSearch })));
const TowerDumpAnalysis = lazy(() => import('../components/analysis/TowerDumpAnalysis').then(m => ({ default: m.TowerDumpAnalysis })));
const ILDAnalysis = lazy(() => import('../components/analysis/ILDAnalysis').then(m => ({ default: m.ILDAnalysis })));

interface CaseData {
  id: number;
  case_name: string;
  case_number: string;
  case_type: string;
  fir_number: string;
  status: string;
  priority: string;
  operator: string;
  investigation_details: string;
  start_date: string;
  end_date: string;
  is_evidence_locked: boolean;
  file_count: number;
  created_at: string;
  created_by_name: string;
}

interface TimelineEvent {
  source: string;
  event_time: string | null;
  title: string;
  details: Record<string, unknown>;
}

export default function CaseView() {
  const { id, dataType } = useParams();
  const navigate = useNavigate();
  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [recordCounts, setRecordCounts] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [subView, setSubView] = useState<'upload' | 'analysis'>('analysis');
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const setActiveCase = useCaseContextStore((state) => state.setActiveCase);

  useEffect(() => {
    void loadCase();
    void loadFiles();
    void loadRecordCounts();
  }, [id]);

  // If a dataType is present in the URL, switch to Data tab
  useEffect(() => {
    if (dataType) {
      setActiveTab('data');
    }
  }, [dataType]);

  useEffect(() => {
    if (!caseData) return;
    setActiveCase({
      id: String(caseData.id),
      caseName: caseData.case_name,
      caseNumber: caseData.case_number,
      firNumber: caseData.fir_number,
      caseType: caseData.case_type,
      operator: caseData.operator,
      status: caseData.status,
      createdAt: caseData.created_at,
      hasFiles: Number(caseData.file_count || 0) > 0,
      locked: true
    });
  }, [caseData, setActiveCase]);

  useEffect(() => {
    if (activeTab !== 'timeline' || !id) return;
    let cancelled = false;

    const loadTimeline = async () => {
      try {
        setTimelineLoading(true);
        const data = await caseAPI.getTimeline(String(id));
        if (!cancelled) {
          setTimeline(Array.isArray(data?.events) ? data.events : []);
        }
      } catch (error) {
        console.error(error);
        if (!cancelled) {
          setTimeline([]);
        }
      } finally {
        if (!cancelled) {
          setTimelineLoading(false);
        }
      }
    };

    void loadTimeline();
    return () => {
      cancelled = true;
    };
  }, [activeTab, id]);

  const loadCase = async () => {
    try {
      if (!id) return;
      const data = await caseAPI.get(String(id));
      setCaseData(data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const loadFiles = async () => {
    try {
      if (!id) return;
      const rows = await fileAPI.listByCase(String(id));
      setFiles(rows);
    } catch (err) { console.error(err); }
  };

  const loadRecordCounts = async () => {
    const counts: Record<string, number> = {};
    for (const dt of DATA_TYPES) {
      try {
        if (!id) continue;
        counts[dt.key] = await recordCountAPI.getCountByCase(
          dt.key as 'cdr' | 'ipdr' | 'sdr' | 'tower' | 'ild',
          String(id)
        );
      } catch { counts[dt.key] = 0; }
    }
    setRecordCounts(counts);
  };

  const getPriorityClass = (p: string) => {
    const map: Record<string, string> = { critical: 'priority-critical', high: 'priority-high', medium: 'priority-medium', low: 'priority-low' };
    return map[p] || '';
  };

  const getStatusClass = (s: string) => {
    const map: Record<string, string> = { open: 'status-open', active: 'status-active', closed: 'status-closed', archived: 'status-archived', locked: 'status-locked' };
    return map[s] || '';
  };

  /** Render the selected data type's upload or analysis component */
  const renderDataTypeView = () => {
    if (!dataType || !caseData) return null;

    const caseId = String(caseData.id);
    const caseName = caseData.case_name;
    const operator = caseData.operator || '';
    const onBack = () => navigate(`/case/${id}`);

    const handleUploadSuccess = () => {
      setSubView('analysis');
      loadRecordCounts();
      loadFiles();
    };

    return (
      <div className="data-type-view">
        {/* Sub-navigation: Upload | Analysis */}
        <div className="data-type-subnav">
          <button className="btn-back" onClick={onBack}>← Back to Case</button>
          <div className="subnav-tabs">
            <button
              className={`subnav-tab ${subView === 'upload' ? 'active' : ''}`}
              onClick={() => setSubView('upload')}
            >
              📤 Upload
            </button>
            <button
              className={`subnav-tab ${subView === 'analysis' ? 'active' : ''}`}
              onClick={() => setSubView('analysis')}
            >
              📊 Analysis
            </button>
          </div>
        </div>

        <Suspense
          fallback={
            <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white/90 p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900/80">
              <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-300">
                SHAKTI SAHAYATA
              </div>
              <h3 className="mt-3 text-2xl font-black text-slate-900 dark:text-white">
                Loading {dataType.toUpperCase()} {subView}
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                Preparing charts, records, and analysis widgets for this case module.
              </p>
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div className="h-full w-1/2 animate-pulse rounded-full bg-blue-600 dark:bg-blue-400" />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                {['Case header remains available', 'Files and chat stay usable', 'Heavy charts load only when needed'].map((item) => (
                  <div
                    key={item}
                    className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300"
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          }
        >
          {subView === 'upload' && (
            <>
              {dataType === 'cdr' && <CDRUpload caseId={caseId} caseName={caseName} caseOperator={operator} onUploadSuccess={handleUploadSuccess} />}
              {dataType === 'ipdr' && <IPDRUpload caseId={caseId} caseName={caseName} caseOperator={operator} onUploadSuccess={handleUploadSuccess} />}
              {dataType === 'sdr' && <SDRUpload caseId={caseId} />}
              {dataType === 'tower' && <TowerDumpUpload caseId={caseId} caseName={caseName} caseOperator={operator} onUploadSuccess={handleUploadSuccess} />}
              {dataType === 'ild' && <ILDUpload caseId={caseId} caseName={caseName} caseOperator={operator} onUploadSuccess={handleUploadSuccess} />}
            </>
          )}
          {subView === 'analysis' && (
            <>
              {dataType === 'cdr' && (
                <CDRAdvancedAnalysis caseId={caseId} caseName={caseName} operator={operator} onBack={onBack} />
              )}
              {dataType === 'ipdr' && (
                <IPDRAnalytics caseId={caseId} caseName={caseName} operator={operator} parsedData={[]} fileCount={0} onBack={onBack} />
              )}
              {dataType === 'sdr' && (
                <SDRSearch caseId={caseId} />
              )}
              {dataType === 'tower' && (
                <TowerDumpAnalysis caseId={caseId} caseName={caseName} operator={operator} fileCount={0} onBack={onBack} />
              )}
              {dataType === 'ild' && (
                <ILDAnalysis caseId={caseId} caseName={caseName} operator={operator} onBack={onBack} />
              )}
            </>
          )}
        </Suspense>
      </div>
    );
  };

  const renderDefaultTabContent = () => {
    if (!caseData) return null;

    if (activeTab === 'overview') {
      return (
        <div className={tiltShellClass}>
        <Card className="rounded-[1.75rem] border-border/70 bg-white/50 shadow-xl dark:bg-slate-900/50">
          <CardContent className="space-y-6 p-6 sm:p-8">
            {caseData.investigation_details && (
              <div className="case-section">
                <h3 className="mb-2 text-xl font-bold">Investigation Details</h3>
                <p className="text-slate-700 dark:text-slate-300">{caseData.investigation_details}</p>
              </div>
            )}
            <div className="case-section">
              <h3 className="mb-4 text-xl font-bold">Record Summary</h3>
              <div className="record-summary-grid grid grid-cols-2 gap-4 md:grid-cols-5">
                {DATA_TYPES.map((dt) => (
                  <div
                    key={dt.key}
                    className={cn(
                      'record-summary-card flex flex-col items-center rounded-xl border border-slate-200/70 bg-slate-50 p-4 shadow-sm dark:border-slate-700/60 dark:bg-slate-800',
                      tiltCardClass
                    )}
                  >
                    <span className="record-icon mb-2 text-3xl">{dt.icon}</span>
                    <span className="record-count text-2xl font-semibold">{recordCounts[dt.key] || 0}</span>
                    <span className="record-label text-sm text-slate-500">{dt.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        </div>
      );
    }

    if (activeTab === 'data') {
      return (
        <div className={tiltShellClass}>
        <Card className="rounded-[1.75rem] border-border/70 bg-white/50 shadow-xl dark:bg-slate-900/50">
          <CardContent className="p-6 sm:p-8">
            <div className="case-data-grid grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {DATA_TYPES.map((dt) => (
                <Link
                  key={dt.key}
                  to={`/case/${id}/${dt.key}`}
                  className={cn(
                    'data-type-card flex items-center rounded-xl border border-slate-200/70 bg-slate-50 p-6 shadow-sm dark:border-slate-700/60 dark:bg-slate-800',
                    tiltCardClass
                  )}
                >
                  <div className="data-type-icon mr-4 text-4xl">{dt.icon}</div>
                  <div className="data-type-info flex-1">
                    <h3 className="text-lg font-bold">{dt.label}</h3>
                    <p className="text-sm text-slate-500">{dt.desc}</p>
                    <span className="data-type-count mt-2 block text-sm text-shakti-600 dark:text-shakti-400">{recordCounts[dt.key] || 0} records</span>
                  </div>
                  <div className="data-type-arrow text-slate-400">→</div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
        </div>
      );
    }

    if (activeTab === 'timeline') {
      return (
        <div className={tiltShellClass}>
        <Card className="rounded-[1.75rem] border-border/70 bg-white/50 shadow-xl dark:bg-slate-900/50">
          <CardContent className="p-6 sm:p-8">
            <div className="case-section">
              <h3 className="mb-4 text-xl font-bold">Investigation Timeline</h3>
              {timelineLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-20 w-full rounded-2xl" />
                  <Skeleton className="h-20 w-full rounded-2xl" />
                  <Skeleton className="h-20 w-full rounded-2xl" />
                </div>
              ) : timeline.length === 0 ? (
                <p className="no-data text-slate-500">No timeline events found yet for this case.</p>
              ) : (
                <div className="space-y-4">
                  {timeline.map((event, index) => (
                    <div
                      key={`${event.source}-${event.title}-${index}`}
                      className={cn(
                        'rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900',
                        tiltCardClass
                      )}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-md font-semibold text-slate-900 dark:text-white">{event.title}</p>
                          <p className="mt-1 text-xs uppercase tracking-wider text-slate-500 dark:text-slate-400">{event.source}</p>
                        </div>
                        <p className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          {event.event_time ? new Date(event.event_time).toLocaleString() : 'Timestamp unavailable'}
                        </p>
                      </div>
                      <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-50 p-4 text-xs whitespace-pre-wrap text-slate-700 dark:bg-slate-950 dark:text-slate-300">
                        {JSON.stringify(event.details || {}, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        </div>
      );
    }

    return (
      <div className={tiltShellClass}>
      <Card className="rounded-[1.75rem] border-border/70 bg-white/50 shadow-xl dark:bg-slate-900/50">
        <CardContent className="p-6 sm:p-8">
          <div className="case-files">
            {files.length === 0 ? (
              <p className="no-data text-slate-500">No files uploaded yet. Use the Data & Analysis tab to upload files.</p>
            ) : (
              <div className="case-section">
                <h3 className="mb-4 text-xl font-bold">Upload Review</h3>
                <div className="overflow-x-auto">
                  <table className="files-table w-full border-collapse text-left">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800">
                        <th className="p-3">File Name</th>
                        <th className="p-3">Declared Type</th>
                        <th className="p-3">Detected Type</th>
                        <th className="p-3">Confidence</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Accepted / Rejected</th>
                        <th className="p-3">Uploaded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {files.map((f: any) => (
                        <tr key={f.id} className="border-b border-slate-100 dark:border-slate-800/50">
                          <td className="p-3 font-medium">{f.original_name || f.file_name}</td>
                          <td className="p-3"><span className="badge rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{f.file_type || 'Unknown'}</span></td>
                          <td className="p-3 text-slate-600 dark:text-slate-400">{f.detected_type || '-'}</td>
                          <td className="p-3">{typeof f.confidence === 'number' ? `${Math.round(f.confidence * 100)}%` : '-'}</td>
                          <td className="p-3"><span className={`badge status-${f.parse_status}`}>{f.classification_result || f.parse_status}</span></td>
                          <td className="p-3 text-slate-600 dark:text-slate-400">{`${f.rows_accepted || 0} / ${f.rows_rejected || 0}`}</td>
                          <td className="p-3 text-sm text-slate-500">{new Date(f.uploaded_at).toLocaleDateString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Card className="rounded-[2rem] border-border/70">
          <CardContent className="space-y-5 p-6">
            <Skeleton className="h-5 w-48 rounded-xl" />
            <Skeleton className="h-12 w-80 rounded-2xl" />
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-8 w-24 rounded-full" />
              <Skeleton className="h-8 w-32 rounded-full" />
            </div>
          </CardContent>
        </Card>

        <Skeleton className="h-12 w-full rounded-2xl" />
        <Skeleton className="h-[34rem] w-full rounded-[2rem]" />
      </div>
    )
  }
  if (!caseData) return <div className="page-error">Case not found. <button onClick={() => navigate('/dashboard')}>Back to Dashboard</button></div>;

  // If a dataType is selected, show the dedicated view
  if (dataType) {
    return (
      <div className="case-view">
        {/* Minimal header */}
        <div className="case-header compact">
          <div className="case-header-top">
            <div>
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <button type="button" onClick={() => navigate('/dashboard')}>Dashboard</button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <button type="button" onClick={() => navigate(`/case/${id}`)}>{caseData.case_number}</button>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{DATA_TYPES.find(d => d.key === dataType)?.label || dataType.toUpperCase()}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <h1 className="case-title">{caseData.case_name}</h1>
            </div>
            <div className="case-header-badges">
              <Badge className={`${getStatusClass(caseData.status)} rounded-full`}>{caseData.status}</Badge>
              {caseData.is_evidence_locked && <Badge className="status-locked rounded-full">Locked</Badge>}
            </div>
          </div>
        </div>
        {renderDataTypeView()}
      </div>
    );
  }

  // Default case view with tabs
  return (
    <div className="case-view">
      {/* Case Header */}
      <div className="case-header">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <button type="button" onClick={() => navigate('/dashboard')}>Dashboard</button>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{caseData.case_number}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <div className="case-header-top">
          <button className="btn-back" onClick={() => navigate('/dashboard')}>← Back</button>
          <div className="case-header-badges">
            <Badge className={`${getStatusClass(caseData.status)} rounded-full`}>{caseData.status}</Badge>
            <Badge className={`${getPriorityClass(caseData.priority)} rounded-full`}>{caseData.priority}</Badge>
            {caseData.is_evidence_locked && <Badge className="status-locked rounded-full">Evidence Locked</Badge>}
          </div>
        </div>
        <h1 className="case-title">{caseData.case_name}</h1>
        <div className="case-meta">
          <span>📋 {caseData.case_number}</span>
          {caseData.operator && <span>📶 {caseData.operator}</span>}
          {caseData.fir_number && <span>📝 FIR: {caseData.fir_number}</span>}
          <span>👤 {caseData.created_by_name}</span>
          <span>📅 {new Date(caseData.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="mt-6 space-y-5">
        <div className="flex flex-wrap gap-3 rounded-[1.5rem] border border-border/70 bg-card/70 p-3">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'data', label: 'Data & Analysis' },
            { key: 'timeline', label: 'Timeline' },
            { key: 'files', label: `Files (${files.length})` },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                'rounded-2xl px-5 py-3 text-base font-semibold transition-all',
                activeTab === tab.key
                  ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white'
                  : 'text-slate-500 hover:-translate-y-0.5 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {renderDefaultTabContent()}
      </div>
    </div>
  );
}
