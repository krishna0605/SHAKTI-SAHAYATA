import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { formatBytes, formatNumber, formatTimestamp, normalizeStatusTone, titleCase } from '../lib/format'
import { adminPaths } from '../lib/paths'
import { OpsDataTable, OpsDefinitionList, OpsEntityChip, OpsInspector, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge } from '../components/OpsPrimitives'
import AdminSchemaVisualizer from '../components/AdminSchemaVisualizer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function AdminDatabaseWorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'schema'
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [selectedAssetId, setSelectedAssetId] = useState<number | null>(null)

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

  const selectedAsset = storageQuery.data?.items.find((item) => item.fileId === selectedAssetId) || storageQuery.data?.items[0] || null
  const serviceCards = useMemo(() => {
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

  useEffect(() => {
    if (!selectedTable && schemaQuery.data?.tables.length) {
      setSelectedTable(schemaQuery.data.tables[0].name)
    }
  }, [schemaQuery.data?.tables, selectedTable])

  if (schemaQuery.isLoading || storageQuery.isLoading || healthQuery.isLoading || logsQuery.isLoading) {
    return <div className="page-loading">Loading database workspace...</div>
  }

  if (schemaQuery.isError || storageQuery.isError || healthQuery.isError || logsQuery.isError || !schemaQuery.data || !storageQuery.data || !healthQuery.data || !logsQuery.data) {
    return <OpsPageState title="Database workspace unavailable" description="One or more database workspace services could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(value: string) => setSearchParams({ tab: value })} className="space-y-5">
        <TabsList className="flex h-auto flex-wrap justify-start rounded-xl border border-border/70 bg-card/80 p-1">
          <TabsTrigger value="schema" className="rounded-lg px-3 py-2">Schema Visualizer</TabsTrigger>
          <TabsTrigger value="storage" className="rounded-lg px-3 py-2">Storage</TabsTrigger>
          <TabsTrigger value="observability" className="rounded-lg px-3 py-2">Observability</TabsTrigger>
          <TabsTrigger value="logs" className="rounded-lg px-3 py-2">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="schema" className="space-y-6">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <OpsMetricTile label="Tables" value={formatNumber(schemaQuery.data.summary.tableCount)} detail="Visible tables and views in the governed catalog." />
            <OpsMetricTile label="Relationships" value={formatNumber(schemaQuery.data.summary.relationshipCount)} detail="Foreign-key connections rendered in the schema graph." tone="info" />
            <OpsMetricTile label="Restricted" value={formatNumber(schemaQuery.data.summary.restrictedTableCount)} detail="Sensitive tables with role-aware browse restrictions." tone="warning" />
            <OpsMetricTile label="Snapshot" value={formatTimestamp(schemaQuery.data.generatedAt)} detail="Latest schema introspection time." />
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <OpsSection title="Schema Canvas" description="Supabase-inspired schema graph for fast relation comprehension, table search, and visual drill-in.">
              <AdminSchemaVisualizer
                schema={schemaQuery.data}
                selectedTable={selectedTable}
                onSelectTable={(tableName) => setSelectedTable(tableName)}
              />
            </OpsSection>

            <OpsInspector title={selectedTable || 'Table Inspector'} subtitle="Column types, keys, relationship context, and editor jump points.">
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
                      {tableQuery.data.columns.slice(0, 10).map((column) => (
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
                <OpsPageState title="No table selected" description="Select a node on the schema canvas to inspect keys, columns, and linked tables." />
              )}
            </OpsInspector>
          </div>
        </TabsContent>

        <TabsContent value="storage" className="space-y-6">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <OpsMetricTile label="Total Files" value={formatNumber(storageQuery.data.summary.totalFiles)} detail="Governed evidence files retained in storage." />
            <OpsMetricTile label="Storage Used" value={formatBytes(storageQuery.data.summary.totalStorageBytes)} detail="Estimated storage footprint across visible assets." />
            <OpsMetricTile label="By Type" value={formatNumber(storageQuery.data.byType.length)} detail="Distinct evidence format groups currently visible." />
            <OpsMetricTile label="Recent Uploads" value={formatNumber(storageQuery.data.summary.recentUploads)} detail="Files uploaded in the current daily window." tone="info" />
            <OpsMetricTile label="Orphaned Files" value={formatNumber(storageQuery.data.summary.orphanedFiles)} detail="Files missing clean case linkage." tone={storageQuery.data.summary.orphanedFiles > 0 ? 'warning' : 'success'} />
            <OpsMetricTile label="Flagged Files" value={formatNumber(storageQuery.data.summary.flaggedFiles)} detail="Quarantined, failed, or integrity-warning assets." tone={storageQuery.data.summary.flaggedFiles > 0 ? 'danger' : 'success'} />
          </section>

          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <OpsSection title="Evidence Storage Browser" description="Secure asset browser for evidence uploads, retention, integrity, and legal-hold posture.">
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

            <OpsInspector title={selectedAsset ? selectedAsset.fileName : 'Asset inspector'} subtitle="Metadata, storage path, retention, integrity, and legal context.">
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
                <OpsPageState title="No asset selected" description="Storage metadata and evidence handling context appear here once an asset is selected." />
              )}
            </OpsInspector>
          </div>
        </TabsContent>

        <TabsContent value="observability" className="space-y-6">
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {serviceCards.map((service) => (
              <OpsMetricTile key={service.label} label={service.label} value={service.metric} detail={service.detail} tone={normalizeStatusTone(service.status)} />
            ))}
          </section>

          <OpsSection title="Service Health Table" description="Compact backend and database-adjacent service posture for fast operator scanning.">
            <OpsDataTable
              columns={[
                { key: 'service', header: 'Service', render: (row) => row.label },
                { key: 'status', header: 'Status', render: (row) => <OpsStatusBadge label={titleCase(row.status)} tone={normalizeStatusTone(row.status)} /> },
                { key: 'metric', header: 'Metric', render: (row) => row.metric },
                { key: 'detail', header: 'Detail', render: (row) => row.detail },
              ]}
              rows={serviceCards}
              rowKey={(row) => row.label}
            />
          </OpsSection>
        </TabsContent>

        <TabsContent value="logs">
          <OpsSection title="Structured Log Stream" description="Searchable technical and operational log-like activity with links back to cases, users, uploads, and audit evidence.">
            <OpsDataTable
              columns={[
                { key: 'timestamp', header: 'Timestamp', render: (row) => <span className="font-mono text-xs">{formatTimestamp(row.created_at)}</span> },
                { key: 'severity', header: 'Severity', render: (row) => <OpsStatusBadge label={/delete|failed|force|lock/i.test(row.action) ? 'Warning' : 'Info'} tone={/delete|failed|force|lock/i.test(row.action) ? 'warning' : 'info'} /> },
                { key: 'service', header: 'Service', render: (row) => row.source === 'admin' ? 'admin-console' : 'case-runtime' },
                { key: 'message', header: 'Short Message', render: (row) => titleCase(row.action) },
                { key: 'trace', header: 'Request / Trace', render: (row) => <span className="font-mono text-xs">{row.session_id || row.id}</span> },
                { key: 'entity', header: 'Linked Entity', render: (row) => row.resource_type ? `${row.resource_type}:${row.resource_id || 'unknown'}` : 'system' },
              ]}
              rows={logsQuery.data.items}
              rowKey={(row) => `${row.source}-${row.id}`}
            />
          </OpsSection>
        </TabsContent>
      </Tabs>
    </div>
  )
}
