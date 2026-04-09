import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { adminPaths } from '../lib/paths'
import { formatNumber, normalizeStatusTone, titleCase } from '../lib/format'
import { OpsDataTable, OpsEntityChip, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge, OpsSummaryStrip } from '../components/OpsPrimitives'
import { useAdminLiveUpdates } from '../components/AdminLiveUpdatesProvider'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const chartColors = ['#8ab4ff', '#5f89ff', '#6f7a90', '#394255']

export default function AdminDashboardPage() {
  const { isConnected } = useAdminLiveUpdates()
  const observatoryQuery = useQuery({
    queryKey: ['admin-observatory'],
    queryFn: () => adminConsoleAPI.getObservatory(),
    refetchInterval: isConnected ? false : 30000,
  })
  const alertsQuery = useQuery({
    queryKey: ['admin-alerts'],
    queryFn: () => adminConsoleAPI.getAlerts(),
    refetchInterval: isConnected ? false : 30000,
  })
  const casesQuery = useQuery({
    queryKey: ['admin-dashboard-cases'],
    queryFn: () => adminConsoleAPI.getCases({ limit: 8 }),
    refetchInterval: isConnected ? false : 30000,
  })
  const filesQuery = useQuery({
    queryKey: ['admin-dashboard-files'],
    queryFn: () => adminConsoleAPI.getFiles({ limit: 8 }),
    refetchInterval: isConnected ? false : 30000,
  })
  const activityQuery = useQuery({
    queryKey: ['admin-dashboard-activity'],
    queryFn: () => adminConsoleAPI.getActivity({ limit: 12 }),
    refetchInterval: isConnected ? false : 30000,
  })
  const analysisQuery = useQuery({
    queryKey: ['admin-dashboard-analysis'],
    queryFn: () => adminConsoleAPI.getAnalysis(),
    refetchInterval: isConnected ? false : 30000,
  })

  const isLoading = observatoryQuery.isLoading || alertsQuery.isLoading || casesQuery.isLoading || filesQuery.isLoading || activityQuery.isLoading || analysisQuery.isLoading
  const isError = observatoryQuery.isError || alertsQuery.isError || casesQuery.isError || filesQuery.isError || activityQuery.isError || analysisQuery.isError

  const caseTrend = useMemo(() => {
    const items = casesQuery.data?.items || []
    return items
      .slice()
      .reverse()
      .map((item, index) => ({
        label: `C-${index + 1}`,
        cases: index + 1,
        uploads: item.file_count,
      }))
  }, [casesQuery.data?.items])

  const ingestionStatus = useMemo(() => {
    const items = filesQuery.data?.items || []
    const statuses = new Map<string, number>()
    items.forEach((item) => statuses.set(item.parse_status, (statuses.get(item.parse_status) || 0) + 1))
    return Array.from(statuses.entries()).map(([label, value]) => ({ label: titleCase(label), value }))
  }, [filesQuery.data?.items])

  const suspiciousActivity = useMemo(
    () => (activityQuery.data?.items || []).filter((item) => /delete|export|lock|force|failed/i.test(`${item.action} ${JSON.stringify(item.details || {})}`)).slice(0, 6),
    [activityQuery.data?.items],
  )

  const operatorActivity = useMemo(() => {
    const counts = new Map<string, number>()
    for (const event of activityQuery.data?.items || []) {
      const actor = event.actor_name || 'Unknown'
      counts.set(actor, (counts.get(actor) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 6)
  }, [activityQuery.data?.items])

  const normalizationSlices = [
    { name: 'Completed', value: analysisQuery.data?.metrics.completed_jobs || 0 },
    { name: 'Processing', value: analysisQuery.data?.metrics.processing_jobs || 0 },
    { name: 'Queued', value: analysisQuery.data?.metrics.queued_jobs || 0 },
    { name: 'Failed', value: analysisQuery.data?.metrics.failed_jobs || 0 },
  ]

  if (isLoading) {
    return <div className="page-loading">Loading dashboard...</div>
  }

  if (isError || !observatoryQuery.data || !alertsQuery.data || !casesQuery.data || !filesQuery.data || !activityQuery.data || !analysisQuery.data) {
    return (
      <OpsPageState
        title="Dashboard unavailable"
        description="The console could not load one or more operational feeds. Review admin connectivity, alert services, and observatory health."
        icon={<AlertTriangle className="h-7 w-7" />}
      />
    )
  }

  const { summary, attention, monitoring, cases, files } = observatoryQuery.data

  return (
    <div className="min-w-0 space-y-5">
      <OpsSummaryStrip>
        <OpsMetricTile label="Active Cases" value={formatNumber(cases.totalCases)} detail={`${cases.lockedCases} evidence locked`} />
        <OpsMetricTile label="Upload Failures" value={formatNumber(files.failedParseFiles)} detail="Files awaiting review or retry." tone={files.failedParseFiles > 0 ? 'warning' : 'success'} />
        <OpsMetricTile label="Running Jobs" value={formatNumber(analysisQuery.data.metrics.processing_jobs || 0)} detail={`${formatNumber(summary.failedJobs)} failed jobs`} tone={summary.failedJobs > 0 ? 'warning' : 'info'} />
        <OpsMetricTile label="Open Alerts" value={formatNumber(alertsQuery.data.summary.total - alertsQuery.data.summary.acknowledged)} detail={`${alertsQuery.data.summary.critical} critical`} tone={alertsQuery.data.summary.critical > 0 ? 'danger' : 'warning'} />
        <OpsMetricTile label="Active Users" value={formatNumber(summary.activeOfficerSessions + summary.activeAdminSessions)} detail="Current live session footprint." tone="info" />
      </OpsSummaryStrip>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[1.35fr_0.65fr]">
        <OpsSection title="Operational feed" description="Recent operator activity, audit events, and system actions in one scan-first table.">
          <OpsDataTable
            columns={[
              { key: 'timestamp', header: 'Timestamp', render: (row) => <span className="font-mono text-xs">{new Date(row.created_at).toLocaleString()}</span> },
              { key: 'actor', header: 'Actor', render: (row) => row.actor_name || 'Unknown actor' },
              { key: 'action', header: 'Action', render: (row) => titleCase(row.action) },
              { key: 'entity', header: 'Entity', render: (row) => row.resource_type ? `${row.resource_type}:${row.resource_id || 'unknown'}` : 'system' },
              { key: 'severity', header: 'Severity', render: (row) => <OpsStatusBadge label={/delete|export|lock|force|failed/i.test(row.action) ? 'Review' : 'Info'} tone={/delete|export|lock|force|failed/i.test(row.action) ? 'warning' : 'info'} /> },
            ]}
            rows={activityQuery.data.items}
            rowKey={(row) => `${row.source}-${row.id}`}
          />
        </OpsSection>

        <div className="min-w-0 space-y-5">
          <OpsSection title="Attention list" description="Critical alerts and review-worthy signals.">
            <div className="space-y-3">
              {attention.slice(0, 5).map((item) => (
                <div key={item.id} className="ops-list-row">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-100">{item.title}</div>
                    <div className="text-sm text-muted-foreground">{item.summary}</div>
                  </div>
                  <OpsEntityChip label="Open" href={item.href} tone={normalizeStatusTone(item.severity)} />
                </div>
              ))}
            </div>
          </OpsSection>

          <OpsSection title="Service posture" description="Only the core signals needed for quick backend scanning.">
            <div className="space-y-3">
              {[monitoring.backend, monitoring.api, monitoring.pipeline].map((item) => (
                <div key={item.label} className="ops-list-row">
                  <div>
                    <div className="font-medium">{item.label}</div>
                    <div className="text-sm text-muted-foreground">{item.detail}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <OpsStatusBadge label={titleCase(item.status)} tone={normalizeStatusTone(item.status)} />
                    <span className="text-xs font-mono text-muted-foreground">{item.metric}</span>
                  </div>
                </div>
              ))}
            </div>
          </OpsSection>
        </div>
      </div>

      <Tabs defaultValue="throughput" className="min-w-0 space-y-4">
        <TabsList className="inline-flex h-auto w-auto flex-wrap justify-start rounded-lg border border-white/8 bg-[#0f1218] p-1">
          <TabsTrigger value="throughput" className="rounded-md px-3 py-2">Throughput</TabsTrigger>
          <TabsTrigger value="failures" className="rounded-md px-3 py-2">Failures</TabsTrigger>
          <TabsTrigger value="usage" className="rounded-md px-3 py-2">Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="throughput" className="min-w-0">
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <OpsSection title="Case throughput" description="Recent case activity and linked upload movement.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={caseTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis dataKey="label" stroke="#6b7280" tickLine={false} axisLine={false} />
                    <YAxis stroke="#6b7280" tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="cases" stroke="#8ab4ff" fill="rgba(138,180,255,0.16)" />
                    <Area type="monotone" dataKey="uploads" stroke="#5f89ff" fill="rgba(95,137,255,0.08)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </OpsSection>

            <OpsSection title="Ingestion status" description="Distribution across the latest monitored uploads.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ingestionStatus}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis dataKey="label" stroke="#6b7280" tickLine={false} axisLine={false} />
                    <YAxis stroke="#6b7280" tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#8ab4ff" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </OpsSection>
          </div>
        </TabsContent>

        <TabsContent value="failures" className="min-w-0">
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <OpsSection title="Recent failed uploads" description="Latest uploads with parsing or validation issues." action={<Link to={adminPaths.ingestion} className="text-sm text-blue-300 hover:underline">Open ingestion</Link>}>
              <OpsDataTable
                columns={[
                  { key: 'file', header: 'File', render: (row) => <div><div className="font-medium">{row.original_name || row.file_name}</div><div className="text-xs text-muted-foreground">{row.case_name || 'Unlinked case'}</div></div> },
                  { key: 'status', header: 'Status', render: (row) => <OpsStatusBadge label={titleCase(row.parse_status)} tone={normalizeStatusTone(row.parse_status)} /> },
                  { key: 'records', header: 'Records', render: (row) => formatNumber(row.record_count) },
                ]}
                rows={filesQuery.data.items.filter((item) => item.parse_status === 'failed').slice(0, 5)}
                rowKey={(row) => String(row.id)}
                emptyTitle="No failed uploads"
                emptyDescription="Recent upload failures will surface here for triage."
              />
            </OpsSection>

            <OpsSection title="Review-worthy activity" description="Events most likely to require supervision or escalation." action={<Link to={adminPaths.audit} className="text-sm text-blue-300 hover:underline">Open audit trail</Link>}>
              <div className="space-y-3">
                {suspiciousActivity.length ? (
                  suspiciousActivity.map((item) => (
                    <div key={`${item.source}-${item.id}`} className="ops-list-row">
                      <div>
                        <div className="font-medium">{titleCase(item.action)}</div>
                        <div className="text-sm text-muted-foreground">{item.actor_name || 'Unknown actor'} • {item.resource_type || 'system'}</div>
                      </div>
                      <OpsStatusBadge label={item.source} tone={item.source === 'admin' ? 'info' : 'warning'} />
                    </div>
                  ))
                ) : (
                  <OpsPageState title="No suspicious spikes" description="Deletion, export, lock, or forced-session events will appear here when elevated." />
                )}
              </div>
            </OpsSection>
          </div>
        </TabsContent>

        <TabsContent value="usage" className="min-w-0">
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <OpsSection title="Normalization distribution" description="Compact job status distribution across the current analysis snapshot.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={normalizationSlices} innerRadius={60} outerRadius={88} paddingAngle={4} dataKey="value">
                      {normalizationSlices.map((slice, index) => (
                        <Cell key={slice.name} fill={chartColors[index % chartColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </OpsSection>

            <OpsSection title="Top active operators" description="Highest event activity in the current window.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={operatorActivity} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
                    <XAxis type="number" stroke="#6b7280" tickLine={false} axisLine={false} />
                    <YAxis dataKey="label" type="category" stroke="#6b7280" width={110} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#8ab4ff" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </OpsSection>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
