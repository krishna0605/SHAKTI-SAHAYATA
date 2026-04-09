import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Database,
  EyeOff,
  Filter,
  Search,
  ShieldAlert,
} from 'lucide-react'
import { ApiError } from '../../lib/apiClient'
import { adminConsoleAPI } from '../lib/api'
import type { DatabaseColumnMeta, DatabaseRelationship } from '../types'
import { useAdminAuthStore } from '../store/adminAuthStore'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const BROWSE_PAGE_SIZE = 25

type BrowseFilterState = { column: string; op: string; value: string }

const defaultFilter = (): BrowseFilterState => ({ column: '', op: 'eq', value: '' })

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

const formatNumber = (value?: number | null) => new Intl.NumberFormat().format(Number(value || 0))

const stringifyCell = (value: unknown) => {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const maskLabel: Record<string, string> = {
  none: 'Visible',
  full: 'Full mask',
  email: 'Email mask',
  phone: 'Phone mask',
  ip: 'IP mask',
  partial: 'Partial mask',
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof ApiError || error instanceof Error) return error.message
  return fallback
}

const buildIndexedColumns = (columns: DatabaseColumnMeta[], indexes: Array<{ columns: string[] }>) => {
  const indexed = new Set<string>()
  columns.forEach((column) => {
    if (column.isPrimaryKey) indexed.add(column.name)
  })
  indexes.forEach((index) => index.columns.forEach((column) => indexed.add(column)))
  return indexed
}

const buildConnections = (relationships: DatabaseRelationship[], selectedTableName: string) => {
  const inbound = new Set<string>()
  const outbound = new Set<string>()

  relationships.forEach((relationship) => {
    if (relationship.targetTable === selectedTableName) inbound.add(relationship.sourceTable)
    if (relationship.sourceTable === selectedTableName) outbound.add(relationship.targetTable)
  })

  return {
    inbound: Array.from(inbound).sort(),
    outbound: Array.from(outbound).sort(),
  }
}

