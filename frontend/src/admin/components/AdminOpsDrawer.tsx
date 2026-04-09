import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, ExternalLink, RefreshCcw, ShieldAlert, ShieldCheck, ShieldEllipsis, TimerReset, Workflow } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { adminConsoleAPI } from '../lib/api'
import { adminPaths } from '../lib/paths'
import { useAdminAuthStore } from '../store/adminAuthStore'
import AdminRecentAuthDialog from './AdminRecentAuthDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const formatTimestamp = (value?: string | null) => {
  if (!value) return 'Unknown'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString()
}

const statusTone = (status?: string) => {
  if (status === 'pass' || status === 'ready') return 'text-emerald-700 dark:text-emerald-300'
  if (status === 'fail' || status === 'not_ready') return 'text-red-700 dark:text-red-300'
  return 'text-amber-700 dark:text-amber-300'
}

type ExportAction = () => Promise<void>

export default function AdminOpsDrawer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const admin = useAdminAuthStore((state) => state.admin)
  const [reason, setReason] = useState('Operational review')
  const [recentAuthOpen, setRecentAuthOpen] = useState(false)

  const systemHealthQuery = useQuery({
    queryKey: ['admin-system-health'],
    queryFn: () => adminConsoleAPI.getSystemHealth(),
    enabled: open,
    staleTime: 30000,
  })

  const exportHistoryQuery = useQuery({
    queryKey: ['admin-export-history', 6],
    queryFn: () => adminConsoleAPI.getExportHistory(6),
    enabled: open,
    staleTime: 30000,
  })

  const selfCheckMutation = useMutation({
    mutationFn: () => adminConsoleAPI.runSystemSelfCheck(),
    onSuccess: async (payload) => {
      toast.success(`System self-check completed with status ${payload.status}.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-system-health'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-observatory'] }),
      ])
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Failed to run system self-check.'
      toast.error(message)
    },
  })

  const securityCards = useMemo(() => {
    const security = systemHealthQuery.data?.security
    if (!security) return []

    return [
      { label: 'TOTP', icon: ShieldCheck, block: security.totp, detail: security.totp.detail },
      { label: 'Session Rotation', icon: TimerReset, block: security.sessionRotation, detail: security.sessionRotation.detail },
      { label: 'Network Restriction', icon: Workflow, block: security.networkRestriction, detail: security.networkRestriction.detail },
      { label: 'Recent Auth', icon: ShieldEllipsis, block: security.recentAuth, detail: security.recentAuth.detail },
    ]
  }, [systemHealthQuery.data?.security])

  const runExport = async (label: string, action: ExportAction) => {
    try {
      await action()
      toast.success(`${label} export started.`)
      await queryClient.invalidateQueries({ queryKey: ['admin-export-history'] })
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to export ${label.toLowerCase()}.`
      toast.error(message)
      if (/recent auth|reauth|re-auth|refresh recent admin authentication/i.test(message)) {
        setRecentAuthOpen(true)
      }
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full max-w-[34rem] gap-0 overflow-hidden border-l border-border/70 bg-background/95 p-0 sm:max-w-[34rem]">
          <SheetHeader className="border-b border-border/70 px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Badge variant="outline" className="rounded-full px-3 py-1">Ops Drawer</Badge>
                <SheetTitle>Actions, exports, and security controls</SheetTitle>
                <SheetDescription>
                  Sensitive operations stay available here without taking over the main observatory workflow.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <Tabs defaultValue="actions" className="space-y-4">
              <TabsList className="h-auto w-full rounded-[1rem] p-1">
                <TabsTrigger value="actions" className="rounded-xl px-4 py-2">Actions</TabsTrigger>
                <TabsTrigger value="exports" className="rounded-xl px-4 py-2">Exports</TabsTrigger>
                <TabsTrigger value="security" className="rounded-xl px-4 py-2">Security</TabsTrigger>
              </TabsList>

              <TabsContent value="actions" className="space-y-4">
                <article className="rounded-[1.5rem] border border-border/70 bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold">Run self-check</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Trigger the existing Phase 5 diagnostic flow and refresh observatory health signals.
                      </div>
                    </div>
                    <RefreshCcw className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <Button
                    type="button"
                    className="mt-4"
                    onClick={() => selfCheckMutation.mutate()}
                    disabled={selfCheckMutation.isPending}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    {selfCheckMutation.isPending ? 'Running…' : 'Run Self-Check'}
                  </Button>
                </article>

                <article className="rounded-[1.5rem] border border-border/70 bg-card p-5">
                  <div className="text-lg font-semibold">Legacy deep views</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    The simplified console keeps detailed workflows available during the soft migration.
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      { to: adminPaths.system, label: 'System Diagnostics' },
                      { to: adminPaths.alerts, label: 'Alert Queue' },
                      { to: adminPaths.users, label: 'Session Control' },
                      { to: adminPaths.activity, label: 'Full Activity Feed' },
                    ].map((item) => (
                      <Button key={item.to} variant="outline" asChild className="justify-between rounded-[1rem] px-4 py-5">
                        <Link to={item.to}>
                          {item.label}
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    ))}
                  </div>
                </article>
              </TabsContent>

              <TabsContent value="exports" className="space-y-4">
                <article className="rounded-[1.5rem] border border-border/70 bg-card p-5">
                  <div className="text-lg font-semibold">Reason for export</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    This note is attached to export audit logs and helps explain why sensitive data left the UI.
                  </div>
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    className="mt-4"
                    placeholder="Operational review"
                  />
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <Button type="button" onClick={() => void runExport('Overview', () => adminConsoleAPI.exportOverview(reason.trim() || 'Operational review'))}>
                      <Download className="h-4 w-4" />
                      Export Overview
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void runExport('Activity', () => adminConsoleAPI.exportActivity({ reason: reason.trim() || 'Operational review' }))}>
                      <Download className="h-4 w-4" />
                      Export Activity
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void runExport('Cases', () => adminConsoleAPI.exportCasesFromCenter({ reason: reason.trim() || 'Operational review' }))}>
                      <Download className="h-4 w-4" />
                      Export Cases
                    </Button>
                    <Button type="button" variant="outline" onClick={() => void runExport('Files', () => adminConsoleAPI.exportFilesFromCenter({ reason: reason.trim() || 'Operational review' }))}>
                      <Download className="h-4 w-4" />
                      Export Files
                    </Button>
                  </div>
                </article>

                <article className="rounded-[1.5rem] border border-border/70 bg-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">Recent export history</div>
                      <div className="mt-1 text-sm text-muted-foreground">A quick audit trail without leaving the drawer.</div>
                    </div>
                    <Badge variant="outline" className="rounded-full px-3 py-1">
                      {exportHistoryQuery.data?.items.length || 0}
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-3">
                    {exportHistoryQuery.isLoading ? (
                      <div className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4 text-sm text-muted-foreground">
                        Loading export history…
                      </div>
                    ) : exportHistoryQuery.data?.items.length ? (
                      exportHistoryQuery.data.items.map((item) => (
                        <div key={item.id} className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="rounded-full">{item.exportScope || 'export'}</Badge>
                            <span className={`text-xs font-semibold uppercase tracking-[0.16em] ${statusTone(item.result)}`}>{item.result}</span>
                          </div>
                          <div className="mt-2 text-sm font-medium">{item.actorName}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {formatTimestamp(item.createdAt)} • {item.reason || 'No reason provided'}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4 text-sm text-muted-foreground">
                        No recent export actions were found.
                      </div>
                    )}
                  </div>
                </article>
              </TabsContent>

              <TabsContent value="security" className="space-y-4">
                <article className="rounded-[1.5rem] border border-border/70 bg-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-lg font-semibold">Recent auth refresh</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Refresh your sensitive-action window before exports, force logout flows, or other guarded operations.
                      </div>
                    </div>
                    <ShieldAlert className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <Button type="button" variant="outline" className="mt-4" onClick={() => setRecentAuthOpen(true)}>
                    <ShieldEllipsis className="h-4 w-4" />
                    Refresh Recent Auth
                  </Button>
                </article>

                <article className="rounded-[1.5rem] border border-border/70 bg-card p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold">Security posture</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Current admin guardrails sourced from the system health contract.
                      </div>
                    </div>
                    <Badge variant="outline" className="rounded-full px-3 py-1">
                      {admin?.role || 'it_admin'}
                    </Badge>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {systemHealthQuery.isLoading ? (
                      <div className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4 text-sm text-muted-foreground sm:col-span-2">
                        Loading security posture…
                      </div>
                    ) : (
                      securityCards.map((card) => {
                        const Icon = card.icon
                        return (
                          <article key={card.label} className="rounded-[1rem] border border-border/70 bg-card/60 px-4 py-4">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{card.label}</div>
                              <Icon className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className={`mt-2 text-lg font-semibold capitalize ${statusTone(card.block.status)}`}>
                              {card.block.status}
                            </div>
                            <div className="mt-2 text-sm text-muted-foreground">{card.detail}</div>
                          </article>
                        )
                      })
                    )}
                  </div>
                </article>
              </TabsContent>
            </Tabs>
          </div>
        </SheetContent>
      </Sheet>

      <AdminRecentAuthDialog
        open={recentAuthOpen}
        onOpenChange={setRecentAuthOpen}
        onSuccess={async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['admin-system-health'] }),
            queryClient.invalidateQueries({ queryKey: ['admin-export-history'] }),
          ])
        }}
      />
    </>
  )
}
