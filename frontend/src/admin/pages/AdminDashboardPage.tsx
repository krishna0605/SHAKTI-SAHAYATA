import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Link } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { adminPaths } from '../lib/paths'
import { formatNumber, normalizeStatusTone, titleCase } from '../lib/format'
import { OpsDataTable, OpsEntityChip, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge } from '../components/OpsPrimitives'

const compactPieColors = ['#5ea0ff', '#3a66d6', '#7694c2', '#3f4b61']

export default function AdminDashboardPage() {
  const observatoryQuery = useQuery({
    queryKey: ['admin-observatory'],
    queryFn: () => adminConsoleAPI.getObservatory(),
    refetchInterval: 30000,
  })
  const alertsQuery = useQuery({
    queryKey: ['admin-alerts'],
    queryFn: () => adminConsoleAPI.getAlerts(),
    refetchInterval: 30000,
  })
  const casesQuery = useQuery({
    queryKey: ['admin-dashboard-cases'],
    queryFn: () => adminConsoleAPI.getCases({ limit: 8 }),
    refetchInterval: 30000,
  })
  const filesQuery = useQuery({
    queryKey: ['admin-dashboard-files'],
    queryFn: () => adminConsoleAPI.getFiles({ limit: 8 }),
    refetchInterval: 30000,
  })
  const activityQuery = useQuery({
    queryKey: ['admin-dashboard-activity'],
    queryFn: () => adminConsoleAPI.getActivity({ limit: 12 }),
    refetchInterval: 30000,
  })
  const analysisQuery = useQuery({
    queryKey: ['admin-dashboard-analysis'],
    queryFn: () => adminConsoleAPI.getAnalysis(),
    refetchInterval: 30000,
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

  const suspiciousActivity = useMemo(
    () => (activityQuery.data?.items || []).filter((item) => /delete|export|lock|force|failed/i.test(`${item.action} ${JSON.stringify(item.details || {})}`)).slice(0, 6),
    [activityQuery.data?.items],
  )

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
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <OpsMetricTile label="Total Users" value={formatNumber((summary.activeOfficers || 0) + (summary.activeAdmins || 0))} detail="Distinct operators and administrators currently represented in live sessions." />
        <OpsMetricTile label="Active Users Today" value={formatNumber(summary.activeOfficerSessions + summary.activeAdminSessions)} detail="Current live session footprint across officer and admin consoles." tone="info" />
        <OpsMetricTile label="Total Cases" value={formatNumber(cases.totalCases)} detail={`${cases.lockedCases} evidence-locked investigations`} />
        <OpsMetricTile label="Uploads Today" value={formatNumber(summary.uploadsToday)} detail={`${files.failedParseFiles} parse failures need review`} tone={files.failedParseFiles > 0 ? 'warning' : 'success'} />
        <OpsMetricTile label="Running Jobs" value={formatNumber(analysisQuery.data.metrics.processing_jobs || 0)} detail={`${formatNumber(summary.failedJobs)} failed or quarantined jobs`} tone={summary.failedJobs > 0 ? 'warning' : 'success'} />
        <OpsMetricTile label="Failed Jobs" value={formatNumber(summary.failedJobs)} detail="Queued for retry, manual review, or parser correction." tone={summary.failedJobs > 0 ? 'danger' : 'success'} />
        <OpsMetricTile label="Storage Usage" value={formatNumber(files.totalFiles)} detail="Evidence uploads currently retained in platform storage." />
        <OpsMetricTile label="Database Health" value={titleCase(summary.databaseStatus)} detail={`${monitoring.backend.metric} backend health signal`} tone={normalizeStatusTone(summary.databaseStatus)} />
        <OpsMetricTile label="Unresolved Alerts" value={formatNumber(alertsQuery.data.summary.total - alertsQuery.data.summary.acknowledged)} detail={`${alertsQuery.data.summary.critical} critical issues remain open`} tone={alertsQuery.data.summary.critical > 0 ? 'danger' : 'warning'} />
        <OpsMetricTile label="Cases Created Today" value={formatNumber(cases.recentCases.length)} detail="Recent case movement visible in the observatory snapshot." />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-6">
          <div className="grid gap-6 xl:grid-cols-2">
            <OpsSection title="Case Creation Trend" description="Recent case activity and linked upload movement in the current visible window.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={caseTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="label" stroke="#77839a" tickLine={false} axisLine={false} />
                    <YAxis stroke="#77839a" tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Area type="monotone" dataKey="cases" stroke="#5ea0ff" fill="rgba(94,160,255,0.18)" />
                    <Area type="monotone" dataKey="uploads" stroke="#7fd0ff" fill="rgba(127,208,255,0.08)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </OpsSection>

            <OpsSection title="File Ingestion Status" description="Status distribution across the latest monitored uploads.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ingestionStatus}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis dataKey="label" stroke="#77839a" tickLine={false} axisLine={false} />
                    <YAxis stroke="#77839a" tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#5ea0ff" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </OpsSection>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <OpsSection title="Normalization Success vs Failure" description="Processing status derived from the current analysis module snapshot.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={normalizationSlices}
                      innerRadius={68}
                      outerRadius={92}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {normalizationSlices.map((slice, index) => (
                        <Cell key={slice.name} fill={compactPieColors[index % compactPieColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </OpsSection>

            <OpsSection title="Operator Activity" description="Top active investigators and technical operators in the current event window.">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={operatorActivity} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.14)" />
                    <XAxis type="number" stroke="#77839a" tickLine={false} axisLine={false} />
                    <YAxis dataKey="label" type="category" stroke="#77839a" width={110} tickLine={false} axisLine={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="#7fd0ff" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </OpsSection>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <OpsSection title="Recent Failed Uploads" description="Latest uploads with parsing or validation issues." action={<Link to={adminPaths.ingestion} className="text-sm text-blue-300 hover:underline">Open ingestion</Link>}>
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

            <OpsSection title="Recent Normalization Warnings" description="Modules with problematic jobs and incomplete standardization." action={<Link to={adminPaths.normalization} className="text-sm text-blue-300 hover:underline">Open processing</Link>}>
              <div className="space-y-3">
                {analysisQuery.data.modules.slice(0, 5).map((module) => (
                  <div key={module.module} className="ops-list-row">
                    <div>
                      <div className="font-medium">{titleCase(module.module)}</div>
                      <div className="text-sm text-muted-foreground">{formatNumber(module.total_rows)} rows observed</div>
                    </div>
                    <OpsStatusBadge label={`${formatNumber(module.problematic_jobs)} problematic`} tone={module.problematic_jobs > 0 ? 'warning' : 'success'} />
                  </div>
                ))}
              </div>
            </OpsSection>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <OpsSection title="Case Activity" description="Most recently updated investigations." action={<Link to={adminPaths.cases} className="text-sm text-blue-300 hover:underline">View all cases</Link>}>
              <OpsDataTable
                columns={[
                  { key: 'case', header: 'Case', render: (row) => <div><div className="font-medium">{row.case_name}</div><div className="text-xs font-mono text-muted-foreground">{row.case_number}</div></div> },
                  { key: 'priority', header: 'Priority', render: (row) => <OpsStatusBadge label={titleCase(row.priority)} tone={row.priority === 'critical' ? 'danger' : row.priority === 'high' ? 'warning' : 'neutral'} /> },
                  { key: 'updated', header: 'Updated', render: (row) => new Date(row.updated_at).toLocaleDateString() },
                ]}
                rows={cases.recentCases}
                rowKey={(row) => String(row.id)}
              />
            </OpsSection>

            <OpsSection title="Audit Spikes & Suspicious Activity" description="Events most likely to require supervision, review, or escalation." action={<Link to={adminPaths.audit} className="text-sm text-blue-300 hover:underline">Open audit trail</Link>}>
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
        </div>

        <div className="space-y-6">
          <OpsSection title="Critical Signals" description="Pinned issues for supervisors and platform operators.">
            <div className="space-y-3">
              {attention.slice(0, 6).map((item) => (
                <div key={item.id} className="ops-signal-card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-foreground">{item.title}</div>
                    <OpsStatusBadge label={item.severity} tone={normalizeStatusTone(item.severity)} />
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">{item.summary}</div>
                  <div className="mt-3">
                    <OpsEntityChip label="Open target" href={item.href} tone={normalizeStatusTone(item.severity)} />
                  </div>
                </div>
              ))}
            </div>
          </OpsSection>

          <OpsSection title="Service Health Summary" description="Compact health posture for core runtime layers.">
            <div className="space-y-3">
              {[monitoring.backend, monitoring.frontend, monitoring.api, monitoring.pipeline].map((item) => (
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

          <OpsSection title="Recent Critical Alerts" description="Newest alert conditions awaiting acknowledgement or remediation.">
            <div className="space-y-3">
              {alertsQuery.data.items.slice(0, 6).map((alert) => (
                <div key={alert.id} className="ops-list-row">
                  <div>
                    <div className="font-medium">{alert.title}</div>
                    <div className="text-sm text-muted-foreground">{alert.summary}</div>
                  </div>
                  <OpsStatusBadge label={titleCase(alert.severity)} tone={normalizeStatusTone(alert.severity)} />
                </div>
              ))}
            </div>
          </OpsSection>
        </div>
      </div>
    </div>
  )
}
