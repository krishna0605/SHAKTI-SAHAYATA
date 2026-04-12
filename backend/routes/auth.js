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
import { getSupabaseAdminClient, isSupabaseAuthEnabled, verifySupabaseAccessToken } from '../config/supabase.js';
import { authenticateToken } from '../middleware/auth.js';
import { checkAccountLockout, recordFailedLogin, resetFailedLogins } from '../middleware/accountLockout.js';
import { ensureOfficerSupabaseProfile, getOfficerProfileByAuthUserId, mapOfficerIdentity } from '../services/auth/authIdentity.service.js';
import {
  normalizeBuckleId,
  normalizeRosterEmail,
  normalizeRosterPhoneNumber,
  validateOfficerRosterCredentials,
} from '../services/officerRoster.service.js';

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

const getBearerToken = (req) => {
  const header = req.headers.authorization;
  return header && header.split(' ')[1];
};

const validateOfficerPassword = (password) => {
  if (String(password || '').length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must be at least 8 characters with 1 uppercase and 1 number.';
  }
  return null;
};

const createSupabaseOfficerUser = async ({
  buckleId,
  email,
  phoneNumber,
  fullName,
  password,
}) => {
  const adminClient = getSupabaseAdminClient();
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      buckle_id: buckleId,
      phone_number: phoneNumber,
      full_name: fullName,
    },
    app_metadata: {
      account_type: 'officer',
    },
  });

  if (error) {
    if (/already registered|already exists|duplicate/i.test(String(error.message || ''))) {
      const conflict = new Error('Officer account already exists. Please sign in.');
      conflict.status = 409;
      throw conflict;
    }
    throw error;
  }

  if (!data?.user?.id) {
    throw new Error('Supabase did not return a created officer user.');
  }

  return data.user;
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

