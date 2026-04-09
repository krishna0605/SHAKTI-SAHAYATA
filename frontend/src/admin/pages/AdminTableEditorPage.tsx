import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { formatNumber, titleCase } from '../lib/format'
import { OpsDataTable, OpsDefinitionList, OpsFilterBar, OpsInspector, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge } from '../components/OpsPrimitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const PAGE_SIZE = 20

export default function AdminTableEditorPage() {
  const [searchParams] = useSearchParams()
  const [tableSearch, setTableSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState(searchParams.get('table') || '')
  const [page, setPage] = useState(1)

  const schemaQuery = useQuery({
    queryKey: ['ops-table-editor-schema'],
    queryFn: () => adminConsoleAPI.getDatabaseSchema(),
    refetchInterval: 60000,
  })

  const filteredTables = useMemo(() => {
    const tables = schemaQuery.data?.tables || []
    if (!tableSearch.trim()) return tables
    const query = tableSearch.trim().toLowerCase()
    return tables.filter((table) => `${table.name} ${table.group} ${table.type}`.toLowerCase().includes(query))
  }, [schemaQuery.data?.tables, tableSearch])

  useEffect(() => {
    if (!selectedTable && filteredTables.length) {
      setSelectedTable(filteredTables[0].name)
    }
  }, [filteredTables, selectedTable])

  const tableMetaQuery = useQuery({
    queryKey: ['ops-table-editor-table-meta', selectedTable],
    queryFn: () => adminConsoleAPI.getDatabaseTable(selectedTable),
    enabled: Boolean(selectedTable),
  })

  const primarySort = useMemo(() => tableMetaQuery.data?.columns.find((column) => column.isPrimaryKey)?.name || tableMetaQuery.data?.columns[0]?.name, [tableMetaQuery.data?.columns])

  const rowsQuery = useQuery({
    queryKey: ['ops-table-editor-rows', selectedTable, primarySort, page],
    queryFn: () => adminConsoleAPI.getDatabaseRows(selectedTable, { page, limit: PAGE_SIZE, sortBy: primarySort, sortDir: 'desc' }),
    enabled: Boolean(selectedTable) && Boolean(primarySort),
  })

  const selectedTableSummary = schemaQuery.data?.tables.find((table) => table.name === selectedTable) || null

  if (schemaQuery.isLoading) {
    return <div className="page-loading">Loading table editor...</div>
  }

  if (schemaQuery.isError || !schemaQuery.data) {
    return <OpsPageState title="Table editor unavailable" description="Database schema metadata could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OpsMetricTile label="Tables" value={formatNumber(schemaQuery.data.summary.tableCount)} detail="Allowlisted tables and views visible in the governed editor." />
        <OpsMetricTile label="Relationships" value={formatNumber(schemaQuery.data.summary.relationshipCount)} detail="Foreign-key links available for relation preview." tone="info" />
        <OpsMetricTile label="Restricted Tables" value={formatNumber(schemaQuery.data.summary.restrictedTableCount)} detail="Metadata visible, browse constrained by role." tone="warning" />
        <OpsMetricTile label="Mode" value="Read-only" detail="Edits remain disabled by default and all future writes stay audited." tone="success" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[280px_1.2fr_0.8fr]">
        <OpsInspector title="Tables" subtitle="Choose a table for row browsing, metadata, and relationship context." className="resize-x overflow-auto min-w-[240px] max-w-[420px]">
          <OpsFilterBar title="Catalog">
            <Input value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Search tables" />
          </OpsFilterBar>
          <div className="space-y-2">
            {filteredTables.map((table) => (
              <button
                key={table.name}
                type="button"
                onClick={() => {
                  setSelectedTable(table.name)
                  setPage(1)
                }}
                className={`w-full rounded-xl border px-3 py-3 text-left transition ${selectedTable === table.name ? 'border-blue-400/50 bg-blue-500/10' : 'border-border/60 bg-background/40 hover:border-blue-300/40'}`}
              >
                <div className="font-medium">{table.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{table.group} • {table.type}</div>
              </button>
            ))}
          </div>
        </OpsInspector>

        <OpsSection title="Visual Row Editor" description="Browse governed rows visually with masking, pagination, metadata, and relation-aware context.">
          {rowsQuery.isLoading || tableMetaQuery.isLoading ? (
            <div className="page-loading">Loading row browser...</div>
          ) : rowsQuery.isError || tableMetaQuery.isError || !rowsQuery.data || !tableMetaQuery.data ? (
            <OpsPageState title="Row browser unavailable" description="The selected table could not be loaded for safe browse mode." />
          ) : (
            <div className="space-y-5">
              <OpsFilterBar title="Controls">
                <OpsStatusBadge label={selectedTableSummary?.group || 'Uncategorized'} tone="info" />
                <OpsStatusBadge label={tableMetaQuery.data.table.canBrowseRows ? 'Browse enabled' : 'Browse restricted'} tone={tableMetaQuery.data.table.canBrowseRows ? 'success' : 'warning'} />
                <OpsStatusBadge label={tableMetaQuery.data.table.restricted ? 'Sensitive fields masked' : 'Standard visibility'} tone={tableMetaQuery.data.table.restricted ? 'warning' : 'neutral'} />
              </OpsFilterBar>

              <OpsDataTable
                columns={rowsQuery.data.columns.map((column) => ({
                  key: column.name,
                  header: column.name,
                  render: (row: Record<string, unknown>) => (
                    <div>
                      <div className={typeof row[column.name] === 'object' ? 'font-mono text-xs' : ''}>{typeof row[column.name] === 'object' ? JSON.stringify(row[column.name]) : String(row[column.name] ?? 'null')}</div>
                      {column.maskStrategy !== 'none' ? <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-amber-300">{column.maskStrategy}</div> : null}
                    </div>
                  ),
                }))}
                rows={rowsQuery.data.items}
                rowKey={(_row, index) => `${selectedTable}-${page}-${index}`}
                emptyTitle="No rows available"
                emptyDescription="This table has no visible rows in the current browse window."
              />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground">
                  Estimated total {formatNumber(rowsQuery.data.pagination.estimatedTotal)} • Page {rowsQuery.data.pagination.page}
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" className="rounded-xl" onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1}>
                    Previous
                  </Button>
                  <Button type="button" variant="outline" className="rounded-xl" onClick={() => setPage((current) => current + 1)} disabled={!rowsQuery.data.pagination.hasMore}>
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </OpsSection>

        <OpsInspector title={selectedTable || 'Table metadata'} subtitle="Read-only metadata, relation preview, and audit-aware table context." className="resize-x overflow-auto min-w-[260px]">
          {tableMetaQuery.data ? (
            <div className="space-y-5">
              <OpsDefinitionList
                items={[
                  { label: 'Schema', value: tableMetaQuery.data.table.schema },
                  { label: 'Type', value: titleCase(tableMetaQuery.data.table.type) },
                  { label: 'Rows', value: formatNumber(tableMetaQuery.data.table.estimatedRowCount) },
                  { label: 'Size', value: tableMetaQuery.data.table.totalBytesLabel },
                  { label: 'Browse', value: tableMetaQuery.data.table.canBrowseRows ? 'Allowed' : 'Restricted' },
                  { label: 'Mode', value: tableMetaQuery.data.table.largeTableMode ? 'Large table guard' : 'Standard' },
                ]}
              />

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Columns</div>
                <div className="space-y-2">
                  {tableMetaQuery.data.columns.slice(0, 8).map((column) => (
                    <div key={column.name} className="ops-list-row">
                      <div>
                        <div className="font-medium">{column.name}</div>
                        <div className="text-xs text-muted-foreground">{column.databaseType}</div>
                      </div>
                      <OpsStatusBadge label={column.isPrimaryKey ? 'PK' : column.maskStrategy !== 'none' ? column.maskStrategy : 'Visible'} tone={column.isPrimaryKey ? 'info' : column.maskStrategy !== 'none' ? 'warning' : 'neutral'} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Relations</div>
                <div className="space-y-2">
                  {[...tableMetaQuery.data.outgoingRelationships, ...tableMetaQuery.data.incomingRelationships].slice(0, 8).map((relationship) => (
                    <div key={relationship.constraintName} className="ops-list-row">
                      <div className="font-medium">{relationship.sourceTable}.{relationship.sourceColumn}</div>
                      <div className="text-xs text-muted-foreground">to {relationship.targetTable}.{relationship.targetColumn}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <OpsPageState title="No table selected" description="Select a table to review metadata, column types, and relationship indicators." />
          )}
        </OpsInspector>
      </div>
    </div>
  )
}
