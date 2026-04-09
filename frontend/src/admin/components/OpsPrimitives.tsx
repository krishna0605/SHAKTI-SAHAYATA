import type { ReactNode } from 'react'
import { AlertTriangle, ChevronRight, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export function OpsPageState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="ops-empty-state">
      <div className="ops-empty-icon">{icon || <AlertTriangle className="h-7 w-7" />}</div>
      <div className="ops-empty-title">{title}</div>
      <p className="ops-empty-copy">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function OpsSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('ops-panel', className)}>
      <div className="ops-panel-header">
        <div>
          <h3 className="ops-panel-title">{title}</h3>
          {description ? <p className="ops-panel-copy">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function OpsMetricTile({
  label,
  value,
  detail,
  tone = 'neutral',
  spark,
}: {
  label: string
  value: ReactNode
  detail?: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  spark?: ReactNode
}) {
  return (
    <article className={cn('ops-metric-tile', `ops-tone-${tone}`)}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="ops-metric-label">{label}</div>
          <div className="ops-metric-value">{value}</div>
        </div>
        {spark ? <div className="min-w-[72px]">{spark}</div> : null}
      </div>
      {detail ? <div className="ops-metric-detail">{detail}</div> : null}
    </article>
  )
}

export function OpsStatusBadge({
  label,
  tone = 'neutral',
  mono = false,
}: {
  label: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
  mono?: boolean
}) {
  return (
    <span className={cn('ops-status-badge', `ops-tone-${tone}`, mono && 'font-mono')}>
      {label}
    </span>
  )
}

export function OpsEntityChip({
  label,
  href,
  tone = 'neutral',
}: {
  label: string
  href?: string
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info'
}) {
  if (href) {
    return (
      <Link to={href} className={cn('ops-entity-chip', `ops-tone-${tone}`)}>
        <span>{label}</span>
        <ChevronRight className="h-3.5 w-3.5" />
      </Link>
    )
  }

  return <span className={cn('ops-entity-chip', `ops-tone-${tone}`)}>{label}</span>
}

export function OpsInspector({
  title,
  subtitle,
  children,
  action,
  className,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <aside className={cn('ops-inspector', className)}>
      <div className="ops-panel-header">
        <div>
          <h4 className="ops-panel-title text-base">{title}</h4>
          {subtitle ? <p className="ops-panel-copy">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </aside>
  )
}

export function OpsDefinitionList({
  items,
  monoKeys = [],
}: {
  items: Array<{ label: string; value: ReactNode }>
  monoKeys?: string[]
}) {
  return (
    <dl className="grid gap-3">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[140px_1fr] gap-3 border-b border-border/40 pb-3 last:border-b-0 last:pb-0">
          <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</dt>
          <dd className={cn('text-sm text-foreground', monoKeys.includes(item.label) && 'font-mono text-[12px]')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function OpsTimeline({
  items,
}: {
  items: Array<{ id: string; title: string; detail?: string; meta?: string; tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }>
}) {
  if (!items.length) {
    return (
      <OpsPageState
        icon={<ShieldAlert className="h-7 w-7" />}
        title="No timeline entries"
        description="Timeline events will appear here when the selected object receives uploads, processing activity, comments, or audit updates."
      />
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="ops-timeline-item">
          <div className={cn('ops-timeline-dot', `ops-tone-${item.tone || 'neutral'}`)} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium text-foreground">{item.title}</div>
              {item.meta ? <Badge variant="outline" className="rounded-full px-2 py-0 text-[11px]">{item.meta}</Badge> : null}
            </div>
            {item.detail ? <div className="mt-1 text-sm text-muted-foreground">{item.detail}</div> : null}
          </div>
        </div>
      ))}
    </div>
  )
}

export interface DataColumn<T> {
  key: string
  header: string
  className?: string
  render: (row: T) => ReactNode
}

export function OpsDataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyTitle = 'No records available',
  emptyDescription = 'There are no records matching the current filter state.',
  stickyHeader = true,
}: {
  columns: DataColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyDescription?: string
  stickyHeader?: boolean
}) {
  if (!rows.length) {
    return <OpsPageState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="ops-table-shell">
      <table className="ops-table">
        <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey(row, index)}
              className={onRowClick ? 'cursor-pointer' : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.className}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function OpsFilterBar({
  title,
  children,
  onReset,
}: {
  title?: string
  children: ReactNode
  onReset?: () => void
}) {
  return (
    <div className="ops-filter-bar">
      <div className="flex items-center gap-3">
        {title ? <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{title}</div> : null}
        <div className="flex flex-wrap items-center gap-3">{children}</div>
      </div>
      {onReset ? (
        <Button type="button" variant="ghost" onClick={onReset} className="rounded-xl">
          Reset filters
        </Button>
      ) : null}
    </div>
  )
}
