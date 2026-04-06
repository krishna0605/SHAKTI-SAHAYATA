/* ── Auth Routes — Phase 1 Hardened ── */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../config/database.js';
import {
  AUTH_CONFIG,
  clearRefreshCookie,
  decodeAccessTokenExpiry,
  setRefreshCookie,
  signAccessToken
} from '../config/auth.js';
import { authenticateToken } from '../middleware/auth.js';
import { checkAccountLockout, recordFailedLogin, resetFailedLogins } from '../middleware/accountLockout.js';

const router = Router();

const createRefreshToken = () => crypto.randomBytes(40).toString('hex');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const buildAccessTokenPayload = (user) => {
  const accessToken = signAccessToken(user);
  return {
    accessToken,
    expiresAt: decodeAccessTokenExpiry(accessToken)
  };
};

const createSessionRecord = async ({ userId, ipAddress, userAgent }) => {
  const result = await pool.query(
    `INSERT INTO sessions (user_id, ip_address, user_agent)
     VALUES ($1, $2, $3)
     RETURNING id, started_at`,
    [userId, ipAddress, userAgent]
  );
  return result.rows[0];
};

const getLatestActiveSession = async (userId) => {
  const result = await pool.query(
    `SELECT id, started_at
     FROM sessions
     WHERE user_id = $1 AND ended_at IS NULL
     ORDER BY started_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
};

const revokeRefreshFamily = async (familyId) => {
  if (!familyId) return;
  await pool.query(
    `UPDATE refresh_tokens
     SET is_revoked = TRUE
     WHERE family_id = $1 AND is_revoked = FALSE`,
    [familyId]
  );
};

const storeRefreshToken = async ({ userId, familyId, rawToken, ipAddress, userAgent, replacedBy = null }) => {
  const result = await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, ip_address, user_agent, replaced_by)
     VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval, $5, $6, $7)
     RETURNING id, family_id, expires_at`,
    [userId, hashToken(rawToken), familyId, String(AUTH_CONFIG.refreshTokenTtlDays), ipAddress, userAgent, replacedBy]
  );
  return result.rows[0];
};

const findRefreshTokenRecord = async (rawToken) => {
  if (!rawToken) return null;
  const result = await pool.query(
    `SELECT
        rt.id,
        rt.user_id,
        rt.family_id,
        rt.expires_at,
        rt.is_revoked,
        u.id as account_id,
        u.buckle_id,
        u.email,
        u.full_name,
        u.role,
        u.is_active
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
     LIMIT 1`,
    [hashToken(rawToken)]
  );
  return result.rows[0] || null;
};

const rotateRefreshToken = async ({ existingToken, ipAddress, userAgent }) => {
  const nextRawToken = createRefreshToken();
  const nextRecord = await storeRefreshToken({
    userId: existingToken.user_id,
    familyId: existingToken.family_id,
    rawToken: nextRawToken,
    ipAddress,
    userAgent
  });

  await pool.query(
    `UPDATE refresh_tokens
     SET is_revoked = TRUE, replaced_by = $1
     WHERE id = $2`,
    [nextRecord.id, existingToken.id]
  );

  return { rawToken: nextRawToken, record: nextRecord };
};

const getRefreshTokenFromCookie = (req) => req.cookies?.[AUTH_CONFIG.refreshCookieName] || null;

const buildAuthResponse = async ({ user, session, res, refreshToken }) => {
  const tokenPayload = buildAccessTokenPayload(user);
  if (refreshToken) {
    setRefreshCookie(res, refreshToken);
  }
  return {
    user: {
      id: user.id,
      buckleId: user.buckle_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role
    },
    accessToken: tokenPayload.accessToken,
    expiresAt: tokenPayload.expiresAt,
    session: session
      ? {
          id: session.id,
          startedAt: session.started_at
        }
      : null
  };
};

