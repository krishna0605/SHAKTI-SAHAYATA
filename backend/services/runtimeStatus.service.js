import fs from 'node:fs/promises';
import path from 'node:path';
import pool from '../config/database.js';
import { AUTH_CONFIG } from '../config/auth.js';
import { isSupabaseAuthEnabled } from '../config/supabase.js';
import { getOllamaRuntimeConfig } from './chatbot/config.js';
import { isOllamaAvailable } from './chatbot/ollama.service.js';

const PASS = 'pass';
const FAIL = 'fail';
const DEGRADED = 'degraded';

const DEFAULT_BACKUP_STATUS_PATH = process.env.BACKUP_STATUS_FILE || '/app/ops/runtime/backup-status.json';
const DEFAULT_RESTORE_STATUS_PATH = process.env.RESTORE_STATUS_FILE || '/app/ops/runtime/restore-status.json';

let startupStatus = {
  status: 'unknown',
  timestamp: null,
  service: 'shakti-backend',
  checks: {},
  summary: {
    failed: [],
    degraded: [],
  },
};

const buildCheck = (status, detail, extra = {}) => ({
  status,
  detail,
  checkedAt: new Date().toISOString(),
  ...extra,
});

const readJsonIfExists = async (filePath) => {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
};

const parseBackupSummary = async () => {
  const [backup, restore] = await Promise.all([
    readJsonIfExists(DEFAULT_BACKUP_STATUS_PATH),
    readJsonIfExists(DEFAULT_RESTORE_STATUS_PATH),
  ]);

  return {
    backupStatusFile: DEFAULT_BACKUP_STATUS_PATH,
    restoreStatusFile: DEFAULT_RESTORE_STATUS_PATH,
    latestBackup: backup,
    latestRestore: restore,
  };
};

const verifyUploadsDirectory = async (uploadDir) => {
  const probePath = path.join(uploadDir, '.shakti-write-test');
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.writeFile(probePath, 'ok', 'utf8');
  await fs.unlink(probePath);
};

