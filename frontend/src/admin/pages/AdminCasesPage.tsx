import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { formatNumber, formatTimestamp, normalizeStatusTone, titleCase } from '../lib/format'
import { adminPaths } from '../lib/paths'
import { OpsDataTable, OpsDefinitionList, OpsDrawerInspector, OpsFilterBar, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge, OpsSummaryStrip } from '../components/OpsPrimitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

const PAGE_SIZE = 20

const emptyFilters = {
  q: '',
  status: '',
  priority: '',
  owner: '',
  assignedOfficer: '',
}

export default function AdminCasesPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState(emptyFilters)
  const [view, setView] = useState('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const casesQuery = useQuery({
    queryKey: ['ops-cases', filters],
    queryFn: () => adminConsoleAPI.getCases({ ...filters, limit: PAGE_SIZE }),
    refetchInterval: 30000,
  })

  const selectedCase = useMemo(
    () => casesQuery.data?.items.find((item) => item.id === selectedId) || null,
    [casesQuery.data?.items, selectedId],
  )

  const visibleCases = useMemo(() => {
    const items = casesQuery.data?.items || []
    if (view === 'all') return items
    if (view === 'active') return items.filter((item) => ['open', 'active'].includes(item.status))
    if (view === 'attention') return items.filter((item) => item.failed_parse_files > 0 || item.pending_files > 0 || ['critical', 'high'].includes(item.priority))
    if (view === 'closed') return items.filter((item) => ['closed', 'archived'].includes(item.status))
    return items
  }, [casesQuery.data?.items, view])

  if (casesQuery.isLoading) {
    return <div className="page-loading">Loading cases...</div>
  }

  if (casesQuery.isError || !casesQuery.data) {
    return <OpsPageState title="Case operations unavailable" description="The case governance feed could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  return (
    <div className="min-w-0 space-y-6">
      <OpsSummaryStrip className="xl:grid-cols-4">
        <OpsMetricTile label="Total Cases" value={formatNumber(casesQuery.data.summary.totalCases)} detail="Investigations currently available in the governed admin view." />
        <OpsMetricTile label="High Priority" value={formatNumber(casesQuery.data.summary.highPriorityCases)} detail="High and critical case workloads in the current dataset." tone={casesQuery.data.summary.highPriorityCases > 0 ? 'warning' : 'success'} />
        <OpsMetricTile label="Evidence Locked" value={formatNumber(casesQuery.data.summary.lockedCases)} detail="Cases protected by evidence lock controls." tone={casesQuery.data.summary.lockedCases > 0 ? 'info' : 'neutral'} />
        <OpsMetricTile label="Linked Uploads" value={formatNumber(casesQuery.data.summary.totalFiles)} detail="Uploads currently attached to the visible case portfolio." />
      </OpsSummaryStrip>

      <OpsSection title="Case Registry" description="Saved-view-ready case table with operational filters, dense metadata, and direct drill-in to investigation detail.">
        <OpsFilterBar title="Filters" onReset={() => setFilters(emptyFilters)}>
          <Input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Search case ID, title, FIR, owner" className="w-[240px]" />
          <Select value={filters.status || 'all'} onValueChange={(value: string) => setFilters((current) => ({ ...current, status: value === 'all' ? '' : value }))}>
            <SelectTrigger className="h-10 w-[168px] rounded-lg border-white/10 bg-white/[0.03]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.priority || 'all'} onValueChange={(value: string) => setFilters((current) => ({ ...current, priority: value === 'all' ? '' : value }))}>
            <SelectTrigger className="h-10 w-[168px] rounded-lg border-white/10 bg-white/[0.03]">
              <SelectValue placeholder="All priorities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All priorities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Input value={filters.owner} onChange={(event) => setFilters((current) => ({ ...current, owner: event.target.value }))} placeholder="Assigned officer" className="w-[180px]" />
        </OpsFilterBar>

        <Tabs value={view} onValueChange={setView} className="mb-4 min-w-0">
          <TabsList className="inline-flex h-auto w-auto flex-wrap justify-start rounded-lg border border-white/8 bg-[#0f1218] p-1">
            <TabsTrigger value="all" className="rounded-md px-3 py-2">All Cases</TabsTrigger>
            <TabsTrigger value="active" className="rounded-md px-3 py-2">Active</TabsTrigger>
            <TabsTrigger value="attention" className="rounded-md px-3 py-2">Needs Review</TabsTrigger>
            <TabsTrigger value="closed" className="rounded-md px-3 py-2">Closed</TabsTrigger>
          </TabsList>
        </Tabs>

        <OpsDataTable
          columns={[
            {
              key: 'case',
              header: 'Case',
              render: (row) => (
                <div>
                  <div className="font-medium">{row.case_name}</div>
                  <div className="text-xs font-mono text-muted-foreground">{row.case_number}</div>
                </div>
              ),
            },
            { key: 'status', header: 'Status', render: (row) => <OpsStatusBadge label={titleCase(row.status)} tone={normalizeStatusTone(row.status)} /> },
            { key: 'priority', header: 'Priority', render: (row) => <OpsStatusBadge label={titleCase(row.priority)} tone={row.priority === 'critical' ? 'danger' : row.priority === 'high' ? 'warning' : 'neutral'} /> },
            { key: 'owner', header: 'Assigned Officer', render: (row) => row.owner_name || 'Unassigned' },
            { key: 'created', header: 'Created By', render: (row) => row.created_by_name || 'Unknown' },
            { key: 'uploads', header: 'Uploads', render: (row) => formatNumber(row.file_count) },
            { key: 'processing', header: 'Latest Processing', render: (row) => <OpsStatusBadge label={row.failed_parse_files > 0 ? 'Needs Review' : row.pending_files > 0 ? 'Pending' : 'Stable'} tone={row.failed_parse_files > 0 ? 'warning' : row.pending_files > 0 ? 'info' : 'success'} /> },
            { key: 'updated', header: 'Last Updated', render: (row) => formatTimestamp(row.updated_at) },
          ]}
          rows={visibleCases}
          rowKey={(row) => String(row.id)}
          onRowClick={(row) => setSelectedId(row.id)}
          emptyTitle="No cases found"
          emptyDescription="Adjust the active filters or selected case view, or wait for new investigations to enter the registry."
        />
      </OpsSection>

      <OpsDrawerInspector
        open={Boolean(selectedCase)}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null)
        }}
        title={selectedCase ? selectedCase.case_name : 'Case inspector'}
        subtitle={selectedCase ? selectedCase.case_number : 'Select a case row'}
      >
        {selectedCase ? (
          <div className="space-y-5">
            <OpsDefinitionList
              items={[
                { label: 'Priority', value: titleCase(selectedCase.priority) },
                { label: 'Owner', value: selectedCase.owner_name || 'Unassigned' },
                { label: 'Department', value: selectedCase.operator || 'Unspecified' },
                { label: 'Created', value: formatTimestamp(selectedCase.created_at) },
                { label: 'Last Activity', value: formatTimestamp(selectedCase.last_activity_at) },
                { label: 'Risk Flag', value: selectedCase.failed_parse_files > 0 ? 'Failures present' : selectedCase.is_evidence_locked ? 'Evidence locked' : 'Normal' },
              ]}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <OpsMetricTile label="Uploads" value={formatNumber(selectedCase.file_count)} detail={`${selectedCase.pending_files} pending`} tone="info" />
              <OpsMetricTile label="Failures" value={formatNumber(selectedCase.failed_parse_files)} detail={`${selectedCase.completed_files} completed`} tone={selectedCase.failed_parse_files > 0 ? 'danger' : 'success'} />
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Assigned Officers</div>
              <div className="flex flex-wrap gap-2">
                {selectedCase.assigned_officers.length ? selectedCase.assigned_officers.map((assignment, index) => (
                  <OpsStatusBadge key={`${assignment.userId || assignment.user_id || index}`} label={`${assignment.fullName || assignment.full_name || 'Unknown'} • ${titleCase(assignment.role)}`} tone="neutral" />
                )) : <span className="text-sm text-muted-foreground">No active assignments.</span>}
              </div>
            </div>

            <Button type="button" className="w-full rounded-lg" onClick={() => navigate(adminPaths.caseDetail(selectedCase.id))}>
              Open Case Detail
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <OpsPageState title="No case selected" description="Select a case row to inspect ownership, uploads, and quick risk context." />
        )}
      </OpsDrawerInspector>
    </div>
  )
}
