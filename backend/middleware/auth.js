import { verifyAccessToken } from '../config/auth.js';
import { verifySupabaseAccessToken } from '../config/supabase.js';
import { getOfficerProfileByAuthUserId, mapOfficerIdentity } from '../services/auth/authIdentity.service.js';

const getBearerToken = (req) => {
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.split(' ')[1];
};

const tryResolveSupabaseOfficer = async (token) => {
  const claims = await verifySupabaseAccessToken(token);
  const profile = await getOfficerProfileByAuthUserId(claims.sub);
  if (!profile || !profile.is_active) {
    return null;
  }

  return {
    userId: profile.id,
    buckleId: profile.buckle_id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    accountType: 'officer',
    authType: 'supabase',
    authUserId: claims.sub,
    claims,
    profile: mapOfficerIdentity(profile),
  };
};

/* ── Authenticate Access Token ── */
export async function authenticateToken(req, res, next) {
  const token = getBearerToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    req.authToken = token;
    req.authType = 'legacy';
    next();
  } catch (legacyError) {
    try {
      const resolvedUser = await tryResolveSupabaseOfficer(token);
      if (resolvedUser) {
        req.user = resolvedUser;
        req.authToken = token;
        req.authType = 'supabase';
        return next();
      }
    } catch (supabaseError) {
      if (supabaseError.name === 'JWTExpired' || supabaseError.code === 'ERR_JWT_EXPIRED') {
        return res.status(401).json({ error: 'Token expired, please sign in again' });
      }
    }

    if (legacyError.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired, please refresh' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
}

/* ── Optional Auth (for public routes that benefit from auth context) ── */
export async function optionalAuth(req, res, next) {
  const token = getBearerToken(req);
  if (token) {
    try {
      req.user = verifyAccessToken(token);
      req.authToken = token;
      req.authType = 'legacy';
    } catch {
      try {
        const resolvedUser = await tryResolveSupabaseOfficer(token);
        if (resolvedUser) {
          req.user = resolvedUser;
          req.authToken = token;
          req.authType = 'supabase';
        }
      } catch {
        // ignore
      }
    }
  }
  next();
}

export default { authenticateToken, optionalAuth };
