import bcrypt from 'bcryptjs'
import pg from 'pg'

const { Pool } = pg

const [buckleId, email, password, fullName = 'Playwright Officer'] = process.argv.slice(2)

if (!buckleId || !email || !password) {
  console.error('Usage: node scripts/provision-playwright-officer.mjs <buckleId> <email> <password> [fullName]')
  process.exit(1)
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

const main = async () => {
  const pool = new Pool(getPoolConfig())
  const client = await pool.connect()

  try {
    const officerResult = await client.query(
      'SELECT buckle_id, full_name FROM officers WHERE buckle_id = $1 AND is_active = TRUE LIMIT 1',
      [buckleId],
    )

    if (officerResult.rows.length === 0) {
      throw new Error(`Officer roster entry ${buckleId} is not active or does not exist.`)
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await client.query('BEGIN')
    await client.query(
      `DELETE FROM refresh_tokens
       WHERE user_id IN (
         SELECT id FROM users WHERE buckle_id = $1 OR email = $2
       )`,
      [buckleId, email],
    )

    const result = await client.query(
      `
        INSERT INTO users (
          buckle_id,
          email,
          password_hash,
          full_name,
          role,
          failed_login_attempts,
          locked_until,
          must_change_password,
          is_active,
          last_password_change,
          updated_at
        )
        VALUES ($1, $2, $3, $4, 'officer', 0, NULL, FALSE, TRUE, NOW(), NOW())
        ON CONFLICT (buckle_id) DO UPDATE
        SET
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          full_name = EXCLUDED.full_name,
          role = 'officer',
          failed_login_attempts = 0,
          locked_until = NULL,
          must_change_password = FALSE,
          is_active = TRUE,
          last_password_change = NOW(),
          updated_at = NOW()
        RETURNING id, buckle_id, email, full_name, role
      `,
      [buckleId, email, passwordHash, fullName],
    )

    await client.query('COMMIT')
    process.stdout.write(JSON.stringify(result.rows[0]))
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    console.error(error?.message || error)
    process.exit(1)
  } finally {
    client.release()
    await pool.end()
  }
}

await main()
