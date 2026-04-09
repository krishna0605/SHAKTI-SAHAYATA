import pool from '../../config/database.js';
import { ADMIN_CONSOLE_CONFIG } from '../../config/adminConsole.js';
import { fetchActiveAdminAlerts } from './adminAlerts.service.js';
import { fetchActivity } from './adminActivity.service.js';
import { buildAdminSystemHealthSnapshot } from './adminSystem.service.js';

const normalizeStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (['ready', 'alive', 'ok', 'pass'].includes(normalized)) return 'pass';
  if (['not_ready', 'fail'].includes(normalized)) return 'fail';
  return normalized === 'degraded' ? 'degraded' : 'degraded';
};

const buildMonitoringCard = ({ label, status, metric, detail }) => ({
  label,
  status: normalizeStatus(status),
  metric,
  detail,
});

const buildSummary = async () => {
  const result = await pool.query(
    `
      SELECT
        (SELECT COUNT(*)::int FROM sessions WHERE ended_at IS NULL) AS active_officer_sessions,
        (SELECT COUNT(*)::int FROM admin_sessions WHERE ended_at IS NULL) AS active_admin_sessions,
        (SELECT COUNT(DISTINCT user_id)::int FROM sessions WHERE ended_at IS NULL) AS active_officers,
        (SELECT COUNT(DISTINCT admin_account_id)::int FROM admin_sessions WHERE ended_at IS NULL) AS active_admins,
        (SELECT COUNT(*)::int FROM cases WHERE status IN ('open', 'active')) AS open_cases,
        (SELECT COUNT(*)::int FROM uploaded_files WHERE uploaded_at >= CURRENT_DATE) AS uploads_today,
        (SELECT COUNT(*)::int FROM audit_logs WHERE action = 'FILE_DELETE' AND created_at >= CURRENT_DATE) AS file_deletions_today,
        (
          SELECT COUNT(*)::int
          FROM ingestion_jobs
          WHERE status IN ('failed', 'partial_success', 'quarantined', 'mismatched', 'cancelled')
        ) AS failed_ingestion_jobs
    `
  );

  const row = result.rows[0] || {};
  return {
    activeOfficers: Number(row.active_officers || 0),
    activeAdmins: Number(row.active_admins || 0),
    activeOfficerSessions: Number(row.active_officer_sessions || 0),
    activeAdminSessions: Number(row.active_admin_sessions || 0),
    openCases: Number(row.open_cases || 0),
    uploadsToday: Number(row.uploads_today || 0),
    fileDeletionsToday: Number(row.file_deletions_today || 0),
    failedJobs: Number(row.failed_ingestion_jobs || 0),
  };
};

const buildSessionsSummary = async () => {
  const [summaryResult, sessionsResult] = await Promise.all([
    pool.query(
      `
        SELECT
          (SELECT COUNT(DISTINCT user_id)::int FROM sessions WHERE ended_at IS NULL) AS officers_online,
          (SELECT COUNT(DISTINCT admin_account_id)::int FROM admin_sessions WHERE ended_at IS NULL) AS admins_online,
          (
            SELECT COUNT(*)::int
            FROM (
              SELECT id
              FROM sessions
              WHERE ended_at IS NULL
                AND started_at < NOW() - ($1 || ' minutes')::interval
              UNION ALL
              SELECT id
              FROM admin_sessions
              WHERE ended_at IS NULL
                AND started_at < NOW() - ($1 || ' minutes')::interval
            ) stale_sessions
          ) AS stale_session_count
      `,
      [String(ADMIN_CONSOLE_CONFIG.alerts.stalledSessionAgeMinutes)]
    ),
    pool.query(
      `
        SELECT *
        FROM (
          SELECT
            s.id,
            'officer'::text AS session_type,
            u.full_name AS actor_name,
            u.email AS actor_email,
            u.role AS actor_role,
            u.buckle_id AS actor_badge,
            s.started_at,
            s.ended_at,
            COALESCE(HOST(s.ip_address), NULL) AS ip_address,
            s.user_agent,
            EXTRACT(EPOCH FROM (NOW() - s.started_at))::int AS session_age_seconds
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.ended_at IS NULL

          UNION ALL

          SELECT
            s.id,
            'admin'::text AS session_type,
            aa.full_name AS actor_name,
            aa.email AS actor_email,
            aa.role AS actor_role,
            NULL::text AS actor_badge,
            s.started_at,
            s.ended_at,
            COALESCE(HOST(s.ip_address), NULL) AS ip_address,
            s.user_agent,
            EXTRACT(EPOCH FROM (NOW() - s.started_at))::int AS session_age_seconds
          FROM admin_sessions s
          JOIN admin_accounts aa ON aa.id = s.admin_account_id
          WHERE s.ended_at IS NULL
        ) active_sessions
        ORDER BY started_at DESC
        LIMIT 8
      `
    ),
  ]);

  const summary = summaryResult.rows[0] || {};
  return {
    officersOnline: Number(summary.officers_online || 0),
    adminsOnline: Number(summary.admins_online || 0),
    staleSessionCount: Number(summary.stale_session_count || 0),
    activeSessions: sessionsResult.rows,
  };
};

