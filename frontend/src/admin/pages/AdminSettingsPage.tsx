import { useQuery } from '@tanstack/react-query'
import { AlertTriangle } from 'lucide-react'
import { adminConsoleAPI } from '../lib/api'
import { formatTimestamp, normalizeStatusTone, titleCase } from '../lib/format'
import { OpsMetricTile, OpsPageState, OpsSection, OpsStatusBadge } from '../components/OpsPrimitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const settingsSections = [
  { key: 'parser', title: 'Parser Configuration', detail: 'Parser versions, expected file families, and queue posture remain read-only in this phase.' },
  { key: 'normalization', title: 'Normalization Rules / Model Versions', detail: 'Current model versions and mapping confidence are surfaced through the processing workspace.' },
  { key: 'files', title: 'Allowed File Types', detail: 'Accepted telecom evidence types: CDR, IPDR, STR, Tower Dump, ILD, and supporting files.' },
  { key: 'retention', title: 'Retention Policies', detail: 'Retention windows are enforced through scheduled cleanup and evidence handling guardrails.' },
  { key: 'notifications', title: 'Notifications', detail: 'Alert acknowledgement and system issue signaling are available through the incident queue.' },
  { key: 'masking', title: 'Masking Rules', detail: 'Sensitive field masking remains role-aware and enforced inside the table editor and storage views.' },
  { key: 'integrations', title: 'Integration Health', detail: 'Backend, uploads, and runtime services are visible through the observability tab.' },
  { key: 'environment', title: 'Environment Info', detail: 'Production posture, system checks, and network controls remain operator-visible and auditable.' },
  { key: 'maintenance', title: 'Maintenance Mode', detail: 'Maintenance workflows remain protected; current phase exposes posture rather than mutation.' },
  { key: 'flags', title: 'Feature Flags', detail: 'Feature rollout state is represented as console posture and self-check telemetry.' },
] as const

export default function AdminSettingsPage() {
  const systemQuery = useQuery({
    queryKey: ['ops-settings-system-health'],
    queryFn: () => adminConsoleAPI.getSystemHealth(),
    refetchInterval: 30000,
  })

  if (systemQuery.isLoading) {
    return <div className="page-loading">Loading settings...</div>
  }

  if (systemQuery.isError || !systemQuery.data) {
    return <OpsPageState title="Settings unavailable" description="Governed configuration posture could not be loaded from the backend." icon={<AlertTriangle className="h-7 w-7" />} />
  }

  const snapshot = systemQuery.data

  return (
    <div className="space-y-6">
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <OpsMetricTile label="Environment" value="Production" detail="Console served in protected production posture." tone="info" />
        <OpsMetricTile label="Overall Status" value={titleCase(snapshot.overallStatus)} detail="Platform-wide readiness posture." tone={normalizeStatusTone(snapshot.overallStatus)} />
        <OpsMetricTile label="Recent Self-Checks" value={snapshot.selfChecks.length} detail="Health verification runs recorded in the current snapshot." />
        <OpsMetricTile label="Latest Refresh" value={formatTimestamp(snapshot.generatedAt)} detail="Last governed configuration snapshot time." />
      </section>

      <OpsSection title="Controlled System Configuration" description="Settings are grouped by domain and intentionally read-only by default in this delivery phase. Sensitive mutations remain deliberate, privileged, and audited.">
        <Tabs defaultValue="parser" className="space-y-5">
          <TabsList className="flex h-auto flex-wrap justify-start rounded-xl border border-border/70 bg-card/80 p-1">
            {settingsSections.map((section) => (
              <TabsTrigger key={section.key} value={section.key} className="rounded-lg px-3 py-2">
                {section.title}
              </TabsTrigger>
            ))}
          </TabsList>

          {settingsSections.map((section) => (
            <TabsContent key={section.key} value={section.key}>
              <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="ops-subpanel">
                  <div className="ops-subpanel-title">{section.title}</div>
                  <p className="text-sm leading-6 text-muted-foreground">{section.detail}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <OpsStatusBadge label="Audited" tone="info" />
                    <OpsStatusBadge label="Read-only default" tone="success" />
                    <OpsStatusBadge label="Privileged changes require confirmation" tone="warning" />
                  </div>
                </div>

                <div className="ops-subpanel">
                  <div className="ops-subpanel-title">Current Posture</div>
                  <div className="space-y-3">
                    <div className="ops-list-row">
                      <div className="font-medium">Backend readiness</div>
                      <OpsStatusBadge label={titleCase(snapshot.backend.ready.status)} tone={normalizeStatusTone(snapshot.backend.ready.status)} />
                    </div>
                    <div className="ops-list-row">
                      <div className="font-medium">Database</div>
                      <OpsStatusBadge label={titleCase(snapshot.database.status)} tone={normalizeStatusTone(snapshot.database.status)} />
                    </div>
                    <div className="ops-list-row">
                      <div className="font-medium">Uploads</div>
                      <OpsStatusBadge label={titleCase(snapshot.uploads.status)} tone={normalizeStatusTone(snapshot.uploads.status)} />
                    </div>
                    <div className="ops-list-row">
                      <div className="font-medium">Retention worker</div>
                      <OpsStatusBadge label={snapshot.retention.running ? 'Running' : 'Idle'} tone={snapshot.retention.running ? 'warning' : 'success'} />
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </OpsSection>
    </div>
  )
}
