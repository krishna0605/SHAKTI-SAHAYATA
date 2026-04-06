/* ── Evidence Lock Middleware (§42.4) ── */
import pool from '../config/database.js';

export async function checkEvidenceLock(req, res, next) {
  const caseId = req.params.caseId || req.params.id;
  if (!caseId) return next();

  try {
    const result = await pool.query(
      'SELECT is_evidence_locked, lock_reason FROM cases WHERE id = $1',
      [caseId]
    );
    if (result.rows[0]?.is_evidence_locked) {
      return res.status(423).json({
        error: 'Case is evidence-locked for legal proceedings',
        reason: result.rows[0].lock_reason,
        message: 'Contact Super Admin to unlock'
      });
    }
    next();
  } catch (err) {
    console.error('Evidence lock check error:', err);
    next();
  }
}

export default { checkEvidenceLock };
