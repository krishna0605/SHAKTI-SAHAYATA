/* ── Account Lockout Middleware (§39.5) ── */
import pool from '../config/database.js';

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

export async function checkAccountLockout(buckleId) {
  const result = await pool.query(
    'SELECT failed_login_attempts, locked_until FROM users WHERE buckle_id = $1',
    [buckleId]
  );
  if (result.rows.length === 0) return { locked: false };

  const user = result.rows[0];
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    return { locked: true, minutesLeft };
  }
  // If lockout expired, reset
  if (user.locked_until && new Date(user.locked_until) <= new Date()) {
    await pool.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE buckle_id = $1',
      [buckleId]
    );
  }
  return { locked: false, attempts: user.failed_login_attempts };
}

export async function recordFailedLogin(buckleId) {
  await pool.query(
    `UPDATE users SET
        failed_login_attempts = failed_login_attempts + 1,
        locked_until = CASE
            WHEN failed_login_attempts + 1 >= $1
            THEN NOW() + INTERVAL '${LOCKOUT_DURATION_MINUTES} minutes'
            ELSE locked_until
        END
     WHERE buckle_id = $2`,
    [MAX_FAILED_ATTEMPTS, buckleId]
  );
}

export async function resetFailedLogins(buckleId) {
  await pool.query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE buckle_id = $1',
    [buckleId]
  );
}

export default { checkAccountLockout, recordFailedLogin, resetFailedLogins };
