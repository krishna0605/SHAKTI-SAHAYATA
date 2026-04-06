/* ── Global Error Handler (§30.3) ── */
import pool from '../config/database.js';

export function globalErrorHandler(err, req, res, _next) {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}`, err.message);

  // Log to audit table
  try {
    const ip = String(req.ip || '127.0.0.1').replace(/^::ffff:/, '');
    pool.query(
      'INSERT INTO audit_logs (action, details, officer_buckle_id, ip_address) VALUES ($1, $2, $3, $4::inet)',
      ['ERROR', JSON.stringify({ method: req.method, url: req.url, error: err.message }), req.user?.buckleId || 'anonymous', ip]
    );
  } catch (logErr) {
    console.error('Failed to log error:', logErr);
  }

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired, please login again' });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Record already exists' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record not found' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'File exceeds size limit' });
  }

  res.status(500).json({ error: 'Internal server error' });
}

export default globalErrorHandler;