const buildCasesSummary = async () => {
  const [summaryResult, recentCasesResult] = await Promise.all([
    pool.query(
      `
        SELECT
          COUNT(*)::int AS total_cases,
          COUNT(*) FILTER (WHERE is_evidence_locked = TRUE)::int AS locked_cases,
          COUNT(*) FILTER (WHERE priority IN ('high', 'critical'))::int AS high_priority_cases
        FROM cases
      `
    ),
    pool.query(
      `
        SELECT
          c.id,
          c.case_name,
          c.case_number,
          c.status,
          c.priority,
          c.is_evidence_locked,
          c.updated_at,
          COALESCE(owner_user.full_name, creator.full_name, 'Unknown owner') AS owner_name,
          COALESCE(owner_user.buckle_id, creator.buckle_id, NULL) AS owner_buckle_id
        FROM cases c
        LEFT JOIN users creator ON creator.id = c.created_by_user_id
        LEFT JOIN LATERAL (
          SELECT u.full_name, u.buckle_id
          FROM case_assignments ca
          JOIN users u ON u.id = ca.user_id
          WHERE ca.case_id = c.id
            AND ca.role = 'owner'
            AND ca.is_active = TRUE
          ORDER BY ca.assigned_at DESC
          LIMIT 1
        ) owner_user ON TRUE
        ORDER BY c.updated_at DESC
        LIMIT 5
      `
    ),
  ]);

  const summary = summaryResult.rows[0] || {};
  return {
    totalCases: Number(summary.total_cases || 0),
    lockedCases: Number(summary.locked_cases || 0),
    highPriorityCases: Number(summary.high_priority_cases || 0),
    recentCases: recentCasesResult.rows,
  };
};

