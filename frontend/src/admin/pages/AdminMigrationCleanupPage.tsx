import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Archive, RefreshCcw, ShieldAlert, Trash2 } from 'lucide-react'
import { adminConsoleAPI } from '../lib/api'
import type { AdminMigrationCleanupReportResponse } from '../types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

const EMPTY_REPORT: AdminMigrationCleanupReportResponse = {
  reportId: null,
  status: 'empty',
  summary: {},
  totalsByType: {},
  items: [],
}

const SUMMARY_KEYS = ['keep', 'quarantine', 'delete_later', 'migrated', 'skipped'] as const

function formatCount(value: unknown) {
  return Number(value || 0) || 0
}

export default function AdminMigrationCleanupPage() {
  const [report, setReport] = useState<AdminMigrationCleanupReportResponse>(EMPTY_REPORT)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<'inventory' | 'quarantine' | 'delete' | null>(null)
  const [error, setError] = useState('')

  const loadReport = async () => {
    setLoading(true)
    setError('')
    try {
      const nextReport = await adminConsoleAPI.getMigrationCleanupReport()
      setReport(nextReport || EMPTY_REPORT)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load cleanup report.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadReport()
  }, [])

  const runAction = async (action: 'inventory' | 'quarantine' | 'delete') => {
    setActionLoading(action)
    setError('')
    try {
      const nextReport = action === 'inventory'
        ? await adminConsoleAPI.runMigrationCleanupInventory()
        : action === 'quarantine'
          ? await adminConsoleAPI.quarantineMigrationCleanupItems(String(report.reportId))
          : await adminConsoleAPI.deleteMigrationCleanupItems(String(report.reportId))
      setReport(nextReport)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Migration cleanup action failed.')
    } finally {
      setActionLoading(null)
    }
  }

  const summaryCards = useMemo(
    () =>
      SUMMARY_KEYS.map((key) => ({
        key,
        label: key.replace('_', ' '),
        value: formatCount(report.summary?.[key]),
      })),
    [report.summary],
  )

  return (
    <div className="space-y-6">
      <Card className="border-white/50 bg-white/85 dark:border-white/10 dark:bg-surface-900/80">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-3 text-2xl">
              <Archive className="h-6 w-6" />
              Migration Cleanup Layer
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl text-sm leading-7">
              Review legacy uploads, seeded identities, runtime artifacts, and delete-safe leftovers before the Supabase cutover.
              Quarantine runs before delete so rollback remains possible.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void loadReport()} disabled={loading || actionLoading !== null}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </Button>
            <Button onClick={() => void runAction('inventory')} disabled={actionLoading !== null}>
              {actionLoading === 'inventory' ? 'Running inventory...' : 'Run Inventory'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void runAction('quarantine')}
              disabled={!report.reportId || actionLoading !== null}
            >
              <ShieldAlert className="h-4 w-4" />
              {actionLoading === 'quarantine' ? 'Quarantining...' : 'Quarantine'}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void runAction('delete')}
              disabled={!report.reportId || actionLoading !== null}
            >
              <Trash2 className="h-4 w-4" />
              {actionLoading === 'delete' ? 'Deleting...' : 'Delete Eligible'}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {error ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="secondary">Report: {report.reportId || 'none'}</Badge>
            <Badge variant="outline">Status: {report.status}</Badge>
            <Badge variant="outline">Items: {report.items.length}</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-5">
            {summaryCards.map((card) => (
              <Card key={card.key} className="border-white/50 bg-background/70 dark:border-white/10">
                <CardHeader className="pb-2">
                  <CardDescription className="capitalize">{card.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold">{card.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="border-white/50 bg-background/70 dark:border-white/10">
            <CardHeader>
              <CardTitle className="text-lg">Recent Cleanup Items</CardTitle>
              <CardDescription>
                Showing the latest classified artifacts from the current report.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading cleanup inventory...</div>
              ) : report.items.length === 0 ? (
                <div className="text-sm text-muted-foreground">No cleanup report has been generated yet.</div>
              ) : (
                report.items.slice(0, 40).map((item) => (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant="outline">{item.entityType}</Badge>
                      <Badge variant={item.classification === 'quarantine' ? 'destructive' : 'secondary'}>
                        {item.classification}
                      </Badge>
                      {item.deleteEligible ? <Badge variant="outline">delete-eligible</Badge> : null}
                    </div>
                    <div className="mt-2 text-sm font-medium text-foreground">
                      {item.entityId}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {item.reason || 'No reason recorded'}
                    </div>
                    {item.sourcePath ? (
                      <div className="mt-1 break-all text-xs text-muted-foreground">{item.sourcePath}</div>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
