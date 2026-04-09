import { Bell, ChevronRight, Command, Lock, Search, ShieldCheck, UserCircle2 } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAdminAuthStore } from '../store/adminAuthStore'
import { primaryAdminNavigation, resolveAdminRouteMeta } from '../lib/navigation'
import { adminPaths, buildMainAppUrl } from '../lib/paths'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const resolveBreadcrumbs = (pathname: string) => {
  if (pathname === adminPaths.dashboard) return ['Dashboard']
  if (pathname.startsWith('/cases/')) return ['Cases', 'Case Detail']
  if (pathname.startsWith(adminPaths.cases)) return ['Cases']
  if (pathname.startsWith(adminPaths.ingestion)) return ['Ingestion Pipeline']
  if (pathname.startsWith(adminPaths.normalization)) return ['Normalization & Processing']
  if (pathname.startsWith(adminPaths.tableEditor)) return ['Table Editor']
  if (pathname.startsWith(adminPaths.database)) return ['Database']
  if (pathname.startsWith(adminPaths.users)) return ['Users & Roles']
  if (pathname.startsWith(adminPaths.audit)) return ['Audit Trail']
  if (pathname.startsWith(adminPaths.alerts)) return ['Alerts & Incidents']
  if (pathname.startsWith(adminPaths.settings)) return ['Settings']
  return ['Operations']
}

export default function AdminLayout() {
  const location = useLocation()
  const { admin, logout } = useAdminAuthStore()
  const [searchValue, setSearchValue] = useState('')
  const routeMeta = resolveAdminRouteMeta(location.pathname)
  const breadcrumbs = resolveBreadcrumbs(location.pathname)

  return (
    <div className="ops-app-shell">
      <aside className="ops-sidebar">
        <div className="ops-sidebar-brand">
          <div className="ops-sidebar-logo">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">SHAKTI</div>
            <div className="text-sm font-semibold text-slate-100">Operations Console</div>
          </div>
        </div>

        <div className="ops-sidebar-profile">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-slate-200">
              <UserCircle2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">{admin?.fullName || 'Admin user'}</div>
              <div className="truncate text-xs text-slate-400">{admin?.email || 'admin@shakti.local'}</div>
              <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                <Lock className="h-3 w-3" />
                {admin?.role || 'it_admin'}
              </div>
            </div>
          </div>
        </div>

        <nav className="space-y-1">
          {primaryAdminNavigation.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === adminPaths.dashboard}
              className={({ isActive }) =>
                cn('ops-sidebar-link', isActive && 'active')
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="ops-sidebar-note">
          The console is read-forward by default. Sensitive actions stay deliberate, gated, and fully auditable.
        </div>

        <div className="mt-auto space-y-3">
          <Button asChild variant="outline" className="w-full justify-start rounded-xl border-slate-800 bg-slate-900/80 text-slate-100 hover:bg-slate-800">
            <a href={buildMainAppUrl('/create-case')}>
              <Command className="h-4 w-4" />
              Create Case
            </a>
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start rounded-xl text-slate-300 hover:bg-slate-900 hover:text-white"
            onClick={() => void logout()}
          >
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="ops-topbar">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-1 items-center gap-3">
                <div className="relative max-w-xl flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={searchValue}
                    onChange={(event) => setSearchValue(event.target.value)}
                    placeholder="Search cases, uploads, jobs, users, logs, or trace IDs"
                    className="h-11 rounded-xl border-border/70 bg-card/80 pl-10"
                  />
                </div>
                <Button type="button" variant="outline" className="hidden rounded-xl lg:inline-flex">
                  <Command className="h-4 w-4" />
                  Open Command Panel
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="ops-header-badge">Production</span>
                <span className="ops-header-badge">HQ Intelligence Unit</span>
                <Button type="button" variant="ghost" size="icon" className="rounded-xl">
                  <Bell className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {breadcrumbs.map((crumb, index) => (
                <div key={crumb} className="flex items-center gap-2">
                  <span className={index === breadcrumbs.length - 1 ? 'text-foreground' : undefined}>{crumb}</span>
                  {index < breadcrumbs.length - 1 ? <ChevronRight className="h-3.5 w-3.5" /> : null}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{routeMeta.eyebrow}</div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">{routeMeta.title}</h1>
                <p className="max-w-3xl text-sm text-muted-foreground">{routeMeta.description}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="ops-header-badge">Traceability enforced</span>
                <span className="ops-header-badge">Read-only default</span>
              </div>
            </div>
          </div>
        </header>

        <div className="ops-page">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
