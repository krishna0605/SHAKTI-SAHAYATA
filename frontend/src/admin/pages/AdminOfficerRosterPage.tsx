import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, FileSpreadsheet, RefreshCcw, UploadCloud } from 'lucide-react'
import { adminConsoleAPI } from '../lib/api'
import type {
  AdminOfficerRosterImportHistoryItem,
  AdminOfficerRosterImportResult,
} from '../types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const EMPTY_RESULT: AdminOfficerRosterImportResult | null = null

export default function AdminOfficerRosterPage() {
  const [file, setFile] = useState<File | null>(null)
  const [fullSync, setFullSync] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [error, setError] = useState('')
  const [result, setResult] = useState<AdminOfficerRosterImportResult | null>(EMPTY_RESULT)
  const [imports, setImports] = useState<AdminOfficerRosterImportHistoryItem[]>([])

  const loadHistory = async () => {
    setLoadingHistory(true)
    setError('')
    try {
      const response = await adminConsoleAPI.getOfficerRosterImports(20)
      setImports(response.imports || [])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to load officer roster imports.')
    } finally {
      setLoadingHistory(false)
    }
  }

  useEffect(() => {
    void loadHistory()
  }, [])

  const latestSummary = useMemo(() => {
    if (!result) return null
    return [
      { label: 'Inserted', value: result.inserted },
      { label: 'Updated', value: result.updated },
      { label: 'Deactivated', value: result.deactivated },
      { label: 'Skipped', value: result.skipped },
      { label: 'Invalid', value: result.invalid },
    ]
  }, [result])

  const handleSubmit = async () => {
    if (!file) {
      setError('Choose an .xlsx or .csv roster file first.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const nextResult = await adminConsoleAPI.importOfficerRoster(file, { fullSync })
      setResult(nextResult)
      setFile(null)
      const input = document.getElementById('officer-roster-file') as HTMLInputElement | null
      if (input) input.value = ''
      await loadHistory()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Officer roster import failed.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-white/50 bg-white/85 dark:border-white/10 dark:bg-surface-900/80">
        <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-3 text-2xl">
              <FileSpreadsheet className="h-6 w-6" />
              Officer Roster Import
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl text-sm leading-7">
              Import Gujarat Police buckle ID rosters from Excel or CSV. Signup validates buckle ID, email, and phone
              against this roster before any Supabase officer account is created.
            </CardDescription>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void loadHistory()} disabled={loadingHistory || submitting}>
              <RefreshCcw className="h-4 w-4" />
              Refresh
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

          <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
            <Card className="border-white/50 bg-background/70 dark:border-white/10">
              <CardHeader>
                <CardTitle className="text-lg">Upload roster</CardTitle>
                <CardDescription>
                  Required columns: <code>buckle_id</code>, <code>full_name</code>, <code>email</code>, <code>phone_number</code>.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  id="officer-roster-file"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(event) => setFile(event.target.files?.[0] || null)}
                />

                <label className="flex items-start gap-3 rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={fullSync}
                    onChange={(event) => setFullSync(event.target.checked)}
                  />
                  <span>
                    Full sync mode deactivates officer roster rows not present in this file. Leave this off for safe merge
                    imports.
                  </span>
                </label>

                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline">Private auth allowlist</Badge>
                  <Badge variant="outline">Manual re-import enabled</Badge>
                </div>

                <Button onClick={handleSubmit} disabled={!file || submitting}>
                  <UploadCloud className="h-4 w-4" />
                  {submitting ? 'Importing roster...' : 'Import roster'}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-white/50 bg-background/70 dark:border-white/10">
              <CardHeader>
                <CardTitle className="text-lg">Latest result</CardTitle>
                <CardDescription>
                  Import summary and the first validation errors from the most recent upload.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!result ? (
                  <div className="text-sm text-muted-foreground">No roster import has been run in this session yet.</div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{result.fileName}</Badge>
                      <Badge variant="outline">{result.fullSync ? 'full sync' : 'merge'}</Badge>
                      <Badge variant="outline">rows: {result.totalRows}</Badge>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {latestSummary?.map((item) => (
                        <div key={item.label} className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</div>
                          <div className="mt-1 text-2xl font-semibold">{item.value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3 text-sm">
                      {result.message}
                    </div>

                    {result.errors.length ? (
                      <div className="space-y-2">
                        <div className="text-sm font-medium">Validation errors</div>
                        {result.errors.slice(0, 8).map((item) => (
                          <div key={`${item.rowNumber}-${item.code}`} className="rounded-xl border border-border/70 px-3 py-2 text-xs">
                            Row {item.rowNumber}: {item.message}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-white/50 bg-background/70 dark:border-white/10">
            <CardHeader>
              <CardTitle className="text-lg">Recent imports</CardTitle>
              <CardDescription>
                Audit trail for admin-triggered Gujarat Police roster syncs.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {loadingHistory ? (
                <div className="text-sm text-muted-foreground">Loading officer roster history...</div>
              ) : imports.length === 0 ? (
                <div className="text-sm text-muted-foreground">No officer roster imports recorded yet.</div>
              ) : (
                imports.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-border/70 bg-background/80 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">#{item.id}</Badge>
                      <Badge variant="secondary">{item.originalFilename}</Badge>
                      <Badge variant="outline">{item.importMode}</Badge>
                      <Badge variant="outline">{new Date(item.createdAt).toLocaleString()}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm md:grid-cols-4">
                      <div>Inserted: {item.inserted}</div>
                      <div>Updated: {item.updated}</div>
                      <div>Deactivated: {item.deactivated}</div>
                      <div>Errors: {item.errorCount}</div>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Imported by {item.importedByAdminName || item.importedByAdminEmail || 'Unknown admin'}
                    </div>
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
