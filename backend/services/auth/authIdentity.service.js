import pool from '../../config/database.js';
import {
  normalizeBuckleId,
  normalizeRosterEmail,
  validateOfficerRosterCredentials,
} from '../officerRoster.service.js';

export const mapOfficerIdentity = (row) => ({
  id: row.id,
  buckleId: row.buckle_id,
  email: row.email,
  fullName: row.full_name,
  role: row.role,
  mustChangePassword: Boolean(row.must_change_password),
  position: row.position || null,
  department: row.department || null,
  station: row.station || null,
  lastLogin: row.last_login || null,
  loginCount: row.login_count ?? 0,
});

export const mapAdminIdentity = (row) => ({
  id: row.id,
  email: row.email,
  fullName: row.full_name,
  role: row.role,
  permissions: Array.isArray(row.permissions) ? row.permissions : [],
  mustChangePassword: Boolean(row.must_change_password),
  isActive: Boolean(row.is_active),
  lastLogin: row.last_login || null,
  createdAt: row.created_at || null,
  totpEnabled: Boolean(row.totp_enabled),
  totpSecretConfigured: Boolean(row.totp_secret_configured),
});

export const getOfficerProfileByAuthUserId = async (authUserId) => {
  const result = await pool.query(
    `
      SELECT
        u.id,
        u.buckle_id,
        u.email,
        u.full_name,
        u.role,
        u.must_change_password,
        u.last_login,
        u.login_count,
        u.is_active,
        u.auth_user_id,
        o.position,
        o.department,
        o.station
      FROM users u
      JOIN officers o ON o.buckle_id = u.buckle_id
      WHERE u.auth_user_id = $1
      LIMIT 1
    `,
    [authUserId]
  );

  return result.rows[0] || null;
};

export const getOfficerProfileByEmailAndBuckle = async ({ email, buckleId }) => {
  const result = await pool.query(
    `
      SELECT
        u.id,
        u.buckle_id,
        u.email,
        u.full_name,
        u.role,
        u.must_change_password,
        u.last_login,
        u.login_count,
        u.is_active,
        u.auth_user_id,
        o.position,
        o.department,
        o.station
      FROM users u
      JOIN officers o ON o.buckle_id = u.buckle_id
      WHERE u.email = $1
        AND u.buckle_id = $2
      LIMIT 1
    `,
    [normalizeRosterEmail(email), normalizeBuckleId(buckleId)]
  );

  return result.rows[0] || null;
};

export const getAdminProfileByAuthUserId = async (authUserId) => {
  const result = await pool.query(
    `
      SELECT
        id,
        email,
        full_name,
        role,
        permissions,
        is_active,
        last_login,
        created_at,
        must_change_password,
        auth_user_id,
        COALESCE(totp_enabled, FALSE) AS totp_enabled,
        CASE WHEN totp_secret IS NOT NULL AND TRIM(totp_secret) <> '' THEN TRUE ELSE FALSE END AS totp_secret_configured
      FROM admin_accounts
      WHERE auth_user_id = $1
      LIMIT 1
    `,
    [authUserId]
  );

  return result.rows[0] || null;
};

export const getAdminProfileByEmail = async (email) => {
  const result = await pool.query(
    `
      SELECT
        id,
        email,
        full_name,
        role,
        permissions,
        is_active,
        last_login,
        created_at,
        must_change_password,
        auth_user_id,
        COALESCE(totp_enabled, FALSE) AS totp_enabled,
        CASE WHEN totp_secret IS NOT NULL AND TRIM(totp_secret) <> '' THEN TRUE ELSE FALSE END AS totp_secret_configured
      FROM admin_accounts
      WHERE email = $1
      LIMIT 1
    `,
    [email]
  );

  return result.rows[0] || null;
};

export const ensureOfficerSupabaseProfile = async ({
  authUserId,
  buckleId,
  fullName,
  email,
  phoneNumber,
}) => {
  const validation = await validateOfficerRosterCredentials({
    buckleId,
    email,
    phoneNumber,
  });
  if (!validation.ok) {
    const error = new Error(validation.error);
    error.status = validation.status;
    error.code = validation.code;
    throw error;
  }

  const officer = validation.officer;
  const normalizedBuckleId = normalizeBuckleId(buckleId);
  const normalizedEmail = normalizeRosterEmail(email);

  const existingUser = await pool.query(
    `
      SELECT id, auth_user_id
      FROM users
      WHERE buckle_id = $1 OR email = $2 OR auth_user_id = $3
      LIMIT 1
    `,
    [normalizedBuckleId, normalizedEmail, authUserId]
  );

  if (
    existingUser.rows[0]?.auth_user_id
    && String(existingUser.rows[0].auth_user_id).trim() !== String(authUserId).trim()
  ) {
    const conflictError = new Error('Officer account already exists. Please sign in.');
    conflictError.status = 409;
    conflictError.code = 'OFFICER_ACCOUNT_EXISTS';
    throw conflictError;
  }

  if (existingUser.rows[0]) {
    await pool.query(
      `
        UPDATE users
        SET
          auth_user_id = $2,
          email = $3,
          full_name = $4,
          is_active = TRUE,
          updated_at = NOW()
        WHERE id = $1
      `,
      [existingUser.rows[0].id, authUserId, normalizedEmail, fullName || officer.full_name]
    );
  } else {
    await pool.query(
      `
        INSERT INTO users (
          buckle_id,
          email,
          password_hash,
          full_name,
          auth_user_id,
          is_active
        )
        VALUES ($1, $2, '', $3, $4, TRUE)
      `,
      [normalizedBuckleId, normalizedEmail, fullName || officer.full_name, authUserId]
    );
  }

  return getOfficerProfileByAuthUserId(authUserId);
};

export const ensureAdminSupabaseProfile = async ({ authUserId, email }) => {
  const existingAdmin = await getAdminProfileByEmail(email);
  if (!existingAdmin) {
    throw new Error('Admin account not found');
  }

  await pool.query(
    `
      UPDATE admin_accounts
      SET
        auth_user_id = $2,
        updated_at = NOW()
      WHERE id = $1
    `,
    [existingAdmin.id, authUserId]
  );

  return getAdminProfileByAuthUserId(authUserId);
};
