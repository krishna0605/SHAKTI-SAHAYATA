import { Router } from 'express';
import path from 'node:path';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { getOllamaRuntimeConfig } from '../services/chatbot/config.js';
import { isOllamaAvailable } from '../services/chatbot/ollama.service.js';
import { getReadyHealth, getStartupStatus, runStartupSelfChecks } from '../services/runtimeStatus.service.js';

const router = Router();
const CHATBOT_DIAGNOSTICS_ENABLED =
  String(process.env.CHATBOT_DIAGNOSTICS_ENABLED || '').trim().toLowerCase() === 'true';
const ADMIN_ROLES = new Set(['super_admin', 'station_admin']);

router.get('/diagnostics', authenticateToken, async (req, res) => {
  let dbConnected = false;
  let dbError = null;
  let ollamaAvailable = false;
  let ollamaError = null;

  try {
    await pool.query('SELECT 1');
    dbConnected = true;
  } catch (error) {
    dbError = error?.message || 'Database unavailable';
  }

  try {
    ollamaAvailable = await isOllamaAvailable();
    if (!ollamaAvailable) {
      ollamaError = 'Ollama did not respond to health check';
    }
  } catch (error) {
    ollamaError = error?.message || 'Ollama unavailable';
  }

  const ollama = getOllamaRuntimeConfig();
  const startup = getStartupStatus();
  const readiness = getReadyHealth();

  res.json({
    timestamp: new Date().toISOString(),
    backend: {
      status: 'ok',
      version: '2.0.0',
      mode: process.env.NODE_ENV || 'development'
    },
    database: {
      connected: dbConnected,
      error: dbError
    },
    ollama: {
      available: ollamaAvailable,
      baseUrl: ollama.baseUrl,
      model: ollama.model,
      source: ollama.source,
      error: ollamaError
    },
    chatbot: {
      diagnosticsEnabled: CHATBOT_DIAGNOSTICS_ENABLED,
      deterministicAvailable: true,
      llmAvailable: ollamaAvailable
    },
    health: {
      live: { status: 'alive' },
      ready: readiness,
      startup,
    },
    backups: startup.checks?.backups || null,
    requester: {
      userId: req.user?.userId || null,
      buckleId: req.user?.buckleId || null,
      role: req.user?.role || null
    }
  });
});

router.post('/self-check', authenticateToken, async (req, res) => {
  if (!ADMIN_ROLES.has(req.user?.role)) {
    return res.status(403).json({ error: 'Administrator access required' });
  }

  try {
    const uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
    const startup = await runStartupSelfChecks({ uploadDir, ollamaRequired: false });
    const readiness = getReadyHealth();
    const httpStatus = startup.status === 'fail' ? 503 : 200;
    res.status(httpStatus).json({
      message: 'Self-check completed',
      startup,
      readiness,
    });
  } catch (error) {
    res.status(500).json({ error: error?.message || 'Self-check failed' });
  }
});

export default router;
