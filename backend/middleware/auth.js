import { verifyAccessToken } from '../config/auth.js';

/* ── Authenticate Access Token ── */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired, please refresh' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

/* ── Optional Auth (for public routes that benefit from auth context) ── */
export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      req.user = verifyAccessToken(token);
    } catch { /* ignore */ }
  }
  next();
}

export default { authenticateToken, optionalAuth };
