/* ── Audit Routes ── */
import { Router } from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/authorize.js';

const router = Router();

const listAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 50, action, userId } = req.query;
    const pageSize = Math.min(parseInt(limit), 200);
    const offset = (parseInt(page) - 1) * pageSize;

    let where = 'WHERE 1=1';
    const params = [];
    if (action) { params.push(action); where += ` AND action = $${params.length}`; }
    if (userId) { params.push(userId); where += ` AND user_id = $${params.length}`; }

    params.push(pageSize, offset);
    const result = await pool.query(
      `SELECT al.*, u.full_name, u.buckle_id
       FROM audit_logs al
       LEFT JOIN users u ON al.user_id = u.id
       ${where}
       ORDER BY al.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

router.post('/logs', authenticateToken, async (req, res) => {
  try {
    const { clientId, sessionId, action, screen, path, userAgent, details } = req.body || {};

    if (!action) {
      return res.status(400).json({ error: 'action is required' });
    }

    const result = await pool.query(
      `
        INSERT INTO audit_logs (
          user_id,
          officer_buckle_id,
          officer_name,
          session_id,
          action,
          resource_type,
          resource_id,
          details
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
      [
        req.user.userId,
        req.user.buckleId,
        req.user.fullName,
        sessionId || clientId || null,
        action,
        screen || 'client',
        path || null,
        JSON.stringify({
          screen: screen || null,
          path: path || null,
          userAgent: userAgent || null,
          details: details || null
        })
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/* GET /api/audit — list audit logs (admin only) */
router.get('/', authenticateToken, requireRole('super_admin', 'station_admin'), listAuditLogs);
router.get('/logs', authenticateToken, requireRole('super_admin', 'station_admin'), listAuditLogs);

export default router;
