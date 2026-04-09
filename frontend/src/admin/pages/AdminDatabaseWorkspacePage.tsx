import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Maximize2, Search, ShieldAlert } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { formatBytes, formatNumber, formatTimestamp, normalizeStatusTone, titleCase } from '../lib/format'
import { adminPaths } from '../lib/paths'
import {
  OpsDataTable,
  OpsDefinitionList,
  OpsDrawerInspector,
  OpsEntityChip,
  OpsPageState,
  OpsSection,
  OpsStatusBadge,
  OpsSummaryStrip,
  OpsToolbar,
  OpsMetricTile,
} from '../components/OpsPrimitives'
import AdminSchemaVisualizer from '../components/AdminSchemaVisualizer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function AdminDatabaseWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'schema'
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [schemaSearch, setSchemaSearch] = useState('')
  const [schemaFitTick, setSchemaFitTick] = useState(0)
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null)
  const [selectedServiceLabel, setSelectedServiceLabel] = useState<string | null>(null)
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)

  const schemaQuery = useQuery({
    queryKey: ['ops-database-schema'],
    queryFn: () => adminConsoleAPI.getDatabaseSchema(),
    refetchInterval: 60000,
  })
  const tableQuery = useQuery({
    queryKey: ['ops-database-table', selectedTable],
    queryFn: () => adminConsoleAPI.getDatabaseTable(selectedTable as string),
    enabled: Boolean(selectedTable),
  })
  const storageQuery = useQuery({
    queryKey: ['ops-storage-workspace'],
    queryFn: () => adminConsoleAPI.getStorageWorkspace({ limit: 30 }),
    refetchInterval: 30000,
  })
  const healthQuery = useQuery({
    queryKey: ['ops-observability'],
    queryFn: () => adminConsoleAPI.getSystemHealth(),
    refetchInterval: 30000,
  })
  const logsQuery = useQuery({
    queryKey: ['ops-logs'],
    queryFn: () => adminConsoleAPI.getActivity({ limit: 40 }),
    refetchInterval: 15000,
  })

  const serviceRows = useMemo(() => {
    if (!healthQuery.data) return []
    const payload = healthQuery.data
    return [
      { label: 'Backend API', status: payload.backend.ready.status, metric: `${payload.database.latencyMs || 0} ms`, detail: payload.backend.ready.summary?.failed?.join(', ') || 'Readiness checks available' },
      { label: 'Worker', status: payload.retention.running ? 'running' : 'ready', metric: `${payload.retention.policies.intervalMinutes} min`, detail: payload.retention.lastError || 'Retention and maintenance worker status.' },
      { label: 'Parser Service', status: payload.uploads.writable ? 'ready' : 'degraded', metric: `${payload.uploads.topLevelFileCount || 0} files`, detail: payload.uploads.detail },
      { label: 'Normalization Service', status: payload.backend.ready.status, metric: `${payload.selfChecks.length} checks`, detail: 'Normalization queue shares backend runtime health.' },
      { label: 'Postgres', status: payload.database.status, metric: `${payload.database.pool?.totalCount || 0} conns`, detail: payload.database.detail },
      { label: 'Queue / Cache', status: payload.retention.running ? 'degraded' : 'ready', metric: `${payload.retention.lastResult?.deletedSessions || 0}`, detail: 'Queue/cache proxy is represented through retention and session cleanup signals.' },
      { label: 'Storage Service', status: payload.uploads.status, metric: payload.uploads.path || 'uploads/', detail: 'Disk-backed evidence storage path health.' },
    ]
  }, [healthQuery.data])

  const selectedAsset = storageQuery.data?.items.find((item) => item.fileId === selectedAssetId) || null
  const selectedService = serviceRows.find((service) => service.label === selectedServiceLabel) || null
  const selectedLog = logsQuery.data?.items.find((item) => `${item.source}-${item.id}` === selectedLogId) || null

  const filteredSchema = useMemo(() => {
    if (!schemaQuery.data) return null
    const q = schemaSearch.trim().toLowerCase()
    if (!q) return schemaQuery.data

    const visibleNames = new Set(
      schemaQuery.data.tables
        .filter((table) => `${table.name} ${table.group} ${table.type}`.toLowerCase().includes(q))
        .map((table) => table.name),
    )

    return {
      ...schemaQuery.data,
      tables: schemaQuery.data.tables.filter((table) => visibleNames.has(table.name)),
      relationships: schemaQuery.data.relationships.filter((relationship) => visibleNames.has(relationship.sourceTable) && visibleNames.has(relationship.targetTable)),
      summary: {
        ...schemaQuery.data.summary,
        tableCount: visibleNames.size,
        relationshipCount: schemaQuery.data.relationships.filter((relationship) => visibleNames.has(relationship.sourceTable) && visibleNames.has(relationship.targetTable)).length,
      },
    }
  }, [schemaQuery.data, schemaSearch])

  if (schemaQuery.isLoading || storageQuery.isLoading || healthQuery.isLoading || logsQuery.isLoading) {
    return <div className="page-loading">Loading database workspace...</div>
  }

  if (schemaQuery.isError || storageQuery.isError || healthQuery.isError || logsQuery.isError || !schemaQuery.data || !storageQuery.data || !healthQuery.data || !logsQuery.data || !filteredSchema) {
    return <OpsPageState title="Database workspace unavailable" description="One or more database workspace services could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  return (
    <div className="min-w-0 space-y-5">
      <OpsSummaryStrip className="xl:grid-cols-4">
        <OpsMetricTile label="Visible Tables" value={formatNumber(schemaQuery.data.summary.tableCount)} detail="Governed schema catalog." />
        <OpsMetricTile label="Storage Used" value={formatBytes(storageQuery.data.summary.totalStorageBytes)} detail="Current evidence footprint." />
        <OpsMetricTile label="Service Warnings" value={formatNumber(serviceRows.filter((service) => ['warning', 'degraded'].includes(service.status)).length)} detail="Backend and database-adjacent services requiring attention." tone="warning" />
        <OpsMetricTile label="Recent Log Events" value={formatNumber(logsQuery.data.items.length)} detail="Latest technical and operational events." tone="info" />
      </OpsSummaryStrip>

      <Tabs value={activeTab} onValueChange={(value: string) => setSearchParams({ tab: value })} className="min-w-0 space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start rounded-lg border border-white/8 bg-[#0f1218] p-1">
          <TabsTrigger value="schema" className="rounded-md px-3 py-2">Schema Visualizer</TabsTrigger>
          <TabsTrigger value="storage" className="rounded-md px-3 py-2">Storage</TabsTrigger>
          <TabsTrigger value="observability" className="rounded-md px-3 py-2">Observability</TabsTrigger>
          <TabsTrigger value="logs" className="rounded-md px-3 py-2">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="schema" className="space-y-4">
          <OpsToolbar
            title="Schema controls"
            actions={
              <Button type="button" variant="outline" className="rounded-lg" onClick={() => setSchemaFitTick((tick) => tick + 1)}>
                <Maximize2 className="h-4 w-4" />
                Fit canvas
              </Button>
            }
          >
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={schemaSearch}
                onChange={(event) => setSchemaSearch(event.target.value)}
                placeholder="Search tables"
                className="h-9 rounded-lg border-white/10 bg-white/[0.03] pl-9"
              />
            </div>
            <OpsStatusBadge label={`${formatNumber(filteredSchema.summary.tableCount)} shown`} tone="info" />
            {selectedTable ? <OpsStatusBadge label={`selected ${selectedTable}`} tone="neutral" /> : null}
          </OpsToolbar>

          <OpsSection title="Schema canvas" description="Visual table relationships with selection-driven metadata and editor drill-in.">
            <AdminSchemaVisualizer
              schema={filteredSchema}
              selectedTable={selectedTable}
              onSelectTable={(tableName) => setSelectedTable(tableName)}
              fitTrigger={schemaFitTick}
            />
          </OpsSection>

          <OpsDrawerInspector
            open={Boolean(selectedTable)}
            onOpenChange={(open) => {
              if (!open) setSelectedTable(null)
            }}
            title={selectedTable || 'Table inspector'}
            subtitle="Columns, keys, relations, and editor entry points"
          >
            {tableQuery.data ? (
              <div className="space-y-5">
                <OpsDefinitionList
                  items={[
                    { label: 'Schema', value: tableQuery.data.table.schema },
                    { label: 'Type', value: titleCase(tableQuery.data.table.type) },
                    { label: 'Row Count', value: formatNumber(tableQuery.data.table.estimatedRowCount) },
                    { label: 'Size', value: tableQuery.data.table.totalBytesLabel },
                    { label: 'Last Migration', value: formatTimestamp(tableQuery.data.table.lastAnalyzedAt) },
                  ]}
                />
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Columns</div>
                  <div className="space-y-2">
                    {tableQuery.data.columns.map((column) => (
                      <div key={column.name} className="ops-list-row">
                        <div>
                          <div className="font-medium">{column.name}</div>
                          <div className="text-xs text-muted-foreground">{column.databaseType}</div>
                        </div>
                        <OpsStatusBadge label={column.isPrimaryKey ? 'PK' : column.isNullable ? 'Nullable' : 'Required'} tone={column.isPrimaryKey ? 'info' : column.isNullable ? 'neutral' : 'success'} />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <OpsEntityChip label="Open in Table Editor" href={`${adminPaths.tableEditor}?table=${selectedTable}`} tone="info" />
                </div>
              </div>
            ) : (
              <OpsPageState title="No table metadata" description="Select a table node to inspect schema detail." />
            )}
          </OpsDrawerInspector>
        </TabsContent>

        <TabsContent value="storage" className="space-y-4">
          <OpsToolbar title="Storage filters">
            <Input placeholder="Search file, case, uploader, hash" className="h-9 max-w-sm rounded-lg border-white/10 bg-white/[0.03]" />
            <OpsStatusBadge label={`${formatNumber(storageQuery.data.summary.orphanedFiles)} orphaned`} tone={storageQuery.data.summary.orphanedFiles > 0 ? 'warning' : 'success'} />
            <OpsStatusBadge label={`${formatNumber(storageQuery.data.summary.flaggedFiles)} flagged`} tone={storageQuery.data.summary.flaggedFiles > 0 ? 'danger' : 'neutral'} />
          </OpsToolbar>

          <OpsSection title="Evidence storage" description="Evidence asset registry with retention, integrity, and linkage context.">
            <OpsDataTable
              columns={[
                { key: 'file', header: 'File Name', render: (row) => <div><div className="font-medium">{row.fileName}</div><div className="text-xs text-muted-foreground">{row.fileType}</div></div> },
                { key: 'case', header: 'Linked Case', render: (row) => row.linkedCaseNumber || row.linkedCaseId || 'Unlinked' },
                { key: 'size', header: 'Size', render: (row) => formatBytes(row.sizeBytes) },
                { key: 'uploadedBy', header: 'Uploaded By', render: (row) => row.uploadedBy || 'Unknown' },
                { key: 'integrity', header: 'Integrity', render: (row) => <OpsStatusBadge label={row.integrityStatus} tone={normalizeStatusTone(row.integrityStatus)} /> },
                { key: 'retention', header: 'Retention', render: (row) => <OpsStatusBadge label={row.retentionStatus} tone="info" /> },
              ]}
              rows={storageQuery.data.items}
              rowKey={(row) => String(row.fileId)}
              onRowClick={(row) => setSelectedAssetId(row.fileId)}
            />
          </OpsSection>

          <OpsDrawerInspector
            open={Boolean(selectedAsset)}
            onOpenChange={(open) => {
              if (!open) setSelectedAssetId(null)
            }}
            title={selectedAsset?.fileName || 'Asset inspector'}
            subtitle="Retention, integrity, case linkage, and metadata"
          >
            {selectedAsset ? (
              <div className="space-y-5">
                <OpsDefinitionList
                  items={[
                    { label: 'File ID', value: selectedAsset.fileId },
                    { label: 'Case', value: selectedAsset.linkedCaseNumber || selectedAsset.linkedCaseName || 'Unlinked' },
                    { label: 'Uploaded At', value: formatTimestamp(selectedAsset.uploadedAt) },
                    { label: 'Checksum', value: selectedAsset.checksum || 'Unavailable' },
                    { label: 'Storage Path', value: selectedAsset.storagePath || 'Unavailable' },
                    { label: 'Linked Job', value: selectedAsset.linkedJobId || 'Not linked' },
                  ]}
                  monoKeys={['Checksum', 'Storage Path', 'Linked Job']}
                />
                <div className="flex flex-wrap gap-2">
                  <OpsStatusBadge label={selectedAsset.legalHold ? 'Legal Hold' : 'Standard Retention'} tone={selectedAsset.legalHold ? 'warning' : 'info'} />
                  <OpsStatusBadge label={selectedAsset.quarantined ? 'Quarantined' : 'Operational'} tone={selectedAsset.quarantined ? 'danger' : 'success'} />
                </div>
              </div>
            ) : (
              <OpsPageState title="No asset selected" description="Select an asset row to inspect details." />
            )}
          </OpsDrawerInspector>
        </TabsContent>

        <TabsContent value="observability" className="space-y-4">
          <OpsToolbar title="Service health">
            <OpsStatusBadge label={`${formatNumber(serviceRows.length)} services`} tone="info" />
            <OpsStatusBadge label={`${formatNumber(serviceRows.filter((service) => normalizeStatusTone(service.status) === 'warning').length)} warning`} tone="warning" />
          </OpsToolbar>

          <OpsSection title="Service posture" description="Compact service-first view for latency, readiness, queue pressure, and dependency health.">
            <OpsDataTable
              columns={[
                { key: 'service', header: 'Service', render: (row) => row.label },
                { key: 'status', header: 'Status', render: (row) => <OpsStatusBadge label={titleCase(row.status)} tone={normalizeStatusTone(row.status)} /> },
                { key: 'metric', header: 'Metric', render: (row) => row.metric },
                { key: 'detail', header: 'Detail', render: (row) => row.detail },
              ]}
              rows={serviceRows}
              rowKey={(row) => row.label}
              onRowClick={(row) => setSelectedServiceLabel(row.label)}
            />
          </OpsSection>

          <OpsDrawerInspector
            open={Boolean(selectedService)}
            onOpenChange={(open) => {
              if (!open) setSelectedServiceLabel(null)
            }}
            title={selectedService?.label || 'Service detail'}
            subtitle="Service status, metric, and operator summary"
          >
            {selectedService ? (
              <div className="space-y-5">
                <OpsDefinitionList
                  items={[
                    { label: 'Status', value: titleCase(selectedService.status) },
                    { label: 'Metric', value: selectedService.metric },
                    { label: 'Detail', value: selectedService.detail },
                  ]}
                />
                <div className="ops-subpanel">
                  <div className="ops-subpanel-title">Operator note</div>
                  <p className="text-sm text-muted-foreground">Observability is intentionally flattened into table-first scanning. Detailed charts can be added later without reintroducing the old card-heavy layout.</p>
                </div>
              </div>
            ) : (
              <OpsPageState title="No service selected" description="Select a service row to inspect details." />
            )}
          </OpsDrawerInspector>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <OpsToolbar title="Log filters">
            <Input placeholder="Search service, action, trace, case, or session" className="h-9 max-w-sm rounded-lg border-white/10 bg-white/[0.03]" />
            <OpsStatusBadge label="Latest 40 events" tone="info" />
          </OpsToolbar>

          <OpsSection title="Structured log stream" description="Operational and technical events with compact scan-first columns.">
            <OpsDataTable
              columns={[
                { key: 'timestamp', header: 'Timestamp', render: (row) => <span className="font-mono text-xs">{formatTimestamp(row.created_at)}</span> },
                { key: 'severity', header: 'Severity', render: (row) => <OpsStatusBadge label={/delete|failed|force|lock/i.test(row.action) ? 'Warning' : 'Info'} tone={/delete|failed|force|lock/i.test(row.action) ? 'warning' : 'info'} /> },
                { key: 'service', header: 'Service', render: (row) => row.source === 'admin' ? 'admin-console' : 'case-runtime' },
                { key: 'message', header: 'Message', render: (row) => titleCase(row.action) },
                { key: 'trace', header: 'Trace', render: (row) => <span className="font-mono text-xs">{row.session_id || row.id}</span> },
                { key: 'entity', header: 'Linked Entity', render: (row) => row.resource_type ? `${row.resource_type}:${row.resource_id || 'unknown'}` : 'system' },
              ]}
              rows={logsQuery.data.items}
              rowKey={(row) => `${row.source}-${row.id}`}
              onRowClick={(row) => setSelectedLogId(`${row.source}-${row.id}`)}
            />
          </OpsSection>

          <OpsDrawerInspector
            open={Boolean(selectedLog)}
            onOpenChange={(open) => {
              if (!open) setSelectedLogId(null)
            }}
            title={selectedLog ? titleCase(selectedLog.action) : 'Log detail'}
            subtitle={selectedLog ? `${selectedLog.source}:${selectedLog.id}` : 'Select a log row'}
          >
            {selectedLog ? (
              <div className="space-y-5">
                <OpsDefinitionList
                  items={[
                    { label: 'Timestamp', value: formatTimestamp(selectedLog.created_at) },
                    { label: 'Actor', value: selectedLog.actor_name || 'Unknown actor' },
                    { label: 'Source', value: selectedLog.source },
                    { label: 'Session', value: selectedLog.session_id || 'n/a' },
                    { label: 'Resource', value: selectedLog.resource_type ? `${selectedLog.resource_type}:${selectedLog.resource_id || 'unknown'}` : 'system' },
                  ]}
                />
                <div className="ops-subpanel">
                  <div className="ops-subpanel-title">Metadata payload</div>
                  <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/8 bg-[#0b0e14] p-4 text-xs text-slate-100">
                    {JSON.stringify(selectedLog.details || {}, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <OpsPageState title="No log selected" description="Select a log row to inspect metadata." icon={<ShieldAlert className="h-7 w-7" />} />
            )}
          </OpsDrawerInspector>
        </TabsContent>
      </Tabs>
    </div>
  )
}
