import { EventEmitter } from 'node:events';
import pool from '../../config/database.js';

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

const POLL_INTERVAL_MS = Math.max(5000, Number(process.env.ADMIN_STREAM_POLL_INTERVAL_MS || 15000));
let monitorStarted = false;
let lastSnapshot = null;

const buildSnapshot = async () => {
  const [dashboardResult, alertsResult, ingestionResult, normalizationResult, sessionsResult, storageResult, logsResult] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM cases WHERE status IN ('open', 'active')) AS open_cases,
        (SELECT COUNT(*)::int FROM admin_sessions WHERE ended_at IS NULL) AS active_admin_sessions,
        (SELECT COUNT(*)::int FROM sessions WHERE ended_at IS NULL) AS active_officer_sessions
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (
          WHERE (
            status = 'fail'
            OR status = 'degraded'
          )
        )::int AS active_alerts
      FROM (
        SELECT
          CASE
            WHEN COUNT(*) FILTER (WHERE status IN ('failed', 'partial_success')) > 0 THEN 'fail'
            WHEN COUNT(*) FILTER (WHERE status = 'processing') > 0 THEN 'degraded'
            ELSE 'pass'
          END AS status
        FROM ingestion_jobs
        UNION ALL
        SELECT
          CASE WHEN COUNT(*) FILTER (WHERE ended_at IS NULL) > 50 THEN 'degraded' ELSE 'pass' END AS status
        FROM sessions
        UNION ALL
        SELECT
          CASE WHEN COUNT(*) FILTER (WHERE ended_at IS NULL) > 5 THEN 'degraded' ELSE 'pass' END AS status
        FROM admin_sessions
      ) alerts
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE parse_status = 'pending')::int AS pending_parsing,
        COUNT(*) FILTER (WHERE parse_status = 'processing')::int AS parsing_in_progress,
        COALESCE(MAX(uploaded_at), 'epoch'::timestamptz) AS latest_upload_at
      FROM uploaded_files
    `),
    pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'processing')::int AS jobs_running,
        COUNT(*) FILTER (WHERE status IN ('failed', 'quarantined', 'mismatched', 'cancelled'))::int AS jobs_failed,
        COALESCE(MAX(created_at), 'epoch'::timestamptz) AS latest_job_at
      FROM ingestion_jobs
    `),
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM admin_sessions WHERE ended_at IS NULL) AS active_admin_sessions,
        (SELECT COUNT(*)::int FROM sessions WHERE ended_at IS NULL) AS active_officer_sessions
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS total_files,
        COUNT(*) FILTER (WHERE governance.quarantined = TRUE)::int AS quarantined_files,
        COUNT(*) FILTER (WHERE governance.legal_hold = TRUE)::int AS legal_hold_files,
        COALESCE(MAX(uf.uploaded_at), 'epoch'::timestamptz) AS latest_file_at
      FROM uploaded_files uf
      LEFT JOIN file_storage_governance governance ON governance.file_id = uf.id
    `),
    pool.query(`
      SELECT
        COALESCE(MAX(created_at), 'epoch'::timestamptz) AS latest_activity_at,
        COUNT(*)::int AS visible_events
      FROM admin_activity_feed_v
    `),
  ]);

  const dashboard = dashboardResult.rows[0] || {};
  const alerts = alertsResult.rows[0] || {};
  const ingestion = ingestionResult.rows[0] || {};
  const normalization = normalizationResult.rows[0] || {};
  const sessions = sessionsResult.rows[0] || {};
  const storage = storageResult.rows[0] || {};
  const logs = logsResult.rows[0] || {};

  return {
    dashboard: {
      openCases: Number(dashboard.open_cases || 0),
      activeAdminSessions: Number(dashboard.active_admin_sessions || 0),
      activeOfficerSessions: Number(dashboard.active_officer_sessions || 0),
    },
    alerts: {
      active: Number(alerts.active_alerts || 0),
    },
    ingestion: {
      pendingParsing: Number(ingestion.pending_parsing || 0),
      parsingInProgress: Number(ingestion.parsing_in_progress || 0),
      latestUploadAt: String(ingestion.latest_upload_at || ''),
    },
    normalization: {
      jobsRunning: Number(normalization.jobs_running || 0),
      jobsFailed: Number(normalization.jobs_failed || 0),
      latestJobAt: String(normalization.latest_job_at || ''),
    },
    sessions: {
      activeAdminSessions: Number(sessions.active_admin_sessions || 0),
      activeOfficerSessions: Number(sessions.active_officer_sessions || 0),
    },
    storage: {
      totalFiles: Number(storage.total_files || 0),
      quarantinedFiles: Number(storage.quarantined_files || 0),
      legalHoldFiles: Number(storage.legal_hold_files || 0),
      latestFileAt: String(storage.latest_file_at || ''),
    },
    logs: {
      latestActivityAt: String(logs.latest_activity_at || ''),
      visibleEvents: Number(logs.visible_events || 0),
    },
  };
};

const shallowEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const emitChangeSet = (nextSnapshot, previousSnapshot) => {
  if (!previousSnapshot) {
    emitter.emit('admin-event', { event: 'stream.connected', payload: { snapshot: nextSnapshot }, emittedAt: new Date().toISOString() });
    return;
  }

  const sections = [
    ['dashboard', 'dashboard.summary.changed'],
    ['alerts', 'alerts.changed'],
    ['ingestion', 'ingestion.queue.changed'],
    ['normalization', 'normalization.queue.changed'],
    ['sessions', 'sessions.changed'],
    ['storage', 'storage.changed'],
    ['logs', 'logs.changed'],
  ];

  for (const [section, event] of sections) {
    if (!shallowEqual(nextSnapshot[section], previousSnapshot[section])) {
      emitter.emit('admin-event', {
        event,
        payload: {
          section,
          snapshot: nextSnapshot[section],
        },
        emittedAt: new Date().toISOString(),
      });
    }
  }
};

const startMonitor = () => {
  if (monitorStarted) return;
  monitorStarted = true;

  const tick = async () => {
    try {
      const snapshot = await buildSnapshot();
      emitChangeSet(snapshot, lastSnapshot);
      lastSnapshot = snapshot;
    } catch (error) {
      emitter.emit('admin-event', {
        event: 'stream.error',
        payload: {
          message: error?.message || 'Admin event stream monitor failed.',
        },
        emittedAt: new Date().toISOString(),
      });
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
};

export const emitAdminConsoleEvent = (event, payload = {}) => {
  emitter.emit('admin-event', {
    event,
    payload,
    emittedAt: new Date().toISOString(),
  });
};

export const getAdminEventStreamSnapshot = async () => {
  if (!lastSnapshot) {
    lastSnapshot = await buildSnapshot();
  }
  return lastSnapshot;
};

export const subscribeToAdminEvents = (listener) => {
  startMonitor();
  emitter.on('admin-event', listener);
  return () => {
    emitter.off('admin-event', listener);
  };
};
