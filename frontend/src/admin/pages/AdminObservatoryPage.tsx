import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  BellRing,
  Database,
  FileWarning,
  HardDrive,
  LayoutDashboard,
  MonitorCog,
  ShieldCheck,
  ShieldAlert,
  Upload,
  Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { adminConsoleAPI } from '../lib/api'
import { adminPaths } from '../lib/paths'
import type { ActivityEvent, MonitoringQuickSignal, MonitoringStatusCard } from '../types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

const statusTone = (status?: string) => {
  if (status === 'pass' || status === 'ready' || status === 'alive') return 'text-emerald-700 dark:text-emerald-300'
  if (status === 'fail' || status === 'not_ready') return 'text-red-700 dark:text-red-300'
  return 'text-amber-700 dark:text-amber-300'
}

const severityClass: Record<string, string> = {
  critical: 'border-red-300/40 bg-red-50 text-red-900 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-100',
  warning: 'border-amber-300/40 bg-amber-50 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100',
  info: 'border-blue-300/40 bg-blue-50 text-blue-900 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-100',
}

const signalToneClass: Record<string, string> = {
  positive: 'border-emerald-300/40 bg-emerald-50 text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-200',
  warning: 'border-amber-300/40 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200',
  critical: 'border-red-300/40 bg-red-50 text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200',
  neutral: 'border-border/70 bg-card/60 text-muted-foreground',
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string | number
  detail: string
  icon: typeof Users
}) {
  return (
    <article className="rounded-[1.5rem] border border-border/70 bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-sm font-medium text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-semibold">{value}</div>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white dark:bg-white dark:text-slate-900">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <div className="mt-3 text-sm text-muted-foreground">{detail}</div>
    </article>
  )
}

function MonitoringCard({ card }: { card: MonitoringStatusCard }) {
  return (
    <article className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{card.label}</div>
          <div className={`mt-2 text-2xl font-semibold capitalize ${statusTone(card.status)}`}>{card.status}</div>
        </div>
        <Badge variant="outline" className="rounded-full px-3 py-1">
          {card.metric}
        </Badge>
      </div>
      <div className="mt-3 text-sm text-muted-foreground">{card.detail}</div>
    </article>
  )
}