const buildAuthResponse = async ({ user, session, res, refreshToken, accessTokenOverride = null }) => {
  const tokenPayload = accessTokenOverride
    ? {
      accessToken: accessTokenOverride,
      expiresAt: null,
    }
    : buildAccessTokenPayload(user);
  if (refreshToken) {
    setRefreshCookie(res, refreshToken);
  }
  return {
    user: {
      id: user.id,
      buckleId: user.buckle_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      mustChangePassword: Boolean(user.must_change_password),
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

const buildSupabaseOfficerBootstrap = async ({ req, res, token, buckleId }) => {
  const claims = await verifySupabaseAccessToken(token);
  const user = await getOfficerProfileByAuthUserId(claims.sub);

  if (!user || !user.is_active) {
    return {
      authenticated: false,
      error: 'Your credentials are wrong',
      status: 401,
    };
  }

  if (buckleId && normalizeBuckleId(user.buckle_id) !== normalizeBuckleId(buckleId)) {
    return {
      authenticated: false,
      error: 'Buckle ID is wrong',
      status: 403,
    };
  }

  const payload = await buildAuthResponse({
    user,
    session: null,
    res,
    accessTokenOverride: token,
  });

  return {
    authenticated: true,
    ...payload,
  };
};

/* ── POST /api/auth/signup ── */
router.post('/signup', async (req, res) => {
  try {
    const {
      buckleId,
      fullName,
      email,
      phoneNumber,
      password,
    } = req.body;

    if (!buckleId || !fullName || !email || !phoneNumber || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const normalizedBuckleId = normalizeBuckleId(buckleId);
    const normalizedEmail = normalizeRosterEmail(email);
    const normalizedPhoneNumber = normalizeRosterPhoneNumber(phoneNumber);
    const normalizedFullName = String(fullName || '').trim();

    const rosterValidation = await validateOfficerRosterCredentials({
      buckleId: normalizedBuckleId,
      email: normalizedEmail,
      phoneNumber: normalizedPhoneNumber,
    });
    if (!rosterValidation.ok) {
      return res.status(rosterValidation.status).json({ error: rosterValidation.error });
    }

    const passwordError = validateOfficerPassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const existing = await pool.query(
      'SELECT id, auth_user_id FROM users WHERE buckle_id = $1 OR email = $2',
      [normalizedBuckleId, normalizedEmail]
    );
    if (existing.rows[0]?.auth_user_id) {
      return res.status(409).json({ error: 'Officer account already exists. Please sign in.' });
    }

    if (isSupabaseAuthEnabled) {
      let createdUserId = null;
      try {
        const authUser = await createSupabaseOfficerUser({
          buckleId: normalizedBuckleId,
          email: normalizedEmail,
          phoneNumber: normalizedPhoneNumber,
          fullName: normalizedFullName,
          password,
        });

        createdUserId = authUser.id;
        const profile = await ensureOfficerSupabaseProfile({
          authUserId: authUser.id,
          buckleId: normalizedBuckleId,
          fullName: rosterValidation.officer.full_name || normalizedFullName,
          email: normalizedEmail,
          phoneNumber: normalizedPhoneNumber,
        });

        await pool.query(
          'INSERT INTO audit_logs (user_id, officer_buckle_id, action, resource_type, details) VALUES ($1, $2, $3, $4, $5)',
          [
            profile.id,
            profile.buckle_id,
            'SUPABASE_SIGNUP',
            'user',
            JSON.stringify({ email: normalizedEmail, phoneNumber: normalizedPhoneNumber }),
          ]
        );

        return res.status(201).json({
          signupCompleted: true,
          message: 'Officer account created successfully. Sign in to continue.',
          user: {
            buckleId: profile.buckle_id,
            email: profile.email,
            fullName: profile.full_name,
          },
        });
      } catch (error) {
        if (createdUserId) {
          await getSupabaseAdminClient().auth.admin.deleteUser(createdUserId).catch(() => undefined);
        }
        if (error.status) {
          return res.status(error.status).json({ error: error.message });
        }
        throw error;
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (buckle_id, email, password_hash, full_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, buckle_id, email, full_name, role`,
      [normalizedBuckleId, normalizedEmail, passwordHash, rosterValidation.officer.full_name || normalizedFullName]
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
      [user.id, normalizedBuckleId, 'SIGNUP', 'user', JSON.stringify({ email: normalizedEmail, phoneNumber: normalizedPhoneNumber })]
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

    const normalizedBuckleId = normalizeBuckleId(buckleId);
    const normalizedEmail = normalizeRosterEmail(email);

    const lockout = await checkAccountLockout(normalizedBuckleId);
    if (lockout.locked) {
      return res.status(423).json({
        error: `Account locked. Try again in ${lockout.minutesLeft} minutes.`
      });
    }

    const officer = await pool.query(
      'SELECT * FROM officers WHERE buckle_id = $1 AND is_active = TRUE',
      [normalizedBuckleId]
    );
    if (officer.rows.length === 0) {
      return res.status(403).json({ error: 'Buckle ID is wrong' });
    }

    const userResult = await pool.query(
      'SELECT * FROM users WHERE buckle_id = $1 AND email = $2',
      [normalizedBuckleId, normalizedEmail]
    );
    if (userResult.rows.length === 0) {
      await recordFailedLogin(normalizedBuckleId);
      return res.status(401).json({ error: 'Your credentials are wrong' });
    }

    const user = userResult.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account deactivated. Contact admin.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await recordFailedLogin(normalizedBuckleId);
      return res.status(401).json({ error: 'Your credentials are wrong' });
    }

    await resetFailedLogins(normalizedBuckleId);

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
      [user.id, normalizedBuckleId, 'LOGIN', 'session', req.ip]
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
    const bearerToken = getBearerToken(req);
    if (bearerToken && isSupabaseAuthEnabled) {
      const payload = await buildSupabaseOfficerBootstrap({
        req,
        res,
        token: bearerToken,
        buckleId: req.query?.buckleId || null,
      });
      if (payload.error) {
        return res.status(payload.status || 403).json({ authenticated: false, error: payload.error });
      }
      return res.json(payload);
    }

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
    if (req.authType === 'supabase') {
      await pool.query(
        'INSERT INTO audit_logs (user_id, officer_buckle_id, action, resource_type) VALUES ($1, $2, $3, $4)',
        [req.user.userId, req.user.buckleId, 'SUPABASE_LOGOUT', 'session']
      );
      clearRefreshCookie(res);
      return res.json({ message: 'Logged out successfully' });
    }

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
              o.position, o.department, o.station, u.must_change_password
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
      mustChangePassword: Boolean(user.must_change_password),
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
    if (req.authType === 'supabase') {
      return res.json({ id: null, duration_seconds: 0, started_at: null });
    }

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
