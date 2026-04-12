import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const officersSqlPath = path.join(__dirname, '..', 'database', 'bootstrap', 'officers-bootstrap.sql')

const parseBool = (value, fallback = false) => {
  if (value === undefined || value === null || String(value).trim() === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase())
}

const getPoolConfig = () => {
  const databaseUrl = process.env.DATABASE_URL?.trim()
  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      max: 4,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
    }
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number.parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'shakti_db',
    user: process.env.DB_USER || 'shakti_admin',
    password: process.env.DB_PASSWORD || 'localdevpassword',
    max: 4,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  }
}

const validateStrongPassword = (password) => {
  if (password.length < 14) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 14 characters long.')
  }
  if (!/[A-Z]/.test(password)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least one uppercase letter.')
  }
  if (!/[a-z]/.test(password)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least one lowercase letter.')
  }
  if (!/[0-9]/.test(password)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least one numeric character.')
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least one special character.')
  }
}

const parsePermissions = () => {
  const raw = process.env.BOOTSTRAP_ADMIN_PERMISSIONS?.trim()
  if (!raw) {
    return [
      'console_access',
      'admin_overview_read',
      'admin_users_read',
      'admin_audit_read',
      'admin_settings_read',
    ]
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== 'string')) {
      throw new Error('permissions must be a string array')
    }
    return parsed
  } catch (error) {
    throw new Error(`BOOTSTRAP_ADMIN_PERMISSIONS must be valid JSON array of strings: ${error.message}`)
  }
}

const bootstrapAdmin = async (client) => {
  const email = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'it.admin@police.gov.in').trim().toLowerCase()
  const fullName = (process.env.BOOTSTRAP_ADMIN_FULL_NAME || 'SHAKTI Bootstrap Administrator').trim()
  const role = (process.env.BOOTSTRAP_ADMIN_ROLE || 'it_admin').trim()
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '')
  const mustChangePassword = parseBool(process.env.BOOTSTRAP_ADMIN_MUST_CHANGE_PASSWORD, true)
  const permissions = parsePermissions()
  const bcryptRounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10)

  if (!password) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required. Refusing to create bootstrap admin without a runtime-supplied secret.')
  }

  validateStrongPassword(password)

  const passwordHash = await bcrypt.hash(password, bcryptRounds)

  const result = await client.query(
    `
      INSERT INTO admin_accounts (
        email,
        password_hash,
        full_name,
        role,
        permissions,
        must_change_password,
        is_active,
        last_password_change
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6, TRUE, NOW())
      ON CONFLICT (email) DO UPDATE
      SET
        password_hash = EXCLUDED.password_hash,
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role,
        permissions = EXCLUDED.permissions,
        must_change_password = EXCLUDED.must_change_password,
        is_active = TRUE,
        last_password_change = NOW(),
        updated_at = NOW()
      RETURNING id, email, full_name, role, must_change_password
    `,
    [email, passwordHash, fullName, role, JSON.stringify(permissions), mustChangePassword]
  )

  return result.rows[0]
}

const countBootstrapOfficers = async (client) => {
  const result = await client.query(
    `
      SELECT COUNT(*)::int AS count
      FROM officers
      WHERE buckle_id BETWEEN 'BK-1001' AND 'BK-1050'
    `
  )
  return result.rows[0]?.count || 0
}

const main = async () => {
  const pool = new Pool(getPoolConfig())
  const client = await pool.connect()

  try {
    const officersSql = await fs.readFile(officersSqlPath, 'utf8')

    await client.query('BEGIN')
    await client.query(officersSql)
    const admin = await bootstrapAdmin(client)
    const officerCount = await countBootstrapOfficers(client)
    await client.query('COMMIT')

    console.log(`[BOOTSTRAP] Officer baseline applied: ${officerCount} officer records`)
    console.log(`[BOOTSTRAP] Admin bootstrap applied: ${admin.email} (${admin.role})`)
    console.log(`[BOOTSTRAP] must_change_password: ${admin.must_change_password ? 'true' : 'false'}`)
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error(`[BOOTSTRAP] Failed: ${error.message}`)
    process.exitCode = 1
  } finally {
    client.release()
    await pool.end()
  }
}

main()
