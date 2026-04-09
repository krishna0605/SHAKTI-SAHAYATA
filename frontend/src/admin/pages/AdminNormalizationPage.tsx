import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { adminConsoleAPI } from '../lib/api'
import { formatDurationSeconds, formatNumber, formatTimestamp, normalizeStatusTone, titleCase } from '../lib/format'
import { OpsDataTable, OpsDefinitionList, OpsFilterBar, OpsInspector, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge, OpsTimeline } from '../components/OpsPrimitives'
import { Input } from '@/components/ui/input'

export default function AdminNormalizationPage() {
  const [search, setSearch] = useState('')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const normalizationQuery = useQuery({
    queryKey: ['ops-normalization', search, selectedJobId],
    queryFn: () => adminConsoleAPI.getNormalizationWorkspace({ q: search, focusJobId: selectedJobId || undefined, limit: 40 }),
    refetchInterval: 30000,
  })

  const selectedJob = normalizationQuery.data?.selectedJob
  const selectedJobSummary = useMemo(
    () => normalizationQuery.data?.jobs.find((job) => job.jobId === selectedJobId) || normalizationQuery.data?.jobs[0] || null,
    [normalizationQuery.data?.jobs, selectedJobId],
  )

  if (normalizationQuery.isLoading) {
    return <div className="page-loading">Loading normalization workspace...</div>
  }

  if (normalizationQuery.isError || !normalizationQuery.data) {
    return <OpsPageState title="Normalization workspace unavailable" description="Processing queue data could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  const { summary, jobs } = normalizationQuery.data

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        <OpsMetricTile label="Jobs Running" value={formatNumber(summary.jobsRunning)} detail="Currently executing standardization jobs." tone="info" />
        <OpsMetricTile label="Jobs Completed" value={formatNumber(summary.jobsCompleted)} detail="Successful runs across the monitored queue." tone="success" />
        <OpsMetricTile label="Jobs Failed" value={formatNumber(summary.jobsFailed)} detail="Requires retry or manual inspection." tone={summary.jobsFailed > 0 ? 'danger' : 'success'} />
        <OpsMetricTile label="Average Job Duration" value={formatDurationSeconds(summary.averageDurationSeconds)} detail="Mean execution time for recent jobs." />
        <OpsMetricTile label="Low Confidence Jobs" value={formatNumber(summary.lowConfidenceJobs)} detail="Outputs needing analyst confirmation." tone={summary.lowConfidenceJobs > 0 ? 'warning' : 'success'} />
        <OpsMetricTile label="Unmapped Fields" value={formatNumber(summary.unmappedFieldCount)} detail="Raw headers not safely mapped into the standard schema." tone={summary.unmappedFieldCount > 0 ? 'warning' : 'success'} />
        <OpsMetricTile label="Model Version" value={summary.modelVersion} detail="Current rules or model baseline in use." tone="info" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <OpsSection title="Processing Queue" description="Normalization job queue with confidence, warning counts, and operational timing." className="min-w-0">
          <OpsFilterBar title="Queue Filters">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search job, case, upload, document type" className="w-[320px]" />
          </OpsFilterBar>

          <OpsDataTable
            columns={[
              { key: 'job', header: 'Job ID', render: (row) => <span className="font-mono text-xs">{row.jobId.slice(0, 8)}</span> },
              { key: 'case', header: 'Case ID', render: (row) => row.caseId },
              { key: 'upload', header: 'Upload ID', render: (row) => row.uploadId || 'Unknown' },
              { key: 'type', header: 'Document Type', render: (row) => titleCase(row.documentType) },
              { key: 'version', header: 'Model / Rules Version', render: (row) => row.modelVersion },
              { key: 'started', header: 'Started', render: (row) => formatTimestamp(row.startedAt) },
              { key: 'duration', header: 'Duration', render: (row) => formatDurationSeconds(row.durationSeconds) },
              { key: 'status', header: 'Status', render: (row) => <OpsStatusBadge label={titleCase(row.status)} tone={normalizeStatusTone(row.status)} /> },
              { key: 'confidence', header: 'Confidence Score', render: (row) => `${Math.round(row.confidenceScore * 100)}%` },
              { key: 'warnings', header: 'Warning Count', render: (row) => formatNumber(row.warningCount) },
              { key: 'errors', header: 'Error Count', render: (row) => formatNumber(row.errorCount) },
            ]}
            rows={jobs}
            rowKey={(row) => row.jobId}
            onRowClick={(row) => setSelectedJobId(row.jobId)}
          />
        </OpsSection>

        <OpsInspector title={selectedJobSummary ? `Job ${selectedJobSummary.jobId.slice(0, 8)}` : 'Job detail'} subtitle={selectedJobSummary ? titleCase(selectedJobSummary.documentType) : 'Select a processing job'}>
          {selectedJobSummary ? (
            <div className="space-y-5">
              <OpsDefinitionList
                items={[
                  { label: 'Case', value: selectedJobSummary.caseName || selectedJobSummary.caseId },
                  { label: 'Upload', value: selectedJobSummary.uploadId || 'Unknown' },
                  { label: 'Started', value: formatTimestamp(selectedJobSummary.startedAt) },
                  { label: 'Completed', value: formatTimestamp(selectedJobSummary.completedAt) },
                  { label: 'Rows', value: formatNumber(selectedJobSummary.totalRows) },
                  { label: 'Rejected', value: formatNumber(selectedJobSummary.rejectedRows) },
                ]}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <OpsMetricTile label="Confidence" value={`${Math.round(selectedJobSummary.confidenceScore * 100)}%`} detail="Overall mapping confidence." tone={selectedJobSummary.confidenceScore < 0.75 ? 'warning' : 'success'} />
                <OpsMetricTile label="Warnings" value={formatNumber(selectedJobSummary.warningCount)} detail="Field-level warnings and transforms." tone={selectedJobSummary.warningCount > 0 ? 'warning' : 'success'} />
              </div>
              <div className="ops-subpanel">
                <div className="ops-subpanel-title">Error Summary</div>
                <p className="text-sm text-muted-foreground">{selectedJobSummary.errorMessage || 'No critical transformation error is attached to this job.'}</p>
              </div>
            </div>
          ) : (
            <OpsPageState title="No job selected" description="Choose a job row to inspect mapping confidence, stage detail, and output readiness." />
          )}
        </OpsInspector>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <OpsSection title="Raw vs Standardized Mapping Viewer" description="Human-reviewable mapping logic from raw fields into the controlled investigation schema.">
          {selectedJob ? (
            <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr_1fr]">
              <div className="ops-subpanel">
                <div className="ops-subpanel-title">Raw Input Fields</div>
                <div className="space-y-3">
                  {selectedJob.mapping.map((field) => (
                    <div key={`raw-${field.rawField}`} className="rounded-xl border border-border/60 bg-background/40 px-3 py-3">
                      <div className="font-mono text-xs text-slate-300">{field.rawField}</div>
                      <div className="mt-2 text-sm text-muted-foreground">{field.sampleValue || 'No sample value'}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ops-subpanel">
                <div className="ops-subpanel-title">Mapping Logic</div>
                <div className="space-y-3">
                  {selectedJob.mapping.map((field) => (
                    <div key={`map-${field.rawField}`} className="rounded-xl border border-border/60 bg-background/40 px-3 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-medium">{field.transform}</div>
                        <OpsStatusBadge label={`${Math.round(field.confidence * 100)}%`} tone={field.tone} />
                      </div>
                      <div className="mt-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{field.standardizedField}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="ops-subpanel">
                <div className="ops-subpanel-title">Standardized Output</div>
                <div className="space-y-3">
                  {selectedJob.mapping.map((field) => (
                    <div key={`std-${field.standardizedField}`} className="rounded-xl border border-border/60 bg-background/40 px-3 py-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{field.standardizedField}</div>
                      <div className="mt-2 text-sm text-foreground">{field.sampleValue || 'Pending mapped value'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <OpsPageState title="Mapping viewer awaiting selection" description="Select a normalization job from the queue to inspect raw headers, transforms, and standardized output." />
          )}
        </OpsSection>

        <div className="space-y-6">
          <OpsSection title="Normalization Timeline" description="Stage-by-stage operational progression for the selected job.">
            {selectedJob ? <OpsTimeline items={selectedJob.stageTimeline} /> : <OpsPageState title="No timeline available" description="Select a job to reveal uploaded, parsed, validated, normalized, and downstream stages." />}
          </OpsSection>

          <OpsSection title="Conformity & Anomalies" description="Schema health, low-confidence fields, and downstream readiness.">
            {selectedJob ? (
              <div className="space-y-4">
                <div className="space-y-3">
                  {selectedJob.schemaConformity.map((item) => (
                    <div key={item.label} className="ops-list-row">
                      <div className="font-medium">{item.label}</div>
                      <OpsStatusBadge label={item.value} tone={normalizeStatusTone(item.value)} />
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  {selectedJob.anomalies.map((item) => (
                    <div key={item.label} className="ops-list-row">
                      <div className="font-medium">{item.label}</div>
                      <span className="text-sm text-muted-foreground">{item.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <OpsPageState title="No selected job" description="Conformity and anomaly indicators appear here once a queue row is selected." />
            )}
          </OpsSection>
        </div>
      </div>
    </div>
  )
}