export default function AdminDatabasePage() {
  const { admin } = useAdminAuthStore()
  const [tableSearch, setTableSearch] = useState('')
  const [selectedTableName, setSelectedTableName] = useState('')
  const [browsePage, setBrowsePage] = useState(1)
  const [sortBy, setSortBy] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filterDraft, setFilterDraft] = useState<BrowseFilterState>(defaultFilter)
  const [appliedFilter, setAppliedFilter] = useState<BrowseFilterState>(defaultFilter)

  const schemaQuery = useQuery({
    queryKey: ['admin-database-schema'],
    queryFn: () => adminConsoleAPI.getDatabaseSchema(),
    refetchInterval: 60000,
  })

  const filteredTables = useMemo(() => {
    const items = schemaQuery.data?.tables || []
    if (!tableSearch.trim()) return items
    const query = tableSearch.trim().toLowerCase()
    return items.filter((table) => [table.name, table.group, table.type].some((value) => value.toLowerCase().includes(query)))
  }, [schemaQuery.data?.tables, tableSearch])

  useEffect(() => {
    if (!selectedTableName && filteredTables.length > 0) {
      setSelectedTableName(filteredTables[0].name)
      return
    }

    if (selectedTableName && !filteredTables.some((table) => table.name === selectedTableName)) {
      setSelectedTableName(filteredTables[0]?.name || '')
    }
  }, [filteredTables, selectedTableName])

  const selectedTableSummary = useMemo(
    () => schemaQuery.data?.tables.find((table) => table.name === selectedTableName) || null,
    [schemaQuery.data?.tables, selectedTableName]
  )

  const tableDetailQuery = useQuery({
    queryKey: ['admin-database-table', selectedTableName],
    queryFn: () => adminConsoleAPI.getDatabaseTable(selectedTableName),
    enabled: Boolean(selectedTableName),
  })

  useEffect(() => {
    const columns = tableDetailQuery.data?.columns || []
    if (!columns.length || sortBy) return
    const primaryKey = columns.find((column) => column.isPrimaryKey)
    setSortBy(primaryKey?.name || columns[0].name)
  }, [sortBy, tableDetailQuery.data?.columns])

  const indexedColumns = useMemo(() => {
    if (!tableDetailQuery.data) return new Set<string>()
    return buildIndexedColumns(tableDetailQuery.data.columns, tableDetailQuery.data.indexes)
  }, [tableDetailQuery.data])

  const filterableColumns = useMemo(() => {
    const columns = tableDetailQuery.data?.columns || []
    if (!selectedTableSummary?.largeTableMode) return columns
    return columns.filter((column) => indexedColumns.has(column.name))
  }, [indexedColumns, selectedTableSummary?.largeTableMode, tableDetailQuery.data?.columns])

  const rowsQuery = useQuery({
    queryKey: [
      'admin-database-rows',
      selectedTableName,
      browsePage,
      sortBy,
      sortDir,
      appliedFilter.column,
      appliedFilter.op,
      appliedFilter.value,
    ],
    queryFn: () =>
      adminConsoleAPI.getDatabaseRows(selectedTableName, {
        page: browsePage,
        limit: BROWSE_PAGE_SIZE,
        sortBy: sortBy || undefined,
        sortDir,
        filterColumn: appliedFilter.column || undefined,
        filterOp: appliedFilter.column ? appliedFilter.op : undefined,
        filterValue: appliedFilter.column && appliedFilter.op !== 'isnull' ? appliedFilter.value : undefined,
      }),
    enabled: Boolean(selectedTableName) && Boolean(tableDetailQuery.data?.table.canBrowseRows) && Boolean(sortBy),
  })

  const selectedRelationships = useMemo(() => {
    const relationships = schemaQuery.data?.relationships || []
    if (!selectedTableName) return relationships
    return relationships.filter((relationship) => relationship.sourceTable === selectedTableName || relationship.targetTable === selectedTableName)
  }, [schemaQuery.data?.relationships, selectedTableName])

  const connections = useMemo(() => buildConnections(selectedRelationships, selectedTableName), [selectedRelationships, selectedTableName])

  const handleTableChange = (tableName: string) => {
    setSelectedTableName(tableName)
    setBrowsePage(1)
    setSortBy('')
    setSortDir('desc')
    const reset = defaultFilter()
    setFilterDraft(reset)
    setAppliedFilter(reset)
  }

  if (schemaQuery.isLoading) return <div className="page-loading">Loading database explorer...</div>

  if (schemaQuery.isError || !schemaQuery.data) {
    return (
      <div className="page-error">
        <AlertTriangle className="h-8 w-8" />
        <div>Failed to load the database explorer.</div>
      </div>
    )
  }

  const selectedTableDetail = tableDetailQuery.data
  const rowsErrorMessage = rowsQuery.isError ? getErrorMessage(rowsQuery.error, 'Failed to browse table rows.') : null

  return (
    <div className="space-y-6">
      <section className="rounded-[1.75rem] border border-border/70 bg-card p-5">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-2">
              <div className="inline-flex rounded-full border border-blue-300/40 bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                Phase 4 Live
              </div>
              <h2 className="text-2xl font-semibold tracking-tight">Database Explorer and Safe Schema Browser</h2>
              <p className="text-sm leading-6 text-muted-foreground">
                Inspect live PostgreSQL metadata, follow schema links, and browse masked sample rows through a read-only allowlist.
              </p>
            </div>
            <div className="rounded-[1.25rem] border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
              Signed in as {admin?.role || 'it_admin'}. No SQL console, row edits, or schema mutation tools are exposed here.
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4">
              <div className="text-sm font-medium text-muted-foreground">Tables in catalog</div>
              <div className="mt-2 text-3xl font-semibold">{schemaQuery.data.summary.tableCount}</div>
              <div className="mt-2 text-sm text-muted-foreground">Allowlisted tables and views discovered through introspection</div>
            </article>
            <article className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4">
              <div className="text-sm font-medium text-muted-foreground">Relationships</div>
              <div className="mt-2 text-3xl font-semibold">{schemaQuery.data.summary.relationshipCount}</div>
              <div className="mt-2 text-sm text-muted-foreground">Foreign-key links available in the schema map</div>
            </article>
            <article className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4">
              <div className="text-sm font-medium text-muted-foreground">Restricted tables</div>
              <div className="mt-2 text-3xl font-semibold">{schemaQuery.data.summary.restrictedTableCount}</div>
              <div className="mt-2 text-sm text-muted-foreground">Metadata visible, row browse limited by admin role</div>
            </article>
            <article className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4">
              <div className="text-sm font-medium text-muted-foreground">Schema snapshot</div>
              <div className="mt-2 text-lg font-semibold">{formatTimestamp(schemaQuery.data.generatedAt)}</div>
              <div className="mt-2 text-sm text-muted-foreground">Latest introspection refresh time</div>
            </article>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-2">
              <label htmlFor="database-search" className="text-sm font-medium text-muted-foreground">Search schema catalog</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="database-search"
                  value={tableSearch}
                  onChange={(event) => setTableSearch(event.target.value)}
                  placeholder="Table name, type, or group"
                  className="pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="selected-table" className="text-sm font-medium text-muted-foreground">Selected table</label>
              <select
                id="selected-table"
                value={selectedTableName}
                onChange={(event) => handleTableChange(event.target.value)}
                className="input-field h-11"
              >
                {filteredTables.map((table) => (
                  <option key={table.name} value={table.name}>
                    {table.name} ({table.type})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </section>

      <Tabs defaultValue="safe-browse" className="space-y-4">
        <TabsList className="h-auto flex-wrap rounded-[1.25rem] p-1">
          <TabsTrigger value="safe-browse" className="rounded-xl px-4 py-2">Rows</TabsTrigger>
          <TabsTrigger value="tables" className="rounded-xl px-4 py-2">Table Workspace</TabsTrigger>
          <TabsTrigger value="relationships" className="rounded-xl px-4 py-2">Relationships</TabsTrigger>
          <TabsTrigger value="schema-map" className="rounded-xl px-4 py-2">Schema Map</TabsTrigger>
        </TabsList>

        <TabsContent value="schema-map">
          <section className="rounded-[1.75rem] border border-border/70 bg-card p-5">
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold">Schema Map</h3>
                <p className="mt-1 text-sm text-muted-foreground">Browse discovered tables by group and jump into metadata or masked row samples.</p>
              </div>
              <Badge variant="outline" className="rounded-full px-3 py-1">{filteredTables.length} visible tables</Badge>
            </div>

            <div className="grid gap-4 xl:grid-cols-3">
              {schemaQuery.data.groups.map((group) => {
                const groupTables = filteredTables.filter((table) => table.group === group.name)
                return (
                  <article key={group.name} className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-base font-semibold">{group.name}</div>
                      <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{group.count} tables</div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {groupTables.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No tables match the current search.</div>
                      ) : (
                        groupTables.map((table) => (
                          <button
                            key={table.name}
                            type="button"
                            onClick={() => handleTableChange(table.name)}
                            className={cn(
                              'w-full rounded-[1rem] border px-3 py-3 text-left transition',
                              table.name === selectedTableName
                                ? 'border-blue-400/50 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10'
                                : 'border-border/70 bg-background/60 hover:border-blue-300/40'
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="font-medium">{table.name}</div>
                              {table.restricted ? <ShieldAlert className="h-4 w-4 text-amber-500" /> : <Database className="h-4 w-4 text-muted-foreground" />}
                            </div>
                            <div className="mt-2 text-xs text-muted-foreground">
                              {table.columnCount} columns • {table.relationshipCount} links • {table.totalBytesLabel}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="tables">
          <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-semibold">Catalog</h3>
                <Badge variant="outline" className="rounded-full px-3 py-1">{filteredTables.length} tables</Badge>
              </div>

              <div className="mt-4 space-y-3">
                {filteredTables.map((table) => (
                  <button
                    key={table.name}
                    type="button"
                    onClick={() => handleTableChange(table.name)}
                    className={cn(
                      'w-full rounded-[1rem] border px-4 py-4 text-left transition',
                      table.name === selectedTableName
                        ? 'border-blue-400/50 bg-blue-50 dark:border-blue-500/30 dark:bg-blue-500/10'
                        : 'border-border/70 bg-card/60 hover:border-blue-300/40'
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium">{table.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{table.group} • {table.type}</div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {table.restricted ? <Badge className="rounded-full bg-amber-600 text-white">Restricted</Badge> : null}
                        {table.largeTableMode ? <Badge variant="outline" className="rounded-full">Large table</Badge> : null}
                      </div>
                    </div>
                    <div className="mt-3 text-sm text-muted-foreground">
                      {formatNumber(table.estimatedRowCount)} rows estimated • {table.columnCount} columns • {table.indexCount} indexes
                    </div>
                    {table.browseRestrictionReason ? (
                      <div className="mt-2 text-xs text-muted-foreground">{table.browseRestrictionReason}</div>
                    ) : null}
                  </button>
                ))}
              </div>
            </article>

            <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
              {tableDetailQuery.isLoading ? (
                <div className="page-loading">Loading table metadata...</div>
              ) : tableDetailQuery.isError || !selectedTableDetail || !selectedTableSummary ? (
                <div className="page-error">
                  <AlertTriangle className="h-8 w-8" />
                  <div>Failed to load the selected table metadata.</div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-xl font-semibold">{selectedTableDetail.table.name}</h3>
                        <Badge variant="outline" className="rounded-full">{selectedTableDetail.table.type}</Badge>
                        {selectedTableDetail.table.restricted ? <Badge className="rounded-full bg-amber-600 text-white">Restricted</Badge> : null}
                        {selectedTableDetail.table.largeTableMode ? <Badge variant="outline" className="rounded-full">Large table guard</Badge> : null}
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        {selectedTableDetail.table.group} • {selectedTableDetail.table.totalBytesLabel} • Last analyzed {formatTimestamp(selectedTableDetail.table.lastAnalyzedAt)}
                      </div>
                    </div>
                    <Badge variant="outline" className="rounded-full px-3 py-1">
                      Browse {selectedTableDetail.table.canBrowseRows ? 'enabled' : 'restricted'}
                    </Badge>
                  </div>

                  {selectedTableDetail.table.browseRestrictionReason ? (
                    <div className="rounded-[1.25rem] border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                      {selectedTableDetail.table.browseRestrictionReason}
                    </div>
                  ) : null}

                  {selectedTableDetail.table.largeTableMode ? (
                    <div className="rounded-[1.25rem] border border-blue-300/40 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                      Large-table guard is active. Sorting and filtering are limited to indexed or relationship columns to avoid full scans.
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-3">
                    <article className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Columns</div>
                      <div className="mt-2 text-2xl font-semibold">{selectedTableDetail.columns.length}</div>
                    </article>
                    <article className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Indexes</div>
                      <div className="mt-2 text-2xl font-semibold">{selectedTableDetail.indexes.length}</div>
                    </article>
                    <article className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Relationships</div>
                      <div className="mt-2 text-2xl font-semibold">
                        {selectedTableDetail.outgoingRelationships.length + selectedTableDetail.incomingRelationships.length}
                      </div>
                    </article>
                  </div>

                  <div className="overflow-x-auto rounded-[1.25rem] border border-border/70">
                    <table className="min-w-full divide-y divide-border/70 text-sm">
                      <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">Column</th>
                          <th className="px-4 py-3">Type</th>
                          <th className="px-4 py-3">Required</th>
                          <th className="px-4 py-3">Masking</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {selectedTableDetail.columns.map((column) => (
                          <tr key={column.name} className="bg-card/60">
                            <td className="px-4 py-3 font-medium">{column.name}</td>
                            <td className="px-4 py-3">
                              <div>{column.dataType}</div>
                              <div className="mt-1 text-xs text-muted-foreground">{column.databaseType}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                {column.isPrimaryKey ? <Badge className="rounded-full bg-slate-900 text-white">PK</Badge> : null}
                                <Badge variant="outline" className="rounded-full">{column.isNullable ? 'Nullable' : 'Required'}</Badge>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant={column.maskStrategy === 'none' ? 'outline' : 'secondary'} className="rounded-full">
                                {maskLabel[column.maskStrategy] || column.maskStrategy}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="grid gap-4 xl:grid-cols-2">
                    <section className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-lg font-semibold">Index Details</h4>
                        <Badge variant="outline" className="rounded-full">{selectedTableDetail.indexes.length}</Badge>
                      </div>
                      <div className="mt-3 space-y-3">
                        {selectedTableDetail.indexes.length === 0 ? (
                          <div className="text-sm text-muted-foreground">No index definitions were discovered for this table.</div>
                        ) : (
                          selectedTableDetail.indexes.map((index) => (
                            <article key={index.name} className="rounded-[1rem] border border-border/70 bg-background/60 px-4 py-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="font-medium">{index.name}</div>
                                {index.isUnique ? <Badge className="rounded-full bg-emerald-600 text-white">Unique</Badge> : null}
                              </div>
                              <div className="mt-2 text-sm text-muted-foreground">
                                {index.columns.length ? index.columns.join(', ') : 'Expression index'}
                              </div>
                              <div className="mt-2 break-all text-xs text-muted-foreground">{index.definition}</div>
                            </article>
                          ))
                        )}
                      </div>
                    </section>

                    <section className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-lg font-semibold">Foreign-Key Details</h4>
                        <Badge variant="outline" className="rounded-full">
                          {selectedTableDetail.outgoingRelationships.length + selectedTableDetail.incomingRelationships.length}
                        </Badge>
                      </div>
                      <div className="mt-3 space-y-4">
                        <div className="space-y-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Outbound</div>
                          {selectedTableDetail.outgoingRelationships.length === 0 ? (
                            <div className="text-sm text-muted-foreground">No outbound foreign keys.</div>
                          ) : (
                            selectedTableDetail.outgoingRelationships.map((relationship) => (
                              <article key={relationship.constraintName} className="rounded-[1rem] border border-border/70 bg-background/60 px-4 py-4">
                                <div className="font-medium">{relationship.constraintName}</div>
                                <div className="mt-2 text-sm text-muted-foreground">
                                  {relationship.sourceTable}.{relationship.sourceColumn} {'->'} {relationship.targetTable}.{relationship.targetColumn}
                                </div>
                              </article>
                            ))
                          )}
                        </div>

                        <div className="space-y-3">
                          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Inbound</div>
                          {selectedTableDetail.incomingRelationships.length === 0 ? (
                            <div className="text-sm text-muted-foreground">No inbound foreign keys.</div>
                          ) : (
                            selectedTableDetail.incomingRelationships.map((relationship) => (
                              <article key={relationship.constraintName} className="rounded-[1rem] border border-border/70 bg-background/60 px-4 py-4">
                                <div className="font-medium">{relationship.constraintName}</div>
                                <div className="mt-2 text-sm text-muted-foreground">
                                  {relationship.sourceTable}.{relationship.sourceColumn} {'->'} {relationship.targetTable}.{relationship.targetColumn}
                                </div>
                              </article>
                            ))
                          )}
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}
            </article>
          </section>
        </TabsContent>

        <TabsContent value="relationships">
          <section className="space-y-4">
            <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <h3 className="text-xl font-semibold">Relationship Graph</h3>
                  <p className="mt-1 text-sm text-muted-foreground">An ER-style view centered on the selected table so IT can inspect schema links without shell access.</p>
                </div>
                <Badge variant="outline" className="rounded-full px-3 py-1">{selectedTableName || 'No table selected'}</Badge>
              </div>

              {selectedTableName ? (
                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto_1fr] lg:items-start">
                  <div className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-lg font-semibold">Inbound</h4>
                      <Badge variant="outline" className="rounded-full">{connections.inbound.length}</Badge>
                    </div>
                    <div className="mt-3 space-y-3">
                      {connections.inbound.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No inbound foreign keys.</div>
                      ) : (
                        connections.inbound.map((tableName) => (
                          <button key={tableName} type="button" onClick={() => handleTableChange(tableName)} className="w-full rounded-[1rem] border border-border/70 bg-background/60 px-4 py-3 text-left transition hover:border-blue-300/40">
                            <div className="font-medium">{tableName}</div>
                            <div className="mt-1 text-xs text-muted-foreground">References {selectedTableName}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-center lg:min-h-[16rem]">
                    <div className="rounded-[1.75rem] border border-blue-300/40 bg-blue-50 px-5 py-5 text-center dark:border-blue-500/20 dark:bg-blue-500/10">
                      <Database className="mx-auto h-7 w-7 text-blue-700 dark:text-blue-300" />
                      <div className="mt-3 text-lg font-semibold">{selectedTableName}</div>
                      <div className="mt-1 text-sm text-muted-foreground">{selectedTableSummary?.group || 'Unknown group'}</div>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-lg font-semibold">Outbound</h4>
                      <Badge variant="outline" className="rounded-full">{connections.outbound.length}</Badge>
                    </div>
                    <div className="mt-3 space-y-3">
                      {connections.outbound.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No outbound foreign keys.</div>
                      ) : (
                        connections.outbound.map((tableName) => (
                          <button key={tableName} type="button" onClick={() => handleTableChange(tableName)} className="w-full rounded-[1rem] border border-border/70 bg-background/60 px-4 py-3 text-left transition hover:border-blue-300/40">
                            <div className="font-medium">{tableName}</div>
                            <div className="mt-1 text-xs text-muted-foreground">Referenced by {selectedTableName}</div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </article>

            <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-semibold">Relationship Feed</h3>
                <Badge variant="outline" className="rounded-full px-3 py-1">{selectedRelationships.length} links</Badge>
              </div>
              <div className="mt-4 space-y-3">
                {selectedRelationships.map((relationship) => {
                  const direction = relationship.sourceTable === selectedTableName ? 'Outgoing' : 'Incoming'
                  return (
                    <div key={relationship.constraintName} className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="rounded-full">{direction}</Badge>
                        <div className="font-medium">{relationship.constraintName}</div>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {relationship.sourceTable}.{relationship.sourceColumn} {'->'} {relationship.targetTable}.{relationship.targetColumn}
                      </div>
                    </div>
                  )
                })}
              </div>
            </article>
          </section>
        </TabsContent>

        <TabsContent value="safe-browse">
          <section className="rounded-[1.75rem] border border-border/70 bg-card p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h3 className="text-xl font-semibold">Safe Browse</h3>
                <p className="mt-1 text-sm text-muted-foreground">Read-only row browsing with server-side validation, masking, and pagination.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="rounded-full px-3 py-1">Page size {BROWSE_PAGE_SIZE}</Badge>
                <Badge className="rounded-full bg-slate-900 text-white">
                  <EyeOff className="mr-1 h-3 w-3" />
                  Read only
                </Badge>
              </div>
            </div>

            {!selectedTableDetail ? (
              <div className="page-loading mt-4">Loading table metadata...</div>
            ) : (
              <div className="mt-5 space-y-5">
                <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-lg font-semibold">{selectedTableDetail.table.name}</div>
                        <div className="mt-1 text-sm text-muted-foreground">
                          {formatNumber(selectedTableDetail.table.estimatedRowCount)} rows estimated • {selectedTableDetail.table.totalBytesLabel}
                        </div>
                      </div>
                      {selectedTableDetail.table.restricted ? <Badge className="rounded-full bg-amber-600 text-white">Restricted</Badge> : null}
                    </div>

                    {selectedTableDetail.table.browseRestrictionReason ? (
                      <div className="mt-3 rounded-[1rem] border border-amber-300/50 bg-amber-50 px-3 py-3 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                        {selectedTableDetail.table.browseRestrictionReason}
                      </div>
                    ) : null}

                    {selectedTableDetail.table.largeTableMode ? (
                      <div className="mt-3 rounded-[1rem] border border-blue-300/40 bg-blue-50 px-3 py-3 text-sm text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200">
                        Large-table fallback mode is active. Use indexed columns for sorting and filters.
                      </div>
                    ) : null}

                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <label htmlFor="sort-by" className="text-sm font-medium text-muted-foreground">Sort column</label>
                        <select
                          id="sort-by"
                          value={sortBy}
                          onChange={(event) => {
                            setSortBy(event.target.value)
                            setBrowsePage(1)
                          }}
                          className="input-field h-11"
                          disabled={!selectedTableDetail.table.canBrowseRows}
                        >
                          {selectedTableDetail.columns
                            .filter((column) => !selectedTableDetail.table.largeTableMode || indexedColumns.has(column.name))
                            .map((column) => (
                              <option key={column.name} value={column.name}>{column.name}</option>
                            ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="sort-dir" className="text-sm font-medium text-muted-foreground">Sort direction</label>
                        <select
                          id="sort-dir"
                          value={sortDir}
                          onChange={(event) => {
                            setSortDir(event.target.value as 'asc' | 'desc')
                            setBrowsePage(1)
                          }}
                          className="input-field h-11"
                          disabled={!selectedTableDetail.table.canBrowseRows}
                        >
                          <option value="desc">Descending</option>
                          <option value="asc">Ascending</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.5rem] border border-border/70 bg-card/60 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-lg font-semibold">Server-side filter</div>
                      <Badge variant="outline" className="rounded-full">
                        <Filter className="mr-1 h-3 w-3" />
                        Limited operators
                      </Badge>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <label htmlFor="filter-column" className="text-sm font-medium text-muted-foreground">Column</label>
                        <select
                          id="filter-column"
                          value={filterDraft.column}
                          onChange={(event) => setFilterDraft((current) => ({ ...current, column: event.target.value }))}
                          className="input-field h-11"
                          disabled={!selectedTableDetail.table.canBrowseRows}
                        >
                          <option value="">No filter</option>
                          {filterableColumns.map((column) => (
                            <option key={column.name} value={column.name}>{column.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor="filter-op" className="text-sm font-medium text-muted-foreground">Operator</label>
                        <select
                          id="filter-op"
                          value={filterDraft.op}
                          onChange={(event) => setFilterDraft((current) => ({ ...current, op: event.target.value }))}
                          className="input-field h-11"
                          disabled={!selectedTableDetail.table.canBrowseRows || !filterDraft.column}
                        >
                          <option value="eq">Equals</option>
                          <option value="ilike" disabled={selectedTableDetail.table.largeTableMode}>Contains text</option>
                          <option value="gte">Greater or equal</option>
                          <option value="lte">Less or equal</option>
                          <option value="isnull">Is null</option>
                        </select>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      <label htmlFor="filter-value" className="text-sm font-medium text-muted-foreground">Filter value</label>
                      <Input
                        id="filter-value"
                        value={filterDraft.value}
                        onChange={(event) => setFilterDraft((current) => ({ ...current, value: event.target.value }))}
                        placeholder={filterDraft.op === 'isnull' ? 'Optional, defaults to true' : 'Enter filter value'}
                        disabled={!selectedTableDetail.table.canBrowseRows || !filterDraft.column || filterDraft.op === 'isnull'}
                      />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        onClick={() => {
                          setBrowsePage(1)
                          setAppliedFilter(filterDraft)
                        }}
                        disabled={!selectedTableDetail.table.canBrowseRows || !filterDraft.column || (filterDraft.op !== 'isnull' && !filterDraft.value.trim())}
                      >
                        Apply filter
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const reset = defaultFilter()
                          setBrowsePage(1)
                          setFilterDraft(reset)
                          setAppliedFilter(reset)
                        }}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                </div>

                {rowsErrorMessage ? (
                  <div className="rounded-[1.25rem] border border-red-300/50 bg-red-50 px-4 py-4 text-sm text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
                    {rowsErrorMessage}
                  </div>
                ) : null}

                {selectedTableDetail.table.canBrowseRows && rowsQuery.data ? (
                  <div className="space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        Page {rowsQuery.data.pagination.page}. Estimated total: {formatNumber(rowsQuery.data.pagination.estimatedTotal)}.
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="rounded-full">Sort {rowsQuery.data.sort.by} {rowsQuery.data.sort.dir}</Badge>
                        {rowsQuery.data.filter.column ? <Badge variant="outline" className="rounded-full">Filter {rowsQuery.data.filter.column}</Badge> : null}
                      </div>
                    </div>

                    <div className="overflow-x-auto rounded-[1.25rem] border border-border/70">
                      <table className="min-w-full divide-y divide-border/70 text-sm">
                        <thead className="bg-muted/40 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                          <tr>
                            {rowsQuery.data.columns.map((column) => (
                              <th key={column.name} className="px-4 py-3">
                                <div className="flex flex-col gap-1">
                                  <span>{column.name}</span>
                                  {column.maskStrategy !== 'none' ? (
                                    <span className="text-[10px] font-medium normal-case text-amber-700 dark:text-amber-300">{maskLabel[column.maskStrategy]}</span>
                                  ) : null}
                                </div>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {rowsQuery.data.items.map((item, index) => (
                            <tr key={`${selectedTableName}-${rowsQuery.data.pagination.page}-${index}`} className="bg-card/60 align-top">
                              {rowsQuery.data.columns.map((column) => (
                                <td key={column.name} className="max-w-[16rem] px-4 py-3">
                                  <div className="break-words">{stringifyCell(item[column.name])}</div>
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        {rowsQuery.data.pagination.hasMore ? 'More rows are available.' : 'End of current browse window.'}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button type="button" variant="outline" onClick={() => setBrowsePage((current) => Math.max(current - 1, 1))} disabled={browsePage <= 1 || rowsQuery.isFetching}>
                          <ChevronLeft className="h-4 w-4" />
                          Previous
                        </Button>
                        <div className="min-w-[5rem] text-center text-sm font-medium">Page {browsePage}</div>
                        <Button type="button" variant="outline" onClick={() => setBrowsePage((current) => current + 1)} disabled={!rowsQuery.data.pagination.hasMore || rowsQuery.isFetching}>
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : selectedTableDetail.table.canBrowseRows ? (
                  <div className="page-loading">Loading masked row sample...</div>
                ) : (
                  <div className="rounded-[1.5rem] border border-dashed border-border/70 bg-card/40 px-5 py-10 text-center">
                    <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
                    <div className="mt-4 text-lg font-semibold">Row browse restricted</div>
                    <div className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                      {selectedTableDetail.table.browseRestrictionReason || 'This table can only be browsed by approved admin roles.'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  )
}
