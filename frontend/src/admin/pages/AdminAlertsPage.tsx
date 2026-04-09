import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { ApiError } from '../../lib/apiClient'
import AdminRecentAuthDialog from '../components/AdminRecentAuthDialog'
import { adminConsoleAPI } from '../lib/api'
import type { AdminAlertItem } from '../types'
import { OpsDataTable, OpsDefinitionList, OpsDrawerInspector, OpsPageState, OpsSection, OpsStatusBadge, OpsSummaryStrip, OpsMetricTile } from '../components/OpsPrimitives'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'Not available'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString()
}

const severityTone = (severity: string) => {
  if (severity === 'critical') return 'danger' as const
  if (severity === 'warning') return 'warning' as const
  return 'info' as const
}

export default function AdminAlertsPage() {
  const queryClient = useQueryClient()
  const [selectedAlert, setSelectedAlert] = useState<AdminAlertItem | null>(null)
  const [ackNote, setAckNote] = useState('')
  const [recentAuthOpen, setRecentAuthOpen] = useState(false)

  const alertsQuery = useQuery({
    queryKey: ['admin-alerts'],
    queryFn: () => adminConsoleAPI.getAlerts(),
    refetchInterval: 30000,
  })

  const acknowledgeMutation = useMutation({
    mutationFn: ({ alertId, note }: { alertId: string; note: string }) => adminConsoleAPI.acknowledgeAlert(alertId, note),
    onSuccess: async () => {
      toast.success('Alert acknowledgement saved.')
      setSelectedAlert(null)
      setAckNote('')
      await queryClient.invalidateQueries({ queryKey: ['admin-alerts'] })
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'RECENT_ADMIN_AUTH_REQUIRED') {
        setRecentAuthOpen(true)
        return
      }
      toast.error(error instanceof Error ? error.message : 'Failed to save alert acknowledgement.')
    },
  })

  const summary = useMemo(() => {
    const items = alertsQuery.data?.items || []
    return {
      total: items.length,
      critical: items.filter((item) => item.severity === 'critical').length,
      unacknowledged: items.filter((item) => !item.acknowledged).length,
      acknowledged: items.filter((item) => item.acknowledged).length,
    }
  }, [alertsQuery.data?.items])

  if (alertsQuery.isLoading) {
    return <div className="page-loading">Loading alerts and incidents...</div>
  }

  if (alertsQuery.isError || !alertsQuery.data) {
    return <OpsPageState title="Alerts unavailable" description="The incident queue could not be loaded from the admin backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  const handleOpenAlert = (alert: AdminAlertItem) => {
    setSelectedAlert(alert)
    setAckNote(alert.note || '')
  }

  const handleConfirmAck = async () => {
    if (!selectedAlert) return
    await acknowledgeMutation.mutateAsync({ alertId: selectedAlert.id, note: ackNote.trim() })
  }

  return (
    <div className="min-w-0 space-y-6">
      <OpsSummaryStrip className="xl:grid-cols-4">
        <OpsMetricTile label="Active Alerts" value={summary.total} detail="Current alerts and incidents in the operational queue." />
        <OpsMetricTile label="Critical" value={summary.critical} detail="Alerts needing immediate operator attention." tone={summary.critical > 0 ? 'danger' : 'success'} />
        <OpsMetricTile label="Needs Review" value={summary.unacknowledged} detail="Signals still awaiting acknowledgement or ownership." tone={summary.unacknowledged > 0 ? 'warning' : 'success'} />
        <OpsMetricTile label="Acknowledged" value={summary.acknowledged} detail="Alerts with an active operator response already recorded." tone="info" />
      </OpsSummaryStrip>

      <OpsSection title="Incident Queue" description="Compact operational inbox for alert severity, remediation target, and acknowledgement state.">
        <OpsDataTable
          columns={[
            { key: 'severity', header: 'Severity', render: (row) => <OpsStatusBadge label={row.severity} tone={severityTone(row.severity)} /> },
            {
              key: 'alert',
              header: 'Alert',
              render: (row) => (
                <div>
                  <div className="font-medium">{row.title}</div>
                  <div className="text-xs text-muted-foreground">{row.summary}</div>
                </div>
              ),
            },
            { key: 'rule', header: 'Rule', render: (row) => row.rule.replace(/_/g, ' ') },
            { key: 'target', header: 'Target', render: (row) => row.href.replace(/^https?:\/\//, '') },
            { key: 'status', header: 'Status', render: (row) => <OpsStatusBadge label={row.acknowledged ? 'Acknowledged' : 'Open'} tone={row.acknowledged ? 'success' : 'warning'} /> },
            { key: 'updated', header: 'Updated', render: (row) => row.acknowledgedAt ? formatTimestamp(row.acknowledgedAt) : 'Awaiting acknowledgement' },
          ]}
          rows={alertsQuery.data.items}
          rowKey={(row) => row.id}
          onRowClick={handleOpenAlert}
          emptyTitle="No active alerts"
          emptyDescription="New parser spikes, failed logins, stalled sessions, and system incidents will appear here."
        />
      </OpsSection>

      <OpsDrawerInspector
        open={Boolean(selectedAlert)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedAlert(null)
            setAckNote('')
          }
        }}
        title={selectedAlert?.title || 'Alert detail'}
        subtitle={selectedAlert ? selectedAlert.rule.replace(/_/g, ' ') : 'Select an alert row'}
      >
        {selectedAlert ? (
          <div className="space-y-5">
            <OpsDefinitionList
              items={[
                { label: 'Severity', value: selectedAlert.severity },
                { label: 'Metric', value: String(selectedAlert.metric) },
                { label: 'Threshold', value: String(selectedAlert.threshold) },
                { label: 'State', value: selectedAlert.acknowledged ? 'Acknowledged' : 'Open' },
                { label: 'Ack By', value: selectedAlert.acknowledgedBy || 'Unassigned' },
                { label: 'Ack Time', value: formatTimestamp(selectedAlert.acknowledgedAt) },
              ]}
            />

            <div className="ops-subpanel">
              <div className="ops-subpanel-title">Summary</div>
              <p className="text-sm text-muted-foreground">{selectedAlert.summary}</p>
            </div>

            <div className="ops-subpanel">
              <div className="ops-subpanel-title">Remediation</div>
              <p className="text-sm text-muted-foreground">{selectedAlert.remediation}</p>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Acknowledgement note</div>
              <Textarea
                value={ackNote}
                onChange={(event) => setAckNote(event.target.value)}
                placeholder="Capture the current remediation step, assigned owner, or next action."
                rows={4}
                className="rounded-lg border-white/10 bg-[#0b0e14]"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" className="rounded-lg">
                <Link to={selectedAlert.href}>Open remediation target</Link>
              </Button>
              <Button type="button" className="rounded-lg" disabled={acknowledgeMutation.isPending} onClick={() => void handleConfirmAck()}>
                {acknowledgeMutation.isPending ? 'Saving…' : selectedAlert.acknowledged ? 'Update acknowledgement' : 'Acknowledge alert'}
              </Button>
            </div>
          </div>
        ) : (
          <OpsPageState compact title="No alert selected" description="Select an alert to inspect severity, remediation, and acknowledgement history." />
        )}
      </OpsDrawerInspector>

      <AdminRecentAuthDialog
        open={recentAuthOpen}
        onOpenChange={setRecentAuthOpen}
        title="Recent auth required"
        description="Acknowledging an alert is treated as an operational write. Re-authenticate before saving it."
        onSuccess={async () => {
          setRecentAuthOpen(false)
          await handleConfirmAck()
        }}
      />
    </div>
  )
}