function QuickSignalCard({ signal }: { signal: MonitoringQuickSignal }) {
  return (
    <article className={`rounded-[1rem] border px-4 py-4 ${signalToneClass[signal.tone] || signalToneClass.neutral}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.16em]">{signal.label}</div>
      <div className="mt-2 text-sm font-medium">{signal.value}</div>
    </article>
  )
}

export default function AdminObservatoryPage() {
  const [selectedEvent, setSelectedEvent] = useState<ActivityEvent | null>(null)

  const observatoryQuery = useQuery({
    queryKey: ['admin-observatory'],
    queryFn: () => adminConsoleAPI.getObservatory(),
    refetchInterval: 30000,
  })

  const metricCards = useMemo(() => {
    const summary = observatoryQuery.data?.summary
    if (!summary) return []

    return [
      {
        key: 'officers',
        label: 'Active Officers',
        value: summary.activeOfficers,
        detail: `${summary.activeOfficerSessions} live officer sessions`,
        icon: Users,
      },
      {
        key: 'admins',
        label: 'Active Admins',
        value: summary.activeAdmins,
        detail: `${summary.activeAdminSessions} live admin sessions`,
        icon: ShieldCheck,
      },
      {
        key: 'cases',
        label: 'Open Cases',
        value: summary.openCases,
        detail: 'Operational case workload currently open or active',
        icon: LayoutDashboard,
      },
      {
        key: 'uploads',
        label: 'Uploads Today',
        value: summary.uploadsToday,
        detail: 'Files uploaded since the start of today',
        icon: Upload,
      },
      {
        key: 'failures',
        label: 'Failed Jobs',
        value: summary.failedJobs,
        detail: 'Current failed or degraded ingestion jobs',
        icon: FileWarning,
      },
      {
        key: 'database',
        label: 'Database',
        value: summary.databaseStatus.toUpperCase(),
        detail: 'Current database/readiness signal from the platform',
        icon: Database,
      },
    ]
  }, [observatoryQuery.data?.summary])

  if (observatoryQuery.isLoading) {
    return <div className="page-loading">Loading observatory...</div>
  }

  if (observatoryQuery.isError || !observatoryQuery.data) {
    return (
      <div className="page-error">
        <AlertTriangle className="h-8 w-8" />
        <div>Failed to load the observatory.</div>
      </div>
    )
  }

  const payload = observatoryQuery.data

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] border border-border/70 bg-card p-6 shadow-[0_24px_70px_rgba(10,19,51,0.08)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl space-y-2">
            <div className="inline-flex rounded-full border border-emerald-300/40 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
              Observatory
            </div>
            <h2 className="text-3xl font-semibold tracking-tight">Operational visibility for SHAKTI in one simple workspace.</h2>
            <p className="text-base leading-7 text-muted-foreground">
              Monitor active officers, sessions, case movement, uploads, alerts, and platform health without jumping across a crowded set of admin pages.
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 xl:items-end">
            <div className="text-sm text-muted-foreground">Snapshot refreshed {formatTimestamp(payload.generatedAt)}</div>
            <div className={`text-sm font-semibold uppercase tracking-[0.18em] ${statusTone(payload.health.overallStatus)}`}>
              Platform status: {payload.health.overallStatus}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metricCards.map((card) => (
          <MetricCard key={card.key} label={card.label} value={card.value} detail={card.detail} icon={card.icon} />
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Attention Center</h3>
              <p className="mt-1 text-sm text-muted-foreground">Active warnings and operational issues that need review.</p>
            </div>
            <Link to={adminPaths.alerts} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
              Open legacy alerts
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {payload.attention.length === 0 ? (
              <div className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-5 text-sm text-muted-foreground">
                No active alerts right now.
              </div>
            ) : (
              payload.attention.map((item) => (
                <Link key={item.id} to={item.href} className={`block rounded-[1.25rem] border px-4 py-4 transition hover:opacity-90 ${severityClass[item.severity] || severityClass.info}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{item.title}</div>
                      <div className="mt-1 text-sm opacity-90">{item.summary}</div>
                    </div>
                    {item.acknowledged ? <Badge className="rounded-full bg-emerald-600 text-white">Ack</Badge> : null}
                  </div>
                </Link>
              ))
            )}
          </div>
        </article>

        <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Live Activity Feed</h3>
              <p className="mt-1 text-sm text-muted-foreground">Recent officer and admin actions flowing through the product.</p>
            </div>
            <Link to={adminPaths.activity} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
              Open legacy activity
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {payload.activity.length === 0 ? (
              <div className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-5 text-sm text-muted-foreground">
                No recent activity recorded yet.
              </div>
            ) : (
              payload.activity.map((event) => (
                <button
                  key={`${event.source}-${event.id}`}
                  type="button"
                  onClick={() => setSelectedEvent(event)}
                  className="flex w-full items-start justify-between gap-3 rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-4 text-left transition hover:border-blue-300/40"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="rounded-full">{event.source}</Badge>
                      <Badge variant="outline" className="rounded-full">{event.actor_type}</Badge>
                    </div>
                    <div className="mt-2 font-medium">{event.action}</div>
                    <div className="mt-1 truncate text-sm text-muted-foreground">
                      {event.actor_name || 'Unknown actor'} {event.resource_type ? `• ${event.resource_type}` : ''} {event.resource_id ? `• ${event.resource_id}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-xs text-muted-foreground">{formatTimestamp(event.created_at)}</div>
                </button>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="rounded-[1.75rem] border border-border/70 bg-card p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-xl font-semibold">Platform Monitoring</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              A simple full-stack view of backend, frontend, API, and ingestion health without turning the console into a complicated observability product.
            </p>
          </div>
          <Link to={adminPaths.system} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
            Open legacy diagnostics
          </Link>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MonitoringCard card={payload.monitoring.backend} />
          <MonitoringCard card={payload.monitoring.frontend} />
          <MonitoringCard card={payload.monitoring.api} />
          <MonitoringCard card={payload.monitoring.pipeline} />
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-[1fr_0.9fr]">
          <article className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-lg font-semibold">Active Flags & Issues</h4>
              <Badge variant="outline" className="rounded-full px-3 py-1">{payload.monitoring.flags.length}</Badge>
            </div>

            <div className="mt-3 space-y-3">
              {payload.monitoring.flags.length === 0 ? (
                <div className="rounded-[1rem] border border-border/70 bg-background/60 px-4 py-4 text-sm text-muted-foreground">
                  No active issue flags are elevated right now.
                </div>
              ) : (
                payload.monitoring.flags.map((flag) => (
                  <Link key={flag.id} to={flag.href} className={`block rounded-[1rem] border px-4 py-4 ${severityClass[flag.severity] || severityClass.info}`}>
                    <div className="font-medium">{flag.title}</div>
                    <div className="mt-1 text-sm opacity-90">{flag.summary}</div>
                  </Link>
                ))
              )}
            </div>
          </article>

          <article className="rounded-[1.25rem] border border-border/70 bg-card/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-lg font-semibold">Quick Signals</h4>
              <MonitorCog className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <QuickSignalCard signal={payload.monitoring.quickSignals.lastDeploy} />
              <QuickSignalCard signal={payload.monitoring.quickSignals.lastSelfCheck} />
              <QuickSignalCard signal={payload.monitoring.quickSignals.alertCount} />
              <QuickSignalCard signal={payload.monitoring.quickSignals.errorTrend} />
              <QuickSignalCard signal={payload.monitoring.quickSignals.featureFlags} />
            </div>
          </article>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Users & Sessions</h3>
              <p className="mt-1 text-sm text-muted-foreground">A simple view of who is online and which sessions need review.</p>
            </div>
            <Link to={adminPaths.users} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
              Open legacy session control
            </Link>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricCard label="Officers Online" value={payload.sessions.officersOnline} detail="Distinct officers with active sessions" icon={Users} />
            <MetricCard label="Admins Online" value={payload.sessions.adminsOnline} detail="Distinct internal admins with active sessions" icon={ShieldCheck} />
            <MetricCard label="Stale Sessions" value={payload.sessions.staleSessionCount} detail="Sessions exceeding the stale-session threshold" icon={ShieldAlert} />
          </div>

          <div className="mt-4 space-y-3">
            {payload.sessions.activeSessions.map((session) => (
              <div key={`${session.session_type}-${session.id}`} className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{session.actor_name}</div>
                      <Badge variant="outline" className="rounded-full">{session.session_type}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{session.actor_email}</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Started {formatTimestamp(session.started_at)} • {session.ip_address || 'No IP'} • {Math.max(Math.floor(session.session_age_seconds / 60), 0)}m age
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Case Operations</h3>
              <p className="mt-1 text-sm text-muted-foreground">Current case workload, locks, and recently updated investigations.</p>
            </div>
            <Link to={adminPaths.cases} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
              Open legacy case view
            </Link>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MetricCard label="Total Cases" value={payload.cases.totalCases} detail="All cases currently tracked in SHAKTI" icon={LayoutDashboard} />
            <MetricCard label="Evidence Locked" value={payload.cases.lockedCases} detail="Cases currently under lock control" icon={ShieldCheck} />
            <MetricCard label="High Priority" value={payload.cases.highPriorityCases} detail="High and critical investigation workload" icon={AlertTriangle} />
          </div>

          <div className="mt-4 space-y-3">
            {payload.cases.recentCases.map((item) => (
              <div key={item.id} className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{item.case_name}</div>
                      <Badge variant="outline" className="rounded-full">{item.status}</Badge>
                      <Badge variant="outline" className="rounded-full">{item.priority}</Badge>
                      {item.is_evidence_locked ? <Badge className="rounded-full bg-amber-600 text-white">Locked</Badge> : null}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{item.case_number}</div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Owner {item.owner_name || 'Unknown'} {item.owner_buckle_id ? `• ${item.owner_buckle_id}` : ''} • Updated {formatTimestamp(item.updated_at)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">File Operations</h3>
              <p className="mt-1 text-sm text-muted-foreground">Uploads, parse failures, deletions, and ingestion pressure in one panel.</p>
            </div>
            <Link to={adminPaths.files} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
              Open legacy files view
            </Link>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <MetricCard label="Total Files" value={payload.files.totalFiles} detail="Uploaded records available across cases" icon={HardDrive} />
            <MetricCard label="Failed Parse" value={payload.files.failedParseFiles} detail="Files that currently need parsing attention" icon={FileWarning} />
            <MetricCard label="Deletes Today" value={payload.files.totalDeletions} detail="File deletions recorded today" icon={BellRing} />
            <MetricCard label="Processing Jobs" value={payload.files.processingJobs} detail="Queued or actively processing ingestion jobs" icon={Activity} />
          </div>

          <div className="mt-4 space-y-3">
            {payload.files.recentFiles.map((item) => (
              <div key={item.id} className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{item.original_name || item.file_name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {item.case_name || 'Unlinked case'} {item.case_number ? `• ${item.case_number}` : ''} • {item.telecom_module}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      {item.parse_status} • Uploaded {formatTimestamp(item.uploaded_at)}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-semibold">Health Snapshot</h3>
              <p className="mt-1 text-sm text-muted-foreground">Backend, database, storage, backup, restore, and self-check visibility in one glance.</p>
            </div>
            <Link to={adminPaths.system} className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
              Open legacy health view
            </Link>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <article className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Backend</div>
              <div className={`mt-2 text-2xl font-semibold capitalize ${statusTone(payload.health.backend.ready.status)}`}>
                {payload.health.backend.ready.status}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">Readiness signal from system diagnostics</div>
            </article>

            <article className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Database</div>
              <div className={`mt-2 text-2xl font-semibold ${statusTone(payload.health.database.status)}`}>
                {payload.health.database.connected ? 'Connected' : 'Unavailable'}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">{payload.health.database.latencyMs || 0} ms</div>
            </article>

            <article className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Backups</div>
              <div className={`mt-2 text-2xl font-semibold capitalize ${statusTone(payload.health.backups.status)}`}>{payload.health.backups.status}</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Latest backup {formatTimestamp((payload.health.backups.latestBackup?.completedAt as string | undefined) || (payload.health.backups.latestBackup?.timestamp as string | undefined) || null)}
              </div>
            </article>

            <article className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Restore</div>
              <div className={`mt-2 text-2xl font-semibold capitalize ${statusTone(payload.health.backups.status)}`}>
                {(payload.health.backups.latestRestore && 'Available') || 'Unknown'}
              </div>
              <div className="mt-2 text-sm text-muted-foreground">
                Latest restore {formatTimestamp((payload.health.backups.latestRestore?.completedAt as string | undefined) || (payload.health.backups.latestRestore?.timestamp as string | undefined) || null)}
              </div>
            </article>
          </div>
        </article>
      </section>

      <Dialog open={Boolean(selectedEvent)} onOpenChange={(open: boolean) => !open && setSelectedEvent(null)}>
        <DialogContent className="max-w-2xl rounded-[1.75rem]">
          {selectedEvent ? (
            <>
              <DialogHeader>
                <DialogTitle>Activity Event Detail</DialogTitle>
                <DialogDescription>
                  Review the event payload without leaving the observatory.
                </DialogDescription>
              </DialogHeader>

              <div className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-full">{selectedEvent.source}</Badge>
                  <Badge variant="outline" className="rounded-full">{selectedEvent.actor_type}</Badge>
                  <Badge variant="outline" className="rounded-full">{selectedEvent.action}</Badge>
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  {selectedEvent.actor_name || 'Unknown actor'} • {formatTimestamp(selectedEvent.created_at)}
                </div>
              </div>

              <pre className="max-h-[50vh] overflow-auto rounded-[1.25rem] border border-border/70 bg-slate-950 p-4 text-xs text-slate-100 whitespace-pre-wrap break-words">
                {JSON.stringify(selectedEvent, null, 2)}
              </pre>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSelectedEvent(null)}>
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
