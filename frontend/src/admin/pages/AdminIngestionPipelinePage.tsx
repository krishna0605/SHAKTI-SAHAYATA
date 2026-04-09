import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { adminConsoleAPI } from '../lib/api'
import { formatBytes, formatNumber, formatTimestamp, normalizeStatusTone, titleCase } from '../lib/format'
import { adminPaths } from '../lib/paths'
import { OpsDataTable, OpsDefinitionList, OpsEntityChip, OpsFilterBar, OpsInspector, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge } from '../components/OpsPrimitives'
import { Input } from '@/components/ui/input'

export default function AdminIngestionPipelinePage() {
  const [search, setSearch] = useState('')
  const [selectedUploadId, setSelectedUploadId] = useState<number | null>(null)

  const ingestionQuery = useQuery({
    queryKey: ['ops-ingestion', search],
    queryFn: () => adminConsoleAPI.getIngestionWorkspace({ q: search, limit: 50 }),
    refetchInterval: 30000,
  })

  const selectedRow = useMemo(
    () => ingestionQuery.data?.items.find((item) => item.uploadId === selectedUploadId) || ingestionQuery.data?.items[0] || null,
    [ingestionQuery.data?.items, selectedUploadId],
  )

  if (ingestionQuery.isLoading) {
    return <div className="page-loading">Loading ingestion pipeline...</div>
  }

  if (ingestionQuery.isError || !ingestionQuery.data) {
    return <OpsPageState title="Ingestion pipeline unavailable" description="Pipeline diagnostics could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  const { summary, charts, items } = ingestionQuery.data

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        <OpsMetricTile label="Files Uploaded Today" value={formatNumber(summary.filesUploadedToday)} detail="Uploads recorded in the current intake window." />
        <OpsMetricTile label="Pending Parsing" value={formatNumber(summary.pendingParsing)} detail="Awaiting parser allocation or queue release." tone="warning" />
        <OpsMetricTile label="Parsing In Progress" value={formatNumber(summary.parsingInProgress)} detail="Jobs currently inside parser execution." tone="info" />
        <OpsMetricTile label="Validation Failures" value={formatNumber(summary.validationFailures)} detail="Schema or field conformance issues detected." tone={summary.validationFailures > 0 ? 'danger' : 'success'} />
        <OpsMetricTile label="Normalization Queued" value={formatNumber(summary.normalizationQueued)} detail="Accepted uploads waiting for standardization." tone="warning" />
        <OpsMetricTile label="Successful Ingestions" value={formatNumber(summary.successfulIngestions)} detail="End-to-end accepted intake results." tone="success" />
        <OpsMetricTile label="Retried Jobs" value={formatNumber(summary.retriedJobs)} detail="Uploads that have already been retried at least once." tone={summary.retriedJobs > 0 ? 'info' : 'neutral'} />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <OpsSection title="Ingestion Queue" description="Uploaded datasets, parser output, validation state, normalization linkage, and error pressure across the intake pipeline.">
          <OpsFilterBar title="Queue Filters">
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search upload ID, file, case, checksum, uploader" className="w-[320px]" />
          </OpsFilterBar>
          <OpsDataTable
            columns={[
              { key: 'upload', header: 'Upload ID', render: (row) => <span className="font-mono text-xs">{row.uploadId}</span> },
              { key: 'file', header: 'File Name', render: (row) => <div><div className="font-medium">{row.fileName}</div><div className="text-xs text-muted-foreground">{row.fileType}</div></div> },
              { key: 'case', header: 'Case ID', render: (row) => row.caseNumber || row.caseId || 'Unlinked' },
              { key: 'source', header: 'Source', render: (row) => row.source },
              { key: 'uploadedBy', header: 'Uploaded By', render: (row) => row.uploadedBy || 'Unknown' },
              { key: 'uploadTime', header: 'Upload Time', render: (row) => formatTimestamp(row.uploadedAt) },
              { key: 'parse', header: 'Parse Status', render: (row) => <OpsStatusBadge label={titleCase(row.parseStatus)} tone={normalizeStatusTone(row.parseStatus)} /> },
              { key: 'validation', header: 'Validation', render: (row) => <OpsStatusBadge label={titleCase(row.validationStatus)} tone={normalizeStatusTone(row.validationStatus)} /> },
              { key: 'job', header: 'Normalization Job', render: (row) => row.normalizationJobId ? <span className="font-mono text-xs">{row.normalizationJobId.slice(0, 8)}</span> : 'Not linked' },
              { key: 'records', header: 'Extracted Records', render: (row) => formatNumber(row.extractedRecords) },
              { key: 'error', header: 'Error Summary', render: (row) => row.errorSummary || 'None' },
            ]}
            rows={items}
            rowKey={(row) => String(row.uploadId)}
            onRowClick={(row) => setSelectedUploadId(row.uploadId)}
          />
        </OpsSection>

        <OpsInspector title={selectedRow ? selectedRow.fileName : 'Upload diagnostics'} subtitle={selectedRow ? `Upload ${selectedRow.uploadId}` : 'Select an upload row'}>
          {selectedRow ? (
            <div className="space-y-5">
              <OpsDefinitionList
                items={[
                  { label: 'Uploader', value: selectedRow.uploadedBy || 'Unknown' },
                  { label: 'File Type', value: selectedRow.fileType },
                  { label: 'Upload Time', value: formatTimestamp(selectedRow.uploadedAt) },
                  { label: 'Size', value: formatBytes(selectedRow.sizeBytes) },
                  { label: 'Parser Version', value: selectedRow.parserVersion || 'Not recorded' },
                  { label: 'Normalizer Version', value: selectedRow.normalizerVersion || 'Not recorded' },
                  { label: 'Checksum', value: selectedRow.fileChecksum || 'Unavailable' },
                ]}
                monoKeys={['Checksum']}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <OpsMetricTile label="Warnings" value={formatNumber(selectedRow.warningCount)} detail="Field or validation anomalies." tone={selectedRow.warningCount > 0 ? 'warning' : 'success'} />
                <OpsMetricTile label="Retries" value={formatNumber(selectedRow.retryCount)} detail="Historical retry attempts attached to this upload." tone={selectedRow.retryCount > 0 ? 'info' : 'neutral'} />
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Linked Context</div>
                <div className="flex flex-wrap gap-2">
                  {selectedRow.caseId ? <OpsEntityChip label="Open linked case" href={adminPaths.caseDetail(selectedRow.caseId)} tone="info" /> : null}
                  {selectedRow.normalizationJobId ? <OpsEntityChip label="Open processing" href={`${adminPaths.normalization}?job=${selectedRow.normalizationJobId}`} tone="warning" /> : null}
                  <OpsEntityChip label="Open audit trail" href={`${adminPaths.audit}?uploadId=${selectedRow.uploadId}`} tone="neutral" />
                </div>
              </div>

              <div className="ops-subpanel">
                <div className="ops-subpanel-title">Failure Diagnostics</div>
                <p className="text-sm text-muted-foreground">{selectedRow.errorSummary || 'No active parser or validation failure is attached to this upload.'}</p>
              </div>
            </div>
          ) : (
            <OpsPageState title="No upload selected" description="Choose an upload row to inspect checksum, parser versions, retry history, and linked objects." />
          )}
        </OpsInspector>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <OpsSection title="Ingestion Throughput" description="Compact throughput samples derived from recent upload activity.">
          <div className="space-y-3">
            {charts.throughput.map((point) => (
              <div key={point.label} className="ops-list-row">
                <div className="font-medium">{point.label}</div>
                <OpsStatusBadge label={formatNumber(point.value)} tone="info" />
              </div>
            ))}
          </div>
        </OpsSection>

        <OpsSection title="File Type Distribution" description="Recent intake mix across telecom evidence formats.">
          <div className="space-y-3">
            {charts.byType.map((point) => (
              <div key={point.label} className="ops-list-row">
                <div className="font-medium">{point.label}</div>
                <OpsStatusBadge label={formatNumber(point.value)} tone="neutral" />
              </div>
            ))}
          </div>
        </OpsSection>

        <OpsSection title="Failure Rate by Source" description="Current failure pressure segmented by detected source type.">
          <div className="space-y-3">
            {charts.failureBySource.map((point) => (
              <div key={point.label} className="ops-list-row">
                <div className="font-medium">{point.label}</div>
                <OpsStatusBadge label={formatNumber(point.value)} tone={point.value > 0 ? 'warning' : 'success'} />
              </div>
            ))}
          </div>
        </OpsSection>
      </div>
    </div>
  )
}
