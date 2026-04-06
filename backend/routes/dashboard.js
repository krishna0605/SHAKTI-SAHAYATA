/* ── Dashboard Routes ── */
import { Router } from 'express';
import pool from '../config/database.js';
import { authenticateToken } from '../middleware/auth.js';

const router = Router();

const buildCaseScope = ({ isAdmin, userId, alias = '' }) => {
  const qualified = alias ? `${alias}.` : '';
  if (isAdmin) {
    return { clause: '', params: [] };
  }

  return {
    clause: `WHERE (${qualified}created_by_user_id = $1 OR ${qualified}id IN (SELECT case_id FROM case_assignments WHERE user_id = $1 AND is_active = TRUE))`,
    params: [userId]
  };
};

/* GET /api/dashboard/stats */
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const isAdmin = ['super_admin', 'station_admin'].includes(userRole);
    const caseScope = buildCaseScope({ isAdmin, userId });
    const scopedCaseScope = buildCaseScope({ isAdmin, userId, alias: 'c' });

    const totalCasesQuery = `SELECT COUNT(*)::int as count FROM cases ${caseScope.clause}`;
    const activeCasesQuery = `
      SELECT COUNT(*)::int as count
      FROM cases
      ${caseScope.clause ? `${caseScope.clause} AND status IN ('open', 'active')` : `WHERE status IN ('open', 'active')`}
    `;
    const fileCountQuery = isAdmin
      ? 'SELECT COUNT(*)::int as count FROM uploaded_files'
      : `
          SELECT COUNT(*)::int as count
          FROM uploaded_files
          WHERE case_id IN (
            SELECT id
            FROM cases
            ${caseScope.clause}
          )
        `;
    const recentCasesQuery = `
      SELECT c.id, c.case_name, c.case_number, c.status, c.priority, c.operator, c.updated_at,
             (SELECT COUNT(*) FROM uploaded_files WHERE case_id = c.id)::int as file_count
      FROM cases c
      ${scopedCaseScope.clause}
      ORDER BY c.updated_at DESC
      LIMIT 5
    `;

    const [totalCases, activeCases, fileCount, recentCases] = await Promise.all([
      pool.query(totalCasesQuery, caseScope.params),
      pool.query(activeCasesQuery, caseScope.params),
      pool.query(fileCountQuery, caseScope.params),
      pool.query(recentCasesQuery, scopedCaseScope.params)
    ]);

    res.json({
      totalCases: totalCases.rows[0].count,
      activeCases: activeCases.rows[0].count,
      totalFiles: fileCount.rows[0].count,
      recentCases: recentCases.rows
    });
  } catch (err) {
    console.error('Dashboard stats error:', err);
    res.status(500).json({ error: 'Failed to load dashboard stats' });
  }
});

export default router;
