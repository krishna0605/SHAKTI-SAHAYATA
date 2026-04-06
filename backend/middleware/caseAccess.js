/* ── Case Access Middleware (§40.5) ── */
import pool from '../config/database.js';

const roleHierarchy = { owner: 4, investigator: 3, auditor: 2, viewer: 1 };

export function requireCaseAccess(minRole = 'viewer') {
  return async (req, res, next) => {
    const caseId = req.params.caseId || req.params.id;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Super Admin and Station Admin can access all cases
    if (['super_admin', 'station_admin'].includes(userRole)) {
      return next();
    }

    try {
      // Check if case exists
      const caseResult = await pool.query(
        'SELECT created_by_user_id FROM cases WHERE id = $1',
        [caseId]
      );
      if (caseResult.rows.length === 0) {
        return res.status(404).json({ error: 'Case not found' });
      }

      // Creator has full access
      if (caseResult.rows[0].created_by_user_id === userId) {
        return next();
      }

      // Check assignment
      const assignment = await pool.query(
        `SELECT role FROM case_assignments
         WHERE case_id = $1 AND user_id = $2 AND is_active = TRUE`,
        [caseId, userId]
      );
      if (assignment.rows.length === 0) {
        return res.status(403).json({ error: 'No access to this case' });
      }
      if (roleHierarchy[assignment.rows[0].role] < roleHierarchy[minRole]) {
        return res.status(403).json({ error: 'Insufficient case permissions' });
      }

      next();
    } catch (err) {
      console.error('Case access check error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}

export default { requireCaseAccess };
