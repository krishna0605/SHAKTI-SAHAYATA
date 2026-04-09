import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { formatNumber, formatTimestamp, normalizeStatusTone, titleCase } from '../lib/format'
import { adminPaths } from '../lib/paths'
import { OpsDataTable, OpsDefinitionList, OpsFilterBar, OpsInspector, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge } from '../components/OpsPrimitives'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const casesQuery = useQuery({
    queryKey: ['ops-cases', filters],
    queryFn: () => adminConsoleAPI.getCases({ ...filters, limit: PAGE_SIZE }),
    refetchInterval: 30000,
  })

  const selectedCase = useMemo(
    () => casesQuery.data?.items.find((item) => item.id === selectedId) || casesQuery.data?.items[0] || null,
    [casesQuery.data?.items, selectedId],
  )

  if (casesQuery.isLoading) {
    return <div className="page-loading">Loading cases...</div>
  }

  if (casesQuery.isError || !casesQuery.data) {
    return <OpsPageState title="Case operations unavailable" description="The case governance feed could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OpsMetricTile label="Total Cases" value={formatNumber(casesQuery.data.summary.totalCases)} detail="Investigations currently available in the governed admin view." />
        <OpsMetricTile label="High Priority" value={formatNumber(casesQuery.data.summary.highPriorityCases)} detail="High and critical case workloads in the current dataset." tone={casesQuery.data.summary.highPriorityCases > 0 ? 'warning' : 'success'} />
        <OpsMetricTile label="Evidence Locked" value={formatNumber(casesQuery.data.summary.lockedCases)} detail="Cases protected by evidence lock controls." tone={casesQuery.data.summary.lockedCases > 0 ? 'info' : 'neutral'} />
        <OpsMetricTile label="Linked Uploads" value={formatNumber(casesQuery.data.summary.totalFiles)} detail="Uploads currently attached to the visible case portfolio." />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
        <OpsSection title="Case Registry" description="Saved-view-ready case table with operational filters, dense metadata, and direct drill-in to investigation detail.">
          <OpsFilterBar title="Filters" onReset={() => setFilters(emptyFilters)}>
            <Input value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="Search case ID, title, FIR, owner" className="w-[240px]" />
            <select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value }))} className="input-field h-10 w-[160px]">
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="active">Active</option>
              <option value="closed">Closed</option>
              <option value="archived">Archived</option>
            </select>
            <select value={filters.priority} onChange={(event) => setFilters((current) => ({ ...current, priority: event.target.value }))} className="input-field h-10 w-[160px]">
              <option value="">All priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <Input value={filters.owner} onChange={(event) => setFilters((current) => ({ ...current, owner: event.target.value }))} placeholder="Assigned officer" className="w-[180px]" />
          </OpsFilterBar>

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
            rows={casesQuery.data.items}
            rowKey={(row) => String(row.id)}
            onRowClick={(row) => setSelectedId(row.id)}
            emptyTitle="No cases found"
            emptyDescription="Adjust the active filters or wait for new investigations to enter the registry."
          />
        </OpsSection>

        <OpsInspector
          title={selectedCase ? selectedCase.case_name : 'Case inspector'}
          subtitle={selectedCase ? selectedCase.case_number : 'Select a case row'}
          action={selectedCase ? <OpsStatusBadge label={titleCase(selectedCase.status)} tone={normalizeStatusTone(selectedCase.status)} /> : undefined}
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

              <Button type="button" className="w-full rounded-xl" onClick={() => navigate(adminPaths.caseDetail(selectedCase.id))}>
                Open Case Detail
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <OpsPageState title="No case selected" description="Select a case row to inspect ownership, uploads, and quick risk context." />
          )}
        </OpsInspector>
      </div>
    </div>
  )
}
