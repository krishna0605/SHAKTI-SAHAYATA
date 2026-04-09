import pool from '../../config/database.js';

export const logOsintLookup = async ({
  req,
  action,
  query,
  provider,
  result = 'success',
  error = null,
}) => {
  if (!req?.user?.userId || !action) return;

  try {
    await pool.query(
      `
        INSERT INTO audit_logs (
          user_id,
          officer_buckle_id,
          officer_name,
          session_id,
          action,
          resource_type,
          resource_id,
          details,
          ip_address
        )
        VALUES ($1, $2, $3, $4, $5, 'osint', $6, $7, NULLIF($8, '')::inet)
      `,
      [
        req.user.userId,
        req.user.buckleId || null,
        req.user.fullName || null,
        req.user.sessionId || null,
        action,
        provider?.id || provider?.label || null,
        JSON.stringify({
          provider: provider?.label || null,
          providerId: provider?.id || null,
          query,
          result,
          error,
        }),
        String(req.ip || '').replace(/^::ffff:/, ''),
      ],
    );
  } catch (lookupError) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[osintAudit] Failed to write lookup audit log:', lookupError?.message || lookupError);
    }
  }
};