const buildFilesSummary = async () => {
  const [summaryResult, recentFilesResult] = await Promise.all([
    pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM uploaded_files) AS total_files,
          (SELECT COUNT(*)::int FROM uploaded_files WHERE parse_status = 'failed') AS failed_parse_files,
          (SELECT COUNT(*)::int FROM audit_logs WHERE action = 'FILE_DELETE' AND created_at >= CURRENT_DATE) AS total_deletions,
          (
            SELECT COUNT(*)::int
            FROM ingestion_jobs
            WHERE status IN ('queued', 'pending', 'processing')
          ) AS processing_jobs,
          (
            SELECT COUNT(*)::int
            FROM ingestion_jobs
            WHERE status IN ('failed', 'partial_success', 'quarantined', 'mismatched', 'cancelled')
          ) AS failed_ingestion_jobs
      `
    ),
    pool.query(
      `
        SELECT
          uf.id,
          uf.original_name,
          uf.file_name,
          uf.parse_status,
          uf.uploaded_at,
          c.id AS case_id,
          c.case_name,
          c.case_number,
          COALESCE(fc.detected_type, fc.expected_type, uf.file_type, 'unknown') AS telecom_module
        FROM uploaded_files uf
        LEFT JOIN cases c ON c.id = uf.case_id
        LEFT JOIN file_classifications fc ON fc.file_id = uf.id
        ORDER BY uf.uploaded_at DESC
        LIMIT 5
      `
    ),
  ]);

  const summary = summaryResult.rows[0] || {};
  return {
    totalFiles: Number(summary.total_files || 0),
    failedParseFiles: Number(summary.failed_parse_files || 0),
    totalDeletions: Number(summary.total_deletions || 0),
    processingJobs: Number(summary.processing_jobs || 0),
    failedIngestionJobs: Number(summary.failed_ingestion_jobs || 0),
    recentFiles: recentFilesResult.rows,
  };
};

const buildMonitoringSummary = ({ health, attention, summary, sessions, files }) => {
  const latestSelfCheck = health.selfChecks?.[0] || null;
  const backendStatus = normalizeStatus(health.backend?.ready?.status || health.overallStatus);
  const pipelineStatus = files.failedIngestionJobs > 0 || files.failedParseFiles > 0
    ? files.failedIngestionJobs >= ADMIN_CONSOLE_CONFIG.alerts.ingestionFailureThreshold ? 'fail' : 'degraded'
    : 'pass';

  const frontendIssueCount = attention.filter((item) => /frontend|client/i.test(`${item.title} ${item.summary}`)).length;
  const frontendStatus = frontendIssueCount > 0 ? 'degraded' : 'pass';
  const apiStatus = backendStatus === 'fail'
    ? 'fail'
    : (health.database?.latencyMs || 0) > 500 ? 'degraded' : 'pass';

  const flags = attention.slice(0, 6).map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    severity: item.severity,
    href: item.href,
  }));

  return {
    backend: buildMonitoringCard({
      label: 'Backend',
      status: backendStatus,
      metric: `${health.database?.latencyMs || 0} ms`,
      detail: health.backend?.ready?.status === 'ready'
        ? 'Backend readiness checks are healthy.'
        : `Backend readiness is ${health.backend?.ready?.status || 'unknown'}.`,
    }),
    frontend: buildMonitoringCard({
      label: 'Frontend',
      status: frontendStatus,
      metric: frontendIssueCount > 0 ? `${frontendIssueCount} flagged issue(s)` : 'No flagged issues',
      detail: frontendIssueCount > 0
        ? 'Client-side/admin UI warnings were surfaced through the current monitoring signals.'
        : 'No frontend telemetry issues surfaced through the current admin monitoring signals.',
    }),
    api: buildMonitoringCard({
      label: 'API',
      status: apiStatus,
      metric: attention.length > 0 ? `${attention.length} active alert(s)` : 'No active alerts',
      detail: apiStatus === 'pass'
        ? 'API behavior looks stable based on readiness and available alert signals.'
        : 'API behavior may be degraded based on readiness, latency, or active alert signals.',
    }),
    pipeline: buildMonitoringCard({
      label: 'Pipeline',
      status: pipelineStatus,
      metric: `${files.failedIngestionJobs} failed ingestion / ${files.processingJobs} processing`,
      detail: pipelineStatus === 'pass'
        ? 'Uploads and ingestion are operating without elevated failures.'
        : 'Uploads, parsing, or ingestion need attention.',
    }),
    flags,
    quickSignals: {
      lastDeploy: {
        label: 'Last deploy',
        value: 'Unavailable',
        tone: 'neutral',
      },
      lastSelfCheck: {
        label: 'Last self-check',
        value: latestSelfCheck ? `${latestSelfCheck.status} • ${latestSelfCheck.createdAt}` : 'No self-check logged',
        tone: latestSelfCheck?.status === 'fail' ? 'critical' : latestSelfCheck?.status === 'degraded' ? 'warning' : 'positive',
      },
      alertCount: {
        label: 'Alert count',
        value: String(attention.length),
        tone: attention.length > 0 ? 'warning' : 'positive',
      },
      errorTrend: {
        label: 'Error trend',
        value: summary.failedJobs > 0 || sessions.staleSessionCount > 0 ? 'Elevated' : 'Stable',
        tone: summary.failedJobs > 0 || sessions.staleSessionCount > 0 ? 'warning' : 'positive',
      },
      featureFlags: {
        label: 'Feature flags',
        value: 'Not configured',
        tone: 'neutral',
      },
    },
  };
};

export const buildAdminObservatoryPayload = async ({ admin = null, networkRequestState = null } = {}) => {
  const [summary, activityPayload, attentionPayload, sessions, cases, files, health] = await Promise.all([
    buildSummary(),
    fetchActivity({ limit: 8, page: 1 }),
    fetchActiveAdminAlerts(),
    buildSessionsSummary(),
    buildCasesSummary(),
    buildFilesSummary(),
    buildAdminSystemHealthSnapshot({ admin, networkRequestState }),
  ]);

  const attention = (attentionPayload.items || []).slice(0, 6).map((item) => ({
    id: item.id,
    severity: item.severity,
    title: item.title,
    summary: item.summary,
    href: item.href,
    acknowledged: item.acknowledged,
  }));

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      ...summary,
      databaseStatus: normalizeStatus(health.backend?.ready?.status || health.overallStatus),
    },
    attention,
    monitoring: buildMonitoringSummary({ health, attention, summary, sessions, files }),
    activity: activityPayload.items,
    sessions,
    cases,
    files,
    health,
  };
};
