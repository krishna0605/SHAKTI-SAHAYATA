import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { adminConsoleAPI } from '../lib/api'
import { formatNumber, formatTimestamp, titleCase } from '../lib/format'
import { OpsDataTable, OpsDefinitionList, OpsDrawerInspector, OpsFilterBar, OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge, OpsSummaryStrip } from '../components/OpsPrimitives'
import { useAdminLiveUpdates } from '../components/AdminLiveUpdatesProvider'
import { Input } from '@/components/ui/input'

export default function AdminAuditTrailPage() {
  const { isConnected } = useAdminLiveUpdates()
  const [query, setQuery] = useState('')
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const activityQuery = useQuery({
    queryKey: ['ops-audit-trail', query],
    queryFn: () => adminConsoleAPI.getActivity({ q: query, limit: 40 }),
    refetchInterval: isConnected ? false : 15000,
  })

  const selectedEvent = useMemo(
    () => activityQuery.data?.items.find((item) => `${item.source}-${item.id}` === selectedEventId) || null,
    [activityQuery.data?.items, selectedEventId],
  )

  const summary = useMemo(() => {
    const items = activityQuery.data?.items || []
    return {
      admin: items.filter((item) => item.source === 'admin').length,
      officer: items.filter((item) => item.source === 'audit').length,
      risky: items.filter((item) => /delete|export|lock|force|permission|settings/i.test(item.action)).length,
    }
  }, [activityQuery.data?.items])

  if (activityQuery.isLoading) {
    return <div className="page-loading">Loading audit trail...</div>
  }

  if (activityQuery.isError || !activityQuery.data) {
    return <OpsPageState title="Audit trail unavailable" description="Unified audit and admin event history could not be loaded from the backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  return (
    <div className="min-w-0 space-y-6">
      <OpsSummaryStrip className="xl:grid-cols-4">
        <OpsMetricTile label="Events in View" value={formatNumber(activityQuery.data.pagination.total)} detail="Unified audit and admin events matching the current filter state." />
        <OpsMetricTile label="Admin Actions" value={formatNumber(summary.admin)} detail="Internal console actions in the visible result window." tone="info" />
        <OpsMetricTile label="Officer Actions" value={formatNumber(summary.officer)} detail="Officer-generated audit actions in the visible result window." />
        <OpsMetricTile label="High-Risk Events" value={formatNumber(summary.risky)} detail="Deletes, exports, locks, forced actions, or permission changes." tone={summary.risky > 0 ? 'warning' : 'success'} />
      </OpsSummaryStrip>

      <OpsSection title="Immutable Event Ledger" description="Chronological event table with actor, role, object type, session context, and evidence-ready metadata.">
        <OpsFilterBar title="Audit Filters">
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search actor, action, case, session, IP, object" className="w-[320px]" />
        </OpsFilterBar>
        <OpsDataTable
          columns={[
            { key: 'timestamp', header: 'Timestamp', render: (row) => <span className="font-mono text-xs">{formatTimestamp(row.created_at)}</span> },
            { key: 'actor', header: 'Actor', render: (row) => <div><div className="font-medium">{row.actor_name || 'Unknown actor'}</div><div className="text-xs text-muted-foreground">{row.actor_email || row.actor_id || 'Unknown ID'}</div></div> },
            { key: 'role', header: 'Role', render: (row) => <OpsStatusBadge label={row.actor_role || row.actor_type} tone={row.source === 'admin' ? 'info' : 'neutral'} /> },
            { key: 'action', header: 'Action', render: (row) => titleCase(row.action) },
            { key: 'target', header: 'Target', render: (row) => row.resource_type ? `${row.resource_type}:${row.resource_id || 'unknown'}` : 'system' },
            { key: 'session', header: 'Session / IP', render: (row) => <div className="text-xs font-mono">{row.session_id || 'n/a'}<div>{row.ip_address || 'Unknown IP'}</div></div> },
          ]}
          rows={activityQuery.data.items}
          rowKey={(row) => `${row.source}-${row.id}`}
          onRowClick={(row) => setSelectedEventId(`${row.source}-${row.id}`)}
        />
      </OpsSection>

      <OpsDrawerInspector
        open={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) setSelectedEventId(null)
        }}
        title={selectedEvent ? titleCase(selectedEvent.action) : 'Event detail'}
        subtitle={selectedEvent ? `${selectedEvent.source}:${selectedEvent.id}` : 'Select an event row'}
      >
        {selectedEvent ? (
          <div className="space-y-5">
            <OpsDefinitionList
              items={[
                { label: 'Timestamp', value: formatTimestamp(selectedEvent.created_at) },
                { label: 'Actor', value: selectedEvent.actor_name || 'Unknown actor' },
                { label: 'Role', value: selectedEvent.actor_role || selectedEvent.actor_type },
                { label: 'Target Type', value: selectedEvent.resource_type || 'system' },
                { label: 'Target ID', value: selectedEvent.resource_id || 'n/a' },
                { label: 'Session', value: selectedEvent.session_id || 'n/a' },
              ]}
            />
            <div className="ops-subpanel">
              <div className="ops-subpanel-title">Before / After Diff</div>
              <pre className="overflow-auto rounded-lg border border-white/8 bg-[#0b0e14] p-4 text-xs text-slate-100 whitespace-pre-wrap break-words">
                {JSON.stringify(selectedEvent.details || {}, null, 2)}
              </pre>
            </div>
            <div className="flex flex-wrap gap-2">
              <OpsStatusBadge label={selectedEvent.source} tone={selectedEvent.source === 'admin' ? 'info' : 'neutral'} />
              <OpsStatusBadge label={/delete|export|lock|force|permission|settings/i.test(selectedEvent.action) ? 'High Review' : 'Standard'} tone={/delete|export|lock|force|permission|settings/i.test(selectedEvent.action) ? 'warning' : 'success'} />
            </div>
          </div>
        ) : (
          <OpsPageState title="No event selected" description="Select an audit row to inspect metadata payload, session context, and object linkage." />
        )}
      </OpsDrawerInspector>
    </div>
  )
}
