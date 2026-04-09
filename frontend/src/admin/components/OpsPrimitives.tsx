import type { ReactNode } from 'react'
import { AlertTriangle, ChevronRight, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

export function OpsPageState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div className={cn('ops-empty-state', compact && 'ops-empty-state-compact', className)}>
      <div className="ops-empty-icon">{icon || <AlertTriangle className="h-7 w-7" />}</div>
      <div className="ops-empty-title">{title}</div>
      <p className="ops-empty-copy">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
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
        <div className="min-w-0">
          <h3 className="ops-panel-title">{title}</h3>
          {description ? <p className="ops-panel-copy">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function OpsSummaryStrip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={cn('ops-summary-strip', className)}>{children}</section>
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="ops-metric-label">{label}</div>
          <div className="ops-metric-value">{value}</div>
        </div>
        {spark ? <div className="shrink-0">{spark}</div> : null}
      </div>
      {detail ? <div className="ops-metric-detail">{detail}</div> : null}
    </article>
  )
}

export function OpsToolbar({
  title,
  children,
  actions,
  className,
}: {
  title?: string
  children: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('ops-toolbar', className)}>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
        {title ? <div className="ops-toolbar-label">{title}</div> : null}
        {children}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
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
        <div className="min-w-0">
          <h4 className="ops-panel-title text-base">{title}</h4>
          {subtitle ? <p className="ops-panel-copy">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </aside>
  )
}

export function OpsDrawerInspector({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  widthClassName = 'sm:max-w-[28rem]',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  subtitle?: string
  children: ReactNode
  widthClassName?: string
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn('ops-drawer', widthClassName)}>
        <SheetHeader className="border-b border-border/60 px-5 py-4">
          <SheetTitle>{title}</SheetTitle>
          {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="px-5 py-5">{children}</div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
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
    <dl className="grid gap-2.5">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[128px_1fr] gap-3 border-b border-border/35 pb-2.5 last:border-b-0 last:pb-0">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{item.label}</dt>
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
  onRowClick?: (row: T, index: number) => void
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
              onClick={onRowClick ? () => onRowClick(row, index) : undefined}
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
    <OpsToolbar
      title={title}
      actions={onReset ? (
        <Button type="button" variant="ghost" onClick={onReset} className="rounded-lg">
          Reset
        </Button>
      ) : undefined}
    >
      {children}
    </OpsToolbar>
  )
}