const checkEssentialTables = async () => {
  const result = await pool.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
    `,
    [['users', 'cases', 'sessions', 'refresh_tokens', 'uploaded_files']]
  );
  return result.rows.map((row) => row.table_name);
};

export const runStartupSelfChecks = async ({
  uploadDir,
  ollamaRequired = false,
} = {}) => {
  const checks = {};
  const failed = [];
  const degraded = [];
  const requireBootstrapIdentities =
    parseBool(process.env.REQUIRE_BOOTSTRAP_IDENTITIES, process.env.NODE_ENV === 'production');

  try {
    await pool.query('SELECT NOW() AS server_time');
    const tables = await checkEssentialTables();
    const requiredTables = ['users', 'cases', 'sessions', 'refresh_tokens', 'uploaded_files'];
    const missingTables = requiredTables.filter((table) => !tables.includes(table));
    if (missingTables.length > 0) {
      checks.database = buildCheck(FAIL, `Missing essential tables: ${missingTables.join(', ')}`, { missingTables });
      failed.push('database');
    } else {
      checks.database = buildCheck(PASS, 'Database connectivity and essential tables verified.');
    }
  } catch (error) {
    checks.database = buildCheck(FAIL, error?.message || 'Database unavailable');
    failed.push('database');
  }

  try {
    if (!AUTH_CONFIG.legacyJwtEnabled && !isSupabaseAuthEnabled) {
      throw new Error('Neither legacy JWT nor Supabase Auth is configured.');
    }
    checks.auth = buildCheck(PASS, `Auth configuration loaded and validated (${AUTH_CONFIG.provider}).`);
  } catch (error) {
    checks.auth = buildCheck(FAIL, error?.message || 'Auth configuration invalid');
    failed.push('auth');
  }

  try {
    await verifyUploadsDirectory(uploadDir);
    checks.uploads = buildCheck(PASS, `Uploads directory is writable at ${uploadDir}.`, { path: uploadDir });
  } catch (error) {
    checks.uploads = buildCheck(FAIL, error?.message || 'Uploads directory is not writable', { path: uploadDir });
    failed.push('uploads');
  }

  try {
    const result = await pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM officers WHERE buckle_id BETWEEN 'BK-1001' AND 'BK-1050' AND is_active = TRUE) AS officer_count,
          (SELECT COUNT(*)::int FROM admin_accounts WHERE is_active = TRUE) AS admin_count
      `
    );
    const officerCount = result.rows[0]?.officer_count || 0;
    const adminCount = result.rows[0]?.admin_count || 0;

    if (officerCount < 50 || adminCount < 1) {
      const status = requireBootstrapIdentities ? FAIL : DEGRADED;
      checks.bootstrapIdentities = buildCheck(
        status,
        requireBootstrapIdentities
          ? `Controlled bootstrap identities are incomplete (officers=${officerCount}, admins=${adminCount}).`
          : `Controlled bootstrap identities are incomplete for full production truthfulness (officers=${officerCount}, admins=${adminCount}). Development startup is allowed in degraded mode.`,
        { officerCount, adminCount, required: requireBootstrapIdentities }
      );
      if (requireBootstrapIdentities) {
        failed.push('bootstrapIdentities');
      } else {
        degraded.push('bootstrapIdentities');
      }
    } else {
      checks.bootstrapIdentities = buildCheck(
        PASS,
        'Controlled officer and admin bootstrap identities are available.',
        { officerCount, adminCount, required: requireBootstrapIdentities }
      );
    }
  } catch (error) {
    const status = requireBootstrapIdentities ? FAIL : DEGRADED;
    checks.bootstrapIdentities = buildCheck(
      status,
      error?.message || 'Unable to verify controlled bootstrap identities',
      { required: requireBootstrapIdentities }
    );
    if (requireBootstrapIdentities) {
      failed.push('bootstrapIdentities');
    } else {
      degraded.push('bootstrapIdentities');
    }
  }

  const ollamaConfig = getOllamaRuntimeConfig();
  try {
    const available = await isOllamaAvailable();
    if (available) {
      checks.ollama = buildCheck(PASS, `Ollama reachable at ${ollamaConfig.baseUrl}.`, {
        baseUrl: ollamaConfig.baseUrl,
        model: ollamaConfig.model,
        source: ollamaConfig.source,
        required: ollamaRequired,
      });
    } else if (ollamaRequired) {
      checks.ollama = buildCheck(FAIL, 'Ollama health check failed and LLM runtime is required.', {
        baseUrl: ollamaConfig.baseUrl,
        model: ollamaConfig.model,
        source: ollamaConfig.source,
        required: true,
      });
      failed.push('ollama');
    } else {
      checks.ollama = buildCheck(DEGRADED, 'Ollama is unavailable; deterministic chatbot paths remain available.', {
        baseUrl: ollamaConfig.baseUrl,
        model: ollamaConfig.model,
        source: ollamaConfig.source,
        required: false,
      });
      degraded.push('ollama');
    }
  } catch (error) {
    if (ollamaRequired) {
      checks.ollama = buildCheck(FAIL, error?.message || 'Ollama unavailable', {
        baseUrl: ollamaConfig.baseUrl,
        model: ollamaConfig.model,
        source: ollamaConfig.source,
        required: true,
      });
      failed.push('ollama');
    } else {
      checks.ollama = buildCheck(DEGRADED, error?.message || 'Ollama unavailable', {
        baseUrl: ollamaConfig.baseUrl,
        model: ollamaConfig.model,
        source: ollamaConfig.source,
        required: false,
      });
      degraded.push('ollama');
    }
  }

  const backupSummary = await parseBackupSummary();
  checks.backups = buildCheck(
    backupSummary.latestBackup ? PASS : DEGRADED,
    backupSummary.latestBackup
      ? `Latest backup recorded at ${backupSummary.latestBackup.completedAt || backupSummary.latestBackup.timestamp || 'unknown time'}.`
      : 'No backup status file found yet.',
    backupSummary
  );
  if (!backupSummary.latestBackup) {
    degraded.push('backups');
  }

  startupStatus = {
    status: failed.length > 0 ? FAIL : degraded.length > 0 ? DEGRADED : 'ready',
    timestamp: new Date().toISOString(),
    service: 'shakti-backend',
    checks,
    summary: { failed, degraded },
  };

  return startupStatus;
};

export const getStartupStatus = () => startupStatus;

export const getLiveHealth = () => ({
  status: 'alive',
  timestamp: new Date().toISOString(),
  service: 'shakti-backend',
});

export const getReadyHealth = () => {
  const checks = startupStatus.checks || {};
  const failing = Object.entries(checks)
    .filter(([, value]) => value?.status === FAIL)
    .map(([key]) => key);
  const degraded = Object.entries(checks)
    .filter(([, value]) => value?.status === DEGRADED)
    .map(([key]) => key);

  const status = failing.length > 0 ? 'not_ready' : degraded.length > 0 ? 'degraded' : 'ready';

  return {
    status,
    timestamp: new Date().toISOString(),
    service: startupStatus.service || 'shakti-backend',
    checks,
    summary: {
      failed: failing,
      degraded,
    },
  };
};
