import { verifyAdminAccessToken } from '../../config/adminAuth.js';
import { verifySupabaseAccessToken } from '../../config/supabase.js';
import { getAdminProfileByAuthUserId, mapAdminIdentity } from '../../services/auth/authIdentity.service.js';

const resolveSupabaseAdmin = async (token) => {
  const claims = await verifySupabaseAccessToken(token);
  const profile = await getAdminProfileByAuthUserId(claims.sub);
  if (!profile || !profile.is_active) {
    return null;
  }

  return {
    adminId: profile.id,
    email: profile.email,
    fullName: profile.full_name,
    role: profile.role,
    permissions: Array.isArray(profile.permissions) ? profile.permissions : [],
    accountType: 'it_admin',
    authType: 'supabase',
    authUserId: claims.sub,
    claims,
    profile: mapAdminIdentity(profile),
    sessionId: claims.session_id || claims.sessionId || null,
    recentAuthAt: claims.recent_auth_at || claims.recentAuthAt || null,
  };
};

export async function authenticateAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Admin access token required' });
  }

  try {
    const decoded = verifyAdminAccessToken(token);
    if (!decoded || decoded.accountType !== 'it_admin') {
      return res.status(403).json({ error: 'Invalid admin token' });
    }

    req.admin = decoded;
    req.authToken = token;
    req.authType = 'legacy';
    next();
  } catch (error) {
    try {
      const resolvedAdmin = await resolveSupabaseAdmin(token);
      if (resolvedAdmin) {
        req.admin = resolvedAdmin;
        req.authToken = token;
        req.authType = 'supabase';
        return next();
      }
    } catch (supabaseError) {
      if (supabaseError.name === 'JWTExpired' || supabaseError.code === 'ERR_JWT_EXPIRED') {
        return res.status(401).json({ error: 'Admin token expired, please sign in again' });
      }
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Admin token expired, please refresh' });
    }

    return res.status(403).json({ error: 'Invalid admin token' });
  }
}