/* ── POST /api/auth/signup ── */
router.post('/signup', async (req, res) => {
  try {
    const { buckleId, fullName, email, password } = req.body;
    if (!buckleId || !fullName || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const officer = await pool.query(
      'SELECT * FROM officers WHERE buckle_id = $1 AND is_active = TRUE',
      [buckleId]
    );
    if (officer.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized Buckle ID. Contact your administrator.' });
    }

    const existing = await pool.query(
      'SELECT id FROM users WHERE buckle_id = $1 OR email = $2',
      [buckleId, email]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'This Buckle ID or email is already registered.' });
    }

    if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters with 1 uppercase and 1 number.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (buckle_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, buckle_id, email, full_name, role`,
      [buckleId, email, passwordHash, fullName]
    );

    const user = result.rows[0];
    const session = await createSessionRecord({
      userId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    const refreshToken = createRefreshToken();
    const familyId = crypto.randomUUID();
    await storeRefreshToken({
      userId: user.id,
      familyId,
      rawToken: refreshToken,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    await pool.query(
      'INSERT INTO audit_logs (user_id, officer_buckle_id, action, resource_type, details) VALUES ($1, $2, $3, $4, $5)',
      [user.id, buckleId, 'SIGNUP', 'user', JSON.stringify({ email })]
    );

    res.status(201).json(await buildAuthResponse({ user, session, res, refreshToken }));
  } catch (err) {
    console.error('Signup error:', err);
    if (err.code === '23505') return res.status(409).json({ error: 'Already registered' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

/* ── POST /api/auth/login ── */
router.post('/login', async (req, res) => {
  try {
    const { buckleId, email, password } = req.body;
    if (!buckleId || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const lockout = await checkAccountLockout(buckleId);
    if (lockout.locked) {
      return res.status(423).json({
        error: `Account locked. Try again in ${lockout.minutesLeft} minutes.`
      });
    }

    const officer = await pool.query(
      'SELECT * FROM officers WHERE buckle_id = $1 AND is_active = TRUE',
      [buckleId]
    );
    if (officer.rows.length === 0) {
      return res.status(403).json({ error: 'Unauthorized Buckle ID' });
    }

    const userResult = await pool.query(
      'SELECT * FROM users WHERE buckle_id = $1 AND email = $2',
      [buckleId, email]
    );
    if (userResult.rows.length === 0) {
      await recordFailedLogin(buckleId);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account deactivated. Contact admin.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await recordFailedLogin(buckleId);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    await resetFailedLogins(buckleId);

    const session = await createSessionRecord({
      userId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    await pool.query(
      'UPDATE users SET last_login = NOW(), login_count = login_count + 1 WHERE id = $1',
      [user.id]
    );

    const refreshToken = createRefreshToken();
    const familyId = crypto.randomUUID();
    await storeRefreshToken({
      userId: user.id,
      familyId,
      rawToken: refreshToken,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    await pool.query(
      'INSERT INTO audit_logs (user_id, officer_buckle_id, action, resource_type, ip_address) VALUES ($1, $2, $3, $4, $5)',
      [user.id, buckleId, 'LOGIN', 'session', req.ip]
    );

    res.json(await buildAuthResponse({ user, session, res, refreshToken }));
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

/* ── POST /api/auth/refresh ── */
router.post('/refresh', async (req, res) => {
  try {
    const rawToken = getRefreshTokenFromCookie(req);
    if (!rawToken) {
      clearRefreshCookie(res);
      return res.status(401).json({ error: 'Refresh token required' });
    }

    const existingToken = await findRefreshTokenRecord(rawToken);
    if (!existingToken || existingToken.is_revoked || !existingToken.is_active || new Date(existingToken.expires_at) <= new Date()) {
      clearRefreshCookie(res);
      if (existingToken?.family_id) {
        await revokeRefreshFamily(existingToken.family_id);
      }
      return res.status(401).json({ error: 'Refresh token is invalid or expired' });
    }

    const rotated = await rotateRefreshToken({
      existingToken,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    const session = await getLatestActiveSession(existingToken.user_id);
    const user = {
      id: existingToken.account_id,
      buckle_id: existingToken.buckle_id,
      email: existingToken.email,
      full_name: existingToken.full_name,
      role: existingToken.role
    };

    res.json(await buildAuthResponse({ user, session, res, refreshToken: rotated.rawToken }));
  } catch (err) {
    console.error('Refresh error:', err);
    clearRefreshCookie(res);
    res.status(500).json({ error: 'Failed to refresh session' });
  }
});

/* ── GET /api/auth/bootstrap ── */
router.get('/bootstrap', async (req, res) => {
  try {
    const rawToken = getRefreshTokenFromCookie(req);
    if (!rawToken) {
      return res.json({ authenticated: false });
    }

    const existingToken = await findRefreshTokenRecord(rawToken);
    if (!existingToken || existingToken.is_revoked || !existingToken.is_active || new Date(existingToken.expires_at) <= new Date()) {
      clearRefreshCookie(res);
      if (existingToken?.family_id) {
        await revokeRefreshFamily(existingToken.family_id);
      }
      return res.json({ authenticated: false });
    }

    const session = await getLatestActiveSession(existingToken.user_id);
    const user = {
      id: existingToken.account_id,
      buckle_id: existingToken.buckle_id,
      email: existingToken.email,
      full_name: existingToken.full_name,
      role: existingToken.role
    };

    const payload = await buildAuthResponse({ user, session, res });
    res.json({ authenticated: true, ...payload });
  } catch (err) {
    console.error('Bootstrap error:', err);
    clearRefreshCookie(res);
    res.json({ authenticated: false });
  }
});

/* ── POST /api/auth/logout ── */
router.post('/logout', authenticateToken, async (req, res) => {
  try {
    const rawToken = getRefreshTokenFromCookie(req);
    const existingToken = rawToken ? await findRefreshTokenRecord(rawToken) : null;

    if (existingToken?.family_id) {
      await revokeRefreshFamily(existingToken.family_id);
    }

    await pool.query(
      `UPDATE sessions SET ended_at = NOW(), logout_reason = 'manual'
       WHERE user_id = $1 AND ended_at IS NULL`,
      [req.user.userId]
    );
    await pool.query(
      'INSERT INTO audit_logs (user_id, officer_buckle_id, action, resource_type) VALUES ($1, $2, $3, $4)',
      [req.user.userId, req.user.buckleId, 'LOGOUT', 'session']
    );

    clearRefreshCookie(res);
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error('Logout error:', err);
    clearRefreshCookie(res);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/* ── GET /api/auth/me ── */
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.buckle_id, u.email, u.full_name, u.role, u.last_login, u.login_count,
              o.position, o.department, o.station
       FROM users u
       JOIN officers o ON u.buckle_id = o.buckle_id
       WHERE u.id = $1`,
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = result.rows[0];
    res.json({
      id: user.id,
      buckleId: user.buckle_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      position: user.position,
      department: user.department,
      station: user.station,
      lastLogin: user.last_login,
      loginCount: user.login_count
    });
  } catch (err) {
    console.error('Get user error:', err);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/* ── GET /api/auth/session ── */
router.get('/session', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, started_at, EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER as duration_seconds
       FROM sessions WHERE user_id = $1 AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.json({ id: null, duration_seconds: 0, started_at: null });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get session' });
  }
});

export default router;
