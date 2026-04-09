import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Link2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { formatNumber, formatTimestamp, normalizeStatusTone, titleCase } from '../lib/format'
import { adminPaths } from '../lib/paths'
import { OpsDefinitionList, OpsEntityChip, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge, OpsTimeline } from '../components/OpsPrimitives'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function AdminCaseDetailPage() {
  const { caseId } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')

  const detailQuery = useQuery({
    queryKey: ['ops-case-detail', caseId],
    queryFn: () => adminConsoleAPI.getCaseDetail(caseId as string),
    enabled: Boolean(caseId),
    refetchInterval: 30000,
  })

  const linkedEntities = useMemo(() => {
    const detail = detailQuery.data
    if (!detail) return []
    return detail.fileBreakdown.map((item) => ({
      id: item.module,
      title: titleCase(item.module),
      detail: `${formatNumber(item.records)} derived records • ${formatNumber(item.failedFiles)} problematic files`,
      meta: `${formatNumber(item.totalFiles)} uploads`,
      tone: item.failedFiles > 0 ? ('warning' as const) : ('info' as const),
    }))
  }, [detailQuery.data])

  if (detailQuery.isLoading) {
    return <div className="page-loading">Loading case detail...</div>
  }

  if (detailQuery.isError || !detailQuery.data) {
    return <OpsPageState title="Case detail unavailable" description="The selected case could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  const payload = detailQuery.data
  const caseItem = payload.case

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="ghost" className="rounded-xl" onClick={() => navigate(adminPaths.cases)}>
          <ArrowLeft className="h-4 w-4" />
          Back to Cases
        </Button>
        <OpsStatusBadge label={titleCase(caseItem.status)} tone={normalizeStatusTone(caseItem.status)} />
        <OpsStatusBadge label={titleCase(caseItem.priority)} tone={caseItem.priority === 'critical' ? 'danger' : caseItem.priority === 'high' ? 'warning' : 'neutral'} />
        {caseItem.is_evidence_locked ? <OpsStatusBadge label="Evidence Locked" tone="info" /> : null}
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <OpsMetricTile label="Uploads" value={formatNumber(payload.stats.fileCount)} detail={`${payload.stats.pendingFiles} pending`} />
        <OpsMetricTile label="Failed Uploads" value={formatNumber(payload.stats.failedParseFiles)} detail="Parsing or validation exceptions attached to the case." tone={payload.stats.failedParseFiles > 0 ? 'danger' : 'success'} />
        <OpsMetricTile label="Assignment Count" value={formatNumber(payload.stats.assignmentCount)} detail="Active investigator and supervisory ownership on the case." />
        <OpsMetricTile label="Recent Activity" value={formatNumber(payload.stats.recentActivityCount)} detail="Audit and admin events in the recent operational window." tone="info" />
        <OpsMetricTile label="Timeline Events" value={formatNumber(payload.timelineSummary.totalEvents)} detail={`${payload.timelineSummary.highRiskEvents} high-risk events`} tone={payload.timelineSummary.highRiskEvents > 0 ? 'warning' : 'success'} />
      </section>

      <div className="grid min-w-0 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <OpsSection title={caseItem.case_name} description={caseItem.description || 'Investigation detail workspace with uploads, processing, linked entities, and audit context.'}>
          <Tabs value={tab} onValueChange={setTab} className="space-y-5">
            <TabsList className="flex h-auto flex-wrap justify-start rounded-xl border border-border/70 bg-card/80 p-1">
              <TabsTrigger value="overview" className="rounded-lg px-3 py-2">Overview</TabsTrigger>
              <TabsTrigger value="uploads" className="rounded-lg px-3 py-2">Uploads</TabsTrigger>
              <TabsTrigger value="processing" className="rounded-lg px-3 py-2">Processing</TabsTrigger>
              <TabsTrigger value="statistics" className="rounded-lg px-3 py-2">Statistics</TabsTrigger>
              <TabsTrigger value="timeline" className="rounded-lg px-3 py-2">Timeline</TabsTrigger>
              <TabsTrigger value="entities" className="rounded-lg px-3 py-2">Linked Entities</TabsTrigger>
              <TabsTrigger value="notes" className="rounded-lg px-3 py-2">Notes / Comments</TabsTrigger>
              <TabsTrigger value="audit" className="rounded-lg px-3 py-2">Audit</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-5">
              <OpsDefinitionList
                items={[
                  { label: 'Case ID', value: caseItem.id },
                  { label: 'Case Number', value: caseItem.case_number },
                  { label: 'Case Type', value: caseItem.case_type || 'Not specified' },
                  { label: 'Assigned Officer', value: caseItem.owner_name || 'Unassigned' },
                  { label: 'Created By', value: caseItem.created_by_name || 'Unknown' },
                  { label: 'Department', value: caseItem.operator || 'Unassigned' },
                  { label: 'Start Date', value: caseItem.start_date || 'Not recorded' },
                  { label: 'Last Updated', value: formatTimestamp(caseItem.updated_at) },
                ]}
                monoKeys={['Case ID', 'Case Number']}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <div className="ops-subpanel">
                  <div className="ops-subpanel-title">Summary</div>
                  <p className="text-sm leading-6 text-muted-foreground">{caseItem.investigation_details || caseItem.description || 'No expanded case summary is available yet.'}</p>
                </div>
                <div className="ops-subpanel">
                  <div className="ops-subpanel-title">Tags & Controls</div>
                  <div className="flex flex-wrap gap-2">
                    <OpsStatusBadge label={caseItem.is_evidence_locked ? 'Evidence Lock Enabled' : 'Standard Handling'} tone={caseItem.is_evidence_locked ? 'warning' : 'success'} />
                    <OpsStatusBadge label={`${payload.stats.fileCount} uploads`} tone="info" />
                    <OpsStatusBadge label={`${payload.stats.assignmentCount} assignments`} tone="neutral" />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="uploads">
              <OpsSection title="Case Uploads" description="Evidence, source datasets, and supporting files attached to the investigation.">
                <div className="space-y-3">
                  {payload.recentFiles.map((file) => (
                    <div key={file.id} className="ops-list-row">
                      <div>
                        <div className="font-medium">{file.original_name || file.file_name}</div>
                        <div className="text-sm text-muted-foreground">{titleCase(file.telecom_module)} • {file.uploaded_by_name || 'Unknown uploader'} • {formatTimestamp(file.uploaded_at)}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <OpsStatusBadge label={titleCase(file.parse_status)} tone={normalizeStatusTone(file.parse_status)} />
                        <OpsStatusBadge label={formatNumber(file.record_count)} tone="info" />
                      </div>
                    </div>
                  ))}
                </div>
              </OpsSection>
            </TabsContent>

            <TabsContent value="processing">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {[
                  ['Uploaded', payload.stats.fileCount > 0],
                  ['Parsed', payload.stats.completedFiles > 0],
                  ['Validated', payload.stats.failedParseFiles === 0],
                  ['Normalized', payload.stats.completedFiles > 0],
                  ['Indexed', payload.stats.recentActivityCount > 0],
                  ['Analytics Generated', payload.timelineSummary.totalEvents > 0],
                ].map(([label, complete]) => (
                  <div key={String(label)} className="ops-stage-card">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
                    <div className="mt-2">
                      <OpsStatusBadge label={complete ? 'Ready' : 'Pending'} tone={complete ? 'success' : 'warning'} />
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="statistics">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <OpsMetricTile label="Parsed Rows" value={formatNumber(payload.fileBreakdown.reduce((sum, item) => sum + item.records, 0))} detail="Rows extracted across recent file breakdowns." />
                <OpsMetricTile label="Invalid Rows" value={formatNumber(payload.stats.failedParseFiles)} detail="Files or rows requiring correction." tone={payload.stats.failedParseFiles > 0 ? 'warning' : 'success'} />
                <OpsMetricTile label="Duplicate Count" value={formatNumber(Math.max(payload.timelineSummary.totalEvents - payload.stats.recentActivityCount, 0))} detail="Approximate repeated operational touches in the event stream." />
                <OpsMetricTile label="Low Confidence" value={formatNumber(payload.fileBreakdown.filter((item) => item.failedFiles > 0).length)} detail="Modules with incomplete normalization confidence." tone="warning" />
              </div>
            </TabsContent>

            <TabsContent value="timeline">
              <OpsTimeline
                items={payload.recentActivity.map((event) => ({
                  id: `${event.source}-${event.id}`,
                  title: titleCase(event.action),
                  detail: `${event.actor_name || 'Unknown actor'} • ${event.resource_type || 'system'} ${event.resource_id || ''}`,
                  meta: formatTimestamp(event.created_at),
                  tone: /delete|export|lock|force/i.test(event.action) ? 'warning' : 'info',
                }))}
              />
            </TabsContent>

            <TabsContent value="entities">
              <div className="grid gap-4 md:grid-cols-2">
                {linkedEntities.length ? linkedEntities.map((entity) => (
                  <div key={entity.id} className="ops-subpanel">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{entity.title}</div>
                      <OpsStatusBadge label={entity.meta || 'Observed'} tone={entity.tone || 'info'} />
                    </div>
                    <div className="mt-2 text-sm text-muted-foreground">{entity.detail}</div>
                  </div>
                )) : <OpsPageState title="No linked entities" description="Normalized entity links will appear here as uploads are processed." />}
              </div>
            </TabsContent>

            <TabsContent value="notes">
              <OpsPageState title="Notes workspace ready" description="Case notes and supervisory comments are intentionally scaffolded here for the next write-enabled phase." />
            </TabsContent>

            <TabsContent value="audit">
              <OpsTimeline
                items={payload.recentActivity.map((event) => ({
                  id: `audit-${event.id}`,
                  title: `${titleCase(event.source)} • ${titleCase(event.action)}`,
                  detail: JSON.stringify(event.details || {}),
                  meta: formatTimestamp(event.created_at),
                  tone: /delete|export|lock|force/i.test(event.action) ? 'warning' : 'neutral',
                }))}
              />
            </TabsContent>
          </Tabs>
        </OpsSection>

        <OpsSection title="Context Panel" description="Linked objects, quick actions, and supervisory context." className="self-start">
          <div className="space-y-5">
            <OpsDefinitionList
              items={[
                { label: 'Related Files', value: payload.stats.fileCount },
                { label: 'First Event', value: formatTimestamp(payload.timelineSummary.firstEventAt) },
                { label: 'Latest Event', value: formatTimestamp(payload.timelineSummary.lastEventAt) },
                { label: 'Admin Events', value: payload.timelineSummary.adminEvents },
              ]}
            />

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Linked Navigation</div>
              <div className="flex flex-wrap gap-2">
                <OpsEntityChip label="Open Ingestion Pipeline" href={adminPaths.ingestion} tone="info" />
                <OpsEntityChip label="Open Audit Trail" href={`${adminPaths.audit}?caseId=${caseItem.id}`} tone="warning" />
                <OpsEntityChip label="Open Alerts" href={adminPaths.alerts} tone="neutral" />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Top Actions</div>
              {payload.timelineSummary.topActions.length ? payload.timelineSummary.topActions.map((action) => (
                <div key={action.action} className="ops-list-row">
                  <div className="font-medium">{titleCase(action.action)}</div>
                  <OpsStatusBadge label={formatNumber(action.count)} tone="info" />
                </div>
              )) : <p className="text-sm text-muted-foreground">No high-level audit actions recorded yet.</p>}
            </div>

            <Button asChild className="w-full rounded-xl">
              <Link to={adminPaths.audit}>
                View audit evidence
                <Link2 className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </OpsSection>
      </div>
    </div>
  )
}
