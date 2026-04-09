import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AdminObservatoryPage from './AdminObservatoryPage'

const getObservatoryMock = vi.fn()

vi.mock('../lib/api', () => ({
  adminConsoleAPI: {
    getObservatory: () => getObservatoryMock(),
  },
}))

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <AdminObservatoryPage />
      </QueryClientProvider>
    </MemoryRouter>
  )
}

describe('AdminObservatoryPage', () => {
  beforeEach(() => {
    getObservatoryMock.mockReset()
  })

  it('renders the simplified observatory sections and monitoring wall', async () => {
    getObservatoryMock.mockResolvedValue({
      generatedAt: '2026-04-09T09:30:00.000Z',
      summary: {
        activeOfficers: 8,
        activeAdmins: 2,
        activeOfficerSessions: 10,
        activeAdminSessions: 2,
        openCases: 34,
        uploadsToday: 19,
        fileDeletionsToday: 1,
        failedJobs: 2,
        databaseStatus: 'degraded',
      },
      attention: [
        {
          id: 'failed-ingestion-spike',
          severity: 'critical',
          title: 'Failed ingestion spike detected',
          summary: '2 ingestion jobs need review.',
          href: '/files',
          acknowledged: false,
        },
      ],
      monitoring: {
        backend: { label: 'Backend', status: 'degraded', metric: '140 ms', detail: 'Readiness is degraded.' },
        frontend: { label: 'Frontend', status: 'pass', metric: 'No flagged issues', detail: 'No client issues surfaced.' },
        api: { label: 'API', status: 'pass', metric: '1 active alert', detail: 'API looks stable.' },
        pipeline: { label: 'Pipeline', status: 'degraded', metric: '2 failed / 1 processing', detail: 'Pipeline needs attention.' },
        flags: [
          {
            id: 'frontend-issues',
            title: 'Frontend route errors elevated',
            summary: 'Client route warnings are elevated.',
            severity: 'warning',
            href: '/system',
          },
        ],
        quickSignals: {
          lastDeploy: { label: 'Last deploy', value: 'Unavailable', tone: 'neutral' },
          lastSelfCheck: { label: 'Last self-check', value: 'degraded', tone: 'warning' },
          alertCount: { label: 'Alert count', value: '1', tone: 'warning' },
          errorTrend: { label: 'Error trend', value: 'Elevated', tone: 'warning' },
          featureFlags: { label: 'Feature flags', value: 'Not configured', tone: 'neutral' },
        },
      },
      activity: [
        {
          source: 'audit',
          id: '1',
          created_at: '2026-04-09T09:29:00.000Z',
          actor_type: 'officer',
          actor_id: '11',
          actor_name: 'Officer One',
          actor_email: 'officer1@police.gov.in',
          actor_role: 'officer',
          action: 'CASE_OPENED',
          resource_type: 'case',
          resource_id: '41',
          session_id: 'sess-1',
          ip_address: '127.0.0.1',
          details: { caseId: '41' },
        },
      ],
      sessions: {
        officersOnline: 8,
        adminsOnline: 2,
        staleSessionCount: 1,
        activeSessions: [
          {
            id: 'sess-1',
            session_type: 'officer',
            actor_name: 'Officer One',
            actor_email: 'officer1@police.gov.in',
            actor_role: 'officer',
            actor_badge: 'B-11',
            started_at: '2026-04-09T09:00:00.000Z',
            ended_at: null,
            ip_address: '127.0.0.1',
            user_agent: 'Mozilla/5.0',
            session_age_seconds: 1800,
          },
        ],
      },
      cases: {
        totalCases: 34,
        lockedCases: 5,
        highPriorityCases: 7,
        recentCases: [
          {
            id: 41,
            case_name: 'Alpha Case',
            case_number: 'CASE-41',
            status: 'open',
            priority: 'high',
            is_evidence_locked: true,
            updated_at: '2026-04-09T09:10:00.000Z',
            owner_name: 'Officer One',
            owner_buckle_id: 'B-11',
          },
        ],
      },
      files: {
        totalFiles: 220,
        failedParseFiles: 3,
        totalDeletions: 1,
        processingJobs: 1,
        failedIngestionJobs: 2,
        recentFiles: [
          {
            id: 501,
            original_name: 'tower-dump.csv',
            file_name: 'tower-dump-501.csv',
            parse_status: 'processing',
            uploaded_at: '2026-04-09T09:12:00.000Z',
            case_id: 41,
            case_name: 'Alpha Case',
            case_number: 'CASE-41',
            telecom_module: 'cdr',
          },
        ],
      },
      health: {
        generatedAt: '2026-04-09T09:30:00.000Z',
        overallStatus: 'degraded',
        backend: {
          live: { status: 'alive', service: 'backend', timestamp: '2026-04-09T09:30:00.000Z' },
          ready: { status: 'degraded', service: 'backend', timestamp: '2026-04-09T09:30:00.000Z' },
          startup: { status: 'pass', service: 'backend', timestamp: '2026-04-09T09:00:00.000Z' },
        },
        database: { status: 'pass', detail: 'Connected', connected: true, latencyMs: 140, serverTime: '2026-04-09T09:30:00.000Z' },
        uploads: { status: 'pass', detail: 'Writable', path: 'uploads', writable: true, topLevelFileCount: 8 },
        backups: {
          status: 'degraded',
          detail: 'Backup metadata is stale.',
          latestBackup: { completedAt: '2026-04-09T05:00:00.000Z' },
          latestRestore: { completedAt: '2026-04-08T20:00:00.000Z' },
        },
        runtime: { status: 'pass', detail: 'Healthy', nodeVersion: 'v22.0.0' },
        security: {
          totp: { status: 'pass', detail: 'Required and configured.' },
          sessionRotation: { status: 'pass', detail: 'Rotation enabled.' },
          networkRestriction: { status: 'pass', detail: 'Allowlist enabled.' },
          recentAuth: { status: 'pass', detail: 'Recent auth required.' },
        },
        retention: {
          running: false,
          startedAt: null,
          completedAt: null,
          lastResult: null,
          lastError: null,
          policies: { sessionDays: 14, refreshTokenDays: 30, actionLogDays: 90, intervalMinutes: 60 },
        },
        selfChecks: [],
      },
    })

    renderPage()

    expect(await screen.findByText(/operational visibility for shakti in one simple workspace/i)).toBeInTheDocument()
    expect(screen.getByText(/attention center/i)).toBeInTheDocument()
    expect(screen.getByText(/platform monitoring/i)).toBeInTheDocument()
    expect(screen.getByText(/live activity feed/i)).toBeInTheDocument()
    expect(screen.getByText(/users & sessions/i)).toBeInTheDocument()
    expect(screen.getByText(/case operations/i)).toBeInTheDocument()
    expect(screen.getByText(/file operations/i)).toBeInTheDocument()
    expect(screen.getByText(/health snapshot/i)).toBeInTheDocument()
    expect(screen.getByText(/frontend route errors elevated/i)).toBeInTheDocument()
    expect(screen.getAllByText(/alpha case/i).length).toBeGreaterThan(0)
  })
})
