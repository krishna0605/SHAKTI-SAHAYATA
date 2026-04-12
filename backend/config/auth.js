import 'dotenv/config';
import jwt from 'jsonwebtoken';
import { isSupabaseAuthEnabled } from './supabase.js';

const INSECURE_JWT_SECRETS = new Set([
  '',
  'changeme',
  'change-me',
  'secret',
  'dev-secret',
  'localdev',
  'shakti-local-secret-key-change-in-production',
  'shakti-dev-secret-change-in-production-minimum-32-chars'
]);

const jwtSecret = String(process.env.JWT_SECRET || '').trim();
const legacyJwtEnabled = Boolean(
  jwtSecret
  && jwtSecret.length >= 32
  && !INSECURE_JWT_SECRETS.has(jwtSecret)
);

if (!legacyJwtEnabled && !isSupabaseAuthEnabled) {
  throw new Error(
    '[AUTH] JWT_SECRET is required, must be at least 32 characters, and cannot use the documented placeholder value.'
  );
}

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseSameSite = (value) => {
  const normalized = String(value || 'lax').trim().toLowerCase();
  if (normalized === 'strict') return 'strict';
  if (normalized === 'none') return 'none';
  return 'lax';
};

export const ACCESS_TOKEN_TTL = String(process.env.JWT_ACCESS_EXPIRY || '15m').trim();
export const REFRESH_TOKEN_TTL_DAYS = parsePositiveInt(process.env.JWT_REFRESH_EXPIRY_DAYS, 7);
export const REFRESH_COOKIE_NAME = String(process.env.REFRESH_COOKIE_NAME || 'shakti_refresh').trim();
export const REFRESH_COOKIE_SAME_SITE = parseSameSite(process.env.REFRESH_COOKIE_SAMESITE);
export const REFRESH_COOKIE_SECURE =
  String(process.env.REFRESH_COOKIE_SECURE || '').trim().toLowerCase() === 'true'
  || process.env.NODE_ENV === 'production'
  || REFRESH_COOKIE_SAME_SITE === 'none';

export const AUTH_CONFIG = {
  jwtSecret,
  legacyJwtEnabled,
  provider: isSupabaseAuthEnabled ? 'supabase' : 'legacy-jwt',
  accessTokenTtl: ACCESS_TOKEN_TTL,
  refreshTokenTtlDays: REFRESH_TOKEN_TTL_DAYS,
  refreshCookieName: REFRESH_COOKIE_NAME,
  refreshCookieSameSite: REFRESH_COOKIE_SAME_SITE,
  refreshCookieSecure: REFRESH_COOKIE_SECURE
};

export const signAccessToken = (user) =>
  legacyJwtEnabled
    ? jwt.sign(
      {
        userId: user.id,
        buckleId: user.buckle_id,
        email: user.email,
        fullName: user.full_name,
        role: user.role
      },
      AUTH_CONFIG.jwtSecret,
      { expiresIn: AUTH_CONFIG.accessTokenTtl }
    )
    : (() => {
      throw new Error('Legacy JWT signing is disabled while Supabase Auth is active.');
    })();

export const decodeAccessTokenExpiry = (token) => {
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== 'object' || !decoded.exp) return null;
  return new Date(decoded.exp * 1000).toISOString();
};

export const verifyAccessToken = (token) => {
  if (!legacyJwtEnabled) {
    throw new Error('Legacy JWT verification is disabled while Supabase Auth is active.');
  }
  return jwt.verify(token, AUTH_CONFIG.jwtSecret);
};

export const buildRefreshCookieOptions = () => ({
  httpOnly: true,
  sameSite: AUTH_CONFIG.refreshCookieSameSite,
  secure: AUTH_CONFIG.refreshCookieSecure,
  path: '/api/auth',
  maxAge: AUTH_CONFIG.refreshTokenTtlDays * 24 * 60 * 60 * 1000
});

export const setRefreshCookie = (res, token) => {
  res.cookie(AUTH_CONFIG.refreshCookieName, token, buildRefreshCookieOptions());
};

export const clearRefreshCookie = (res) => {
  res.clearCookie(AUTH_CONFIG.refreshCookieName, {
    ...buildRefreshCookieOptions(),
    maxAge: undefined
  });
};
