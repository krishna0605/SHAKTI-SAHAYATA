import pool from '../config/database.js';

/**
 * Audit Logger Middleware
 * Captures officer-enriched audit logs with buckle_id and officer_name.
 * Logs all API requests to the audit_logs table.
 */
const AUDIT_LOGGING_ENABLED = String(process.env.AUDIT_LOGGING_ENABLED || 'true').trim().toLowerCase() !== 'false';
const AUDIT_LOG_MAX_DETAILS = Math.max(500, Math.min(20000, Number(process.env.AUDIT_LOG_MAX_DETAILS || 8000)));

// Paths to skip logging (health checks, static, etc.)
const SKIP_PATHS = ['/api/health', '/favicon.ico'];

const truncateText = (value, maxLen) => {
  const text = String(value ?? '');
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 12))}...<truncated>`;
};

const extractOfficerInfo = (req) => {
  // Try to get officer info from JWT token or session
  const user = req.user || {};
  return {
    buckle_id: user.buckle_id || user.buckleId || req.headers['x-buckle-id'] || null,
    officer_name: user.officer_name || user.officerName || user.name || req.headers['x-officer-name'] || null,
    officer_rank: user.rank || req.headers['x-officer-rank'] || null,
  };
};

export const auditLogger = (req, res, next) => {
  if (!AUDIT_LOGGING_ENABLED) return next();
  if (SKIP_PATHS.some((p) => req.path.startsWith(p))) return next();

  const startTime = Date.now();

  // Hook into the response finish event
  res.on('finish', async () => {
    const elapsedMs = Date.now() - startTime;
    const officer = extractOfficerInfo(req);

    const action = `${req.method} ${req.route?.path || req.path}`;
    const screen = req.path.split('/')[2] || 'unknown'; // e.g., 'cases', 'chatbot', etc.

    const details = {
      method: req.method,
      statusCode: res.statusCode,
      elapsedMs,
      ...officer,
      query: Object.keys(req.query || {}).length > 0 ? req.query : undefined,
      bodyKeys: req.body ? Object.keys(req.body).slice(0, 10) : undefined,
    };

    try {
      const userId = req.user?.userId || null;
      const resourceType = screen; // e.g., 'cases', 'chatbot', etc.
      const resourceId = req.params?.id || null;

      await pool.query(
        `INSERT INTO audit_logs (user_id, officer_buckle_id, officer_name, session_id, action, resource_type, resource_id, details, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet)`,
        [
          userId,
          officer.buckle_id,
          officer.officer_name,
          req.headers['x-session-id'] || null,
          truncateText(action, 200),
          resourceType,
          resourceId,
          JSON.stringify(details).slice(0, AUDIT_LOG_MAX_DETAILS),
          String(req.ip || '127.0.0.1').replace(/^::ffff:/, ''),
        ]
      );
    } catch (error) {
      // Silent fail — audit logging should never break the app
      if (process.env.NODE_ENV !== 'production') {
        console.error('[auditLogger] Failed to write audit log:', error?.message);
      }
    }
  });

  next();
};

export default auditLogger;
