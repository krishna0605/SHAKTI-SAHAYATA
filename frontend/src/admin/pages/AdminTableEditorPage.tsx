import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Columns3, FileJson2 } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { formatNumber, titleCase } from '../lib/format'
import {
  OpsDataTable,
  OpsDefinitionList,
  OpsDrawerInspector,
  OpsFilterBar,
  OpsPageState,
  OpsSection,
  OpsStatusBadge,
  OpsSummaryStrip,
  OpsMetricTile,
} from '../components/OpsPrimitives'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const PAGE_SIZE = 20

export default function AdminTableEditorPage() {
  const [searchParams] = useSearchParams()
  const [tableSearch, setTableSearch] = useState('')
  const [rowSearch, setRowSearch] = useState('')
  const [selectedTable, setSelectedTable] = useState(searchParams.get('table') || '')
  const [page, setPage] = useState(1)
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<string[]>([])

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

  const primarySort = useMemo(
    () => tableMetaQuery.data?.columns.find((column) => column.isPrimaryKey)?.name || tableMetaQuery.data?.columns[0]?.name,
    [tableMetaQuery.data?.columns],
  )

  const rowsQuery = useQuery({
    queryKey: ['ops-table-editor-rows', selectedTable, primarySort, page],
    queryFn: () => adminConsoleAPI.getDatabaseRows(selectedTable, { page, limit: PAGE_SIZE, sortBy: primarySort, sortDir: 'desc' }),
    enabled: Boolean(selectedTable) && Boolean(primarySort),
  })

  useEffect(() => {
    if (!tableMetaQuery.data) return
    setVisibleColumns((current) => (current.length ? current : tableMetaQuery.data.columns.slice(0, 8).map((column) => column.name)))
  }, [tableMetaQuery.data])

  const selectedTableSummary = schemaQuery.data?.tables.find((table) => table.name === selectedTable) || null

  const filteredRows = useMemo(() => {
    const rows = rowsQuery.data?.items || []
    if (!rowSearch.trim()) return rows
    const query = rowSearch.trim().toLowerCase()
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query))
  }, [rowSearch, rowsQuery.data?.items])

  const selectedRow = useMemo(() => {
    if (!filteredRows.length) return null
    if (!selectedRowKey) return null
    return filteredRows.find((_row, index) => `${selectedTable}-${page}-${index}` === selectedRowKey) || null
  }, [filteredRows, page, selectedRowKey, selectedTable])

  if (schemaQuery.isLoading) {
    return <div className="page-loading">Loading table editor...</div>
  }

  if (schemaQuery.isError || !schemaQuery.data) {
    return <OpsPageState title="Table editor unavailable" description="Database schema metadata could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  const tableColumns = tableMetaQuery.data?.columns || []
  const columnsToRender = tableColumns.filter((column) => visibleColumns.includes(column.name))

  return (
    <div className="space-y-5">
      <OpsSummaryStrip className="xl:grid-cols-4">
        <OpsMetricTile label="Tables" value={formatNumber(schemaQuery.data.summary.tableCount)} detail="Governed editor catalog." />
        <OpsMetricTile label="Selected Table" value={selectedTableSummary?.name || 'None'} detail={selectedTableSummary ? `${selectedTableSummary.group} • ${selectedTableSummary.type}` : 'Choose a table'} tone="info" />
        <OpsMetricTile label="Visible Rows" value={formatNumber(filteredRows.length)} detail="Current page after search filtering." />
        <OpsMetricTile label="Mode" value="Read-only" detail="Writes stay deliberate and audited." tone="success" />
      </OpsSummaryStrip>

      <OpsSection title="Visual row editor" description="Wide data grid with table selection, column controls, and row-level metadata in a drawer.">
        <OpsFilterBar title="Workspace controls">
          <Select value={selectedTable} onValueChange={(value: string) => { setSelectedTable(value); setPage(1); setSelectedRowKey(null) }}>
            <SelectTrigger className="h-9 min-w-[220px] rounded-lg border-white/10 bg-white/[0.03]">
              <SelectValue placeholder="Choose a table" />
            </SelectTrigger>
            <SelectContent>
              {filteredTables.map((table) => (
                <SelectItem key={table.name} value={table.name}>
                  {table.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Search tables" className="h-9 w-[180px] rounded-lg border-white/10 bg-white/[0.03]" />
          <Input value={rowSearch} onChange={(event) => setRowSearch(event.target.value)} placeholder="Search rows on this page" className="h-9 w-[220px] rounded-lg border-white/10 bg-white/[0.03]" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" className="h-9 rounded-lg">
                <Columns3 className="h-4 w-4" />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              {tableColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.name}
                  checked={visibleColumns.includes(column.name)}
                  onCheckedChange={(checked: boolean | 'indeterminate') => {
                    setVisibleColumns((current) => checked === true
                      ? [...current, column.name]
                      : current.filter((name) => name !== column.name))
                  }}
                >
                  {column.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </OpsFilterBar>

        {rowsQuery.isLoading || tableMetaQuery.isLoading ? (
          <div className="page-loading">Loading row browser...</div>
        ) : rowsQuery.isError || tableMetaQuery.isError || !rowsQuery.data || !tableMetaQuery.data ? (
          <OpsPageState title="Row browser unavailable" description="The selected table could not be loaded for safe browse mode." />
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <OpsStatusBadge label={selectedTableSummary?.group || 'Uncategorized'} tone="info" />
              <OpsStatusBadge label={tableMetaQuery.data.table.canBrowseRows ? 'Browse enabled' : 'Browse restricted'} tone={tableMetaQuery.data.table.canBrowseRows ? 'success' : 'warning'} />
              <OpsStatusBadge label={tableMetaQuery.data.table.restricted ? 'Sensitive fields masked' : 'Standard visibility'} tone={tableMetaQuery.data.table.restricted ? 'warning' : 'neutral'} />
            </div>

            <OpsDataTable
              columns={columnsToRender.map((column) => ({
                key: column.name,
                header: column.name,
                render: (row: Record<string, unknown>) => (
                  <div>
                    <div className={typeof row[column.name] === 'object' ? 'font-mono text-xs' : ''}>
                      {typeof row[column.name] === 'object' ? JSON.stringify(row[column.name]) : String(row[column.name] ?? 'null')}
                    </div>
                    {column.maskStrategy !== 'none' ? <div className="mt-1 text-[10px] uppercase tracking-[0.16em] text-amber-300">{column.maskStrategy}</div> : null}
                  </div>
                ),
              }))}
              rows={filteredRows}
              rowKey={(_row, index) => `${selectedTable}-${page}-${index}`}
              onRowClick={(_row, index) => {
                setSelectedRowKey(`${selectedTable}-${page}-${index}`)
              }}
              emptyTitle="No rows available"
              emptyDescription="This table has no visible rows in the current browse window."
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm text-muted-foreground">
                Estimated total {formatNumber(rowsQuery.data.pagination.estimatedTotal)} • Page {rowsQuery.data.pagination.page}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" className="rounded-lg" onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1}>
                  Previous
                </Button>
                <Button type="button" variant="outline" className="rounded-lg" onClick={() => setPage((current) => current + 1)} disabled={!rowsQuery.data.pagination.hasMore}>
                  Next
                </Button>
              </div>
            </div>
          </div>
        )}
      </OpsSection>

      <OpsDrawerInspector
        open={Boolean(selectedRow)}
        onOpenChange={(open) => {
          if (!open) setSelectedRowKey(null)
        }}
        title={selectedTable || 'Row inspector'}
        subtitle="Row metadata, relations, JSON preview, and audit-aware context"
      >
        {selectedRow && tableMetaQuery.data ? (
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
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Key fields</div>
              <div className="space-y-2">
                {tableMetaQuery.data.columns.slice(0, 8).map((column) => (
                  <div key={column.name} className="ops-list-row">
                    <div>
                      <div className="font-medium">{column.name}</div>
                      <div className="text-xs text-muted-foreground">{String(selectedRow[column.name] ?? 'null')}</div>
                    </div>
                    <OpsStatusBadge label={column.isPrimaryKey ? 'PK' : column.maskStrategy !== 'none' ? column.maskStrategy : 'Visible'} tone={column.isPrimaryKey ? 'info' : column.maskStrategy !== 'none' ? 'warning' : 'neutral'} />
                  </div>
                ))}
              </div>
            </div>

            <div className="ops-subpanel">
              <div className="ops-subpanel-title flex items-center gap-2">
                <FileJson2 className="h-4 w-4" />
                Raw JSON
              </div>
              <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/8 bg-[#0b0e14] p-4 text-xs text-slate-100">
                {JSON.stringify(selectedRow, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <OpsPageState title="No row selected" description="Choose a row to inspect metadata, relations, and masked fields." />
        )}
      </OpsDrawerInspector>
    </div>
  )
}
