import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  AlertTriangle,
  Database,
  FileWarning,
  Lock,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AdminHealthCheck } from '../types'
import { adminConsoleAPI } from '../lib/api'

const severityClasses = {
  warning: 'border-amber-300/50 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200',
  critical: 'border-red-300/50 bg-red-50 text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200',
  info: 'border-blue-300/50 bg-blue-50 text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200',
}

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

export default function AdminOverviewPage() {
  const overviewQuery = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => adminConsoleAPI.getOverview(),
    refetchInterval: 30000,
  })

  const metrics = overviewQuery.data?.metrics
  const health = overviewQuery.data?.health
  const recentActivity = overviewQuery.data?.recentActivity || []
  const attention = overviewQuery.data?.attention || []

  const metricCards = useMemo(() => {
    if (!metrics) return []

    return [
      {
        key: 'activeOfficerSessions',
        label: 'Officer Sessions',
        value: metrics.activeOfficerSessions,
        detail: 'Currently active officer sessions',
        icon: Users,
      },
      {
        key: 'activeAdminSessions',
        label: 'Admin Sessions',
        value: metrics.activeAdminSessions,
        detail: 'Authenticated IT/admin console sessions',
        icon: ShieldCheck,
      },
      {
        key: 'openCases',
        label: 'Open Cases',
        value: metrics.openCases,
        detail: 'Cases still active in operational workflows',
        icon: Database,
      },
      {
        key: 'evidenceLockedCases',
        label: 'Evidence Locked',
        value: metrics.evidenceLockedCases,
        detail: 'Cases with evidence lock currently enabled',
        icon: Lock,
      },
      {
        key: 'uploadsToday',
        label: 'Uploads Today',
        value: metrics.uploadsToday,
        detail: 'Files ingested since the start of today',
        icon: Upload,
      },
      {
        key: 'fileDeletionsToday',
        label: 'Deletes Today',
        value: metrics.fileDeletionsToday,
        detail: 'File deletions recorded in audit logs today',
        icon: FileWarning,
      },
      {
        key: 'failedLogins',
        label: 'Failed Logins',
        value: metrics.failedOfficerLogins + metrics.failedAdminLogins,
        detail: `${metrics.failedOfficerLogins} officer and ${metrics.failedAdminLogins} admin accounts have pending failed attempts`,
        icon: AlertTriangle,
      },
      {
        key: 'recentAdminActions',
        label: 'Admin Actions',
        value: metrics.recentAdminActions,
        detail: 'Admin action log volume in the last 24 hours',
        icon: Activity,
      },
    ]
  }, [metrics])

  const backupCheck = health?.startup?.checks?.backups as AdminHealthCheck | undefined

  const healthCards = useMemo(
    () => [
      {
        label: 'Backend live',
        value: health?.live?.status || 'unknown',
        detail: `Checked ${formatTimestamp(health?.live?.timestamp || null)}`,
      },
      {
        label: 'Readiness',
        value: health?.ready?.status || 'unknown',
        detail: health?.databaseConnected ? 'Database connectivity confirmed' : 'Database readiness check failed',
      },
      {
        label: 'Startup',
        value: health?.startup?.status || 'unknown',
        detail: `Server time ${formatTimestamp(health?.serverTime || null)}`,
      },
      {
        label: 'Backups',
        value: backupCheck?.status || 'unknown',
        detail: typeof backupCheck?.detail === 'string' ? backupCheck.detail : 'No backup metadata available yet.',
      },
    ],
    [backupCheck?.detail, backupCheck?.status, health]
  )

  if (overviewQuery.isLoading) {
    return <div className="page-loading">Loading admin overview...</div>
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div className="page-error">
        <AlertTriangle className="h-8 w-8" />
        <div>Failed to load the admin overview.</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[2rem] border border-border/70 bg-card p-6 shadow-[0_24px_70px_rgba(10,19,51,0.08)]">
        <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex rounded-full border border-emerald-300/40 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
              Phase 2 Live
            </div>
            <h2 className="text-3xl font-semibold tracking-tight">Operational visibility for sessions, activity, and health.</h2>
            <p className="text-base leading-7 text-muted-foreground">
              IT can now see who is active, what activity is flowing through the system, and whether backend readiness checks are healthy enough for daily operations.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <Link
              to="/admin/activity"
              className="rounded-[1.5rem] border border-border/70 bg-card/60 px-4 py-4 transition hover:border-blue-300/40 hover:bg-card"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Global feed</div>
              <div className="mt-2 text-lg font-semibold">Investigate activity</div>
              <div className="mt-2 text-sm text-muted-foreground">Search actors, sessions, IPs, and raw audit details.</div>
            </Link>
            <Link
              to="/admin/users"
              className="rounded-[1.5rem] border border-border/70 bg-card/60 px-4 py-4 transition hover:border-blue-300/40 hover:bg-card"
            >
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Session control</div>
              <div className="mt-2 text-lg font-semibold">Review users and sessions</div>
              <div className="mt-2 text-sm text-muted-foreground">Track live usage and force logout suspicious sessions.</div>
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metricCards.map(({ key, label, value, detail, icon: Icon }) => (
          <article key={key} className="rounded-[1.5rem] border border-border/70 bg-card p-5">
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
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-semibold">Needs Attention</h3>
            <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{attention.length} items</span>
          </div>
          <div className="mt-4 space-y-3">
            {attention.length === 0 ? (
              <div className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-5 text-sm text-muted-foreground">
                No urgent IT attention items right now.
              </div>
            ) : (
              attention.map((item) => (
                <Link
                  key={item.id}
                  to={item.href}
                  className={`block rounded-[1.25rem] border px-4 py-4 transition hover:opacity-90 ${severityClasses[item.severity]}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{item.title}</div>
                      <div className="mt-1 text-sm opacity-90">{item.description}</div>
                    </div>
                    <div className="rounded-full bg-white/60 px-2.5 py-1 text-xs font-semibold dark:bg-black/20">{item.count}</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </article>

        <article className="rounded-[1.75rem] border border-border/70 bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-xl font-semibold">Recent Activity</h3>
            <Link to="/admin/activity" className="text-sm font-medium text-blue-700 hover:underline dark:text-blue-300">
              Open full feed
            </Link>
          </div>
          <div className="mt-4 space-y-3">
            {recentActivity.length === 0 ? (
              <div className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-5 text-sm text-muted-foreground">
                No recent activity recorded yet.
              </div>
            ) : (
              recentActivity.map((event) => (
                <div key={`${event.source}-${event.id}`} className="rounded-[1.25rem] border border-border/70 bg-card/60 px-4 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {event.source}
                    </span>
                    <span className="rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      {event.actor_type}
                    </span>
                    <span className="text-sm font-semibold">{event.action}</span>
                  </div>
                  <div className="mt-2 text-sm text-muted-foreground">
                    {event.actor_name || 'Unknown'} • {event.resource_type || 'resource'} {event.resource_id || 'n/a'}
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {formatTimestamp(event.created_at)} {event.ip_address ? `• ${event.ip_address}` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {healthCards.map((card) => (
          <article key={card.label} className="rounded-[1.5rem] border border-border/70 bg-card p-5">
            <div className="text-sm font-medium text-muted-foreground">{card.label}</div>
            <div className="mt-2 text-2xl font-semibold capitalize">{card.value}</div>
            <div className="mt-2 text-sm text-muted-foreground">{card.detail}</div>
          </article>
        ))}
      </section>
    </div>
  )
}
