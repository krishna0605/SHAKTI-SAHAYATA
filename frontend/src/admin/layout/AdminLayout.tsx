import { ChevronRight, ChevronLeft, PanelLeftClose, Plus, Search, ShieldCheck, UserCircle2 } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { useAdminAuthStore } from '../store/adminAuthStore'
import { primaryAdminNavigation, resolveAdminRouteMeta } from '../lib/navigation'
import { adminPaths, buildMainAppUrl } from '../lib/paths'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const SIDEBAR_STORAGE_KEY = 'shakti-admin-sidebar-collapsed'

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
  const [collapsed, setCollapsed] = useState(false)
  const routeMeta = resolveAdminRouteMeta(location.pathname)
  const breadcrumbs = resolveBreadcrumbs(location.pathname)

  useEffect(() => {
    if (typeof window === 'undefined') return
    setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed))
  }, [collapsed])

  const pageAction = useMemo(() => {
    if (location.pathname === adminPaths.dashboard || location.pathname.startsWith(adminPaths.cases)) {
      return (
        <Button asChild className="rounded-lg bg-white text-slate-950 hover:bg-slate-200">
          <a href={buildMainAppUrl('/create-case')}>
            <Plus className="h-4 w-4" />
            Create Case
          </a>
        </Button>
      )
    }

    return null
  }, [location.pathname])

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className="ops-app-shell"
        style={{ gridTemplateColumns: collapsed ? '72px minmax(0, 1fr)' : '256px minmax(0, 1fr)' }}
      >
        <aside className={cn('ops-sidebar', collapsed && 'collapsed')}>
          <div className="ops-sidebar-inner">
            <div className="ops-sidebar-brand">
              <div className="ops-sidebar-logo">
                <ShieldCheck className="h-4 w-4" />
              </div>
              {!collapsed ? (
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-500">SHAKTI</div>
                  <div className="text-sm font-semibold text-slate-100">Operations Console</div>
                </div>
              ) : null}
            </div>

            <div className="ops-sidebar-profile">
              <div className={cn('flex items-center gap-3', collapsed && 'justify-center')}>
                <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-200">
                  <UserCircle2 className="h-5 w-5" />
                </div>
                {!collapsed ? (
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-white">{admin?.fullName || 'Admin user'}</div>
                    <div className="truncate text-xs uppercase tracking-[0.18em] text-slate-500">{admin?.role || 'it_admin'}</div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="ops-sidebar-scroll">
              {!collapsed ? <div className="ops-sidebar-group-label">Operations</div> : null}
              <div className="space-y-1.5">
                {primaryAdminNavigation.map(({ label, to, icon: Icon }) => (
                  <Tooltip key={to}>
                    <TooltipTrigger asChild>
                      <NavLink
                        to={to}
                        end={to === adminPaths.dashboard}
                        className={({ isActive }) => cn('ops-sidebar-link', isActive && 'active', collapsed && 'is-collapsed')}
                      >
                        <span className="ops-sidebar-link-icon">
                          <Icon className="h-[1.1rem] w-[1.1rem] shrink-0" />
                        </span>
                        {!collapsed ? <span className="ops-sidebar-link-label">{label}</span> : null}
                      </NavLink>
                    </TooltipTrigger>
                    {collapsed ? <TooltipContent side="right">{label}</TooltipContent> : null}
                  </Tooltip>
                ))}
              </div>
            </div>

            <div className="ops-sidebar-footer">
              {collapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ops-sidebar-icon-toggle"
                      onClick={() => setCollapsed(false)}
                      aria-label="Expand sidebar"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Expand sidebar</TooltipContent>
                </Tooltip>
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="ops-sidebar-toggle justify-between px-3"
                      onClick={() => setCollapsed(true)}
                    >
                      <PanelLeftClose className="h-4 w-4" />
                      <span>Collapse sidebar</span>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="right">Collapse sidebar</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>
        </aside>

        <main className="ops-main-shell">
          <div className="ops-main-scroll">
            <header className="ops-topbar">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-1 items-center gap-3">
                    <div className="relative max-w-xl flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={searchValue}
                        onChange={(event) => setSearchValue(event.target.value)}
                        placeholder="Search cases, uploads, jobs, users, or logs"
                        className="h-10 rounded-lg border-white/10 bg-white/[0.03] pl-10 text-slate-100 placeholder:text-slate-500"
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {pageAction}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" className="rounded-lg border border-white/10 bg-white/[0.03] px-3 text-slate-100 hover:bg-white/[0.06]">
                          <UserCircle2 className="h-4 w-4" />
                          <span className="hidden sm:inline">{admin?.fullName || 'Admin'}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem onClick={() => void logout()}>Sign Out</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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

                <div className="space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">{routeMeta.eyebrow}</div>
                  <div className="flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
                    <div>
                      <h1 className="text-[1.75rem] font-semibold tracking-tight text-foreground">{routeMeta.title}</h1>
                      <p className="max-w-3xl text-sm text-muted-foreground">{routeMeta.description}</p>
                    </div>
                  </div>
                </div>
              </div>
            </header>

            <div className="ops-page">
              <Outlet />
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}
