import pg from 'pg';
const { Pool } = pg;

// Build pool config: use DATABASE_URL if available, else individual vars
const buildPoolConfig = () => {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    return {
      connectionString: databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'shakti_db',
    user: process.env.DB_USER || 'shakti_admin',
    password: process.env.DB_PASSWORD || 'localdevpassword',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  };
};

const pool = new Pool(buildPoolConfig());

// Connection verification on startup
pool.on('connect', () => {
  console.log('[DB] New client connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Verify connection immediately
(async () => {
  try {
    const res = await pool.query('SELECT NOW() AS now');
    console.log(`[DB] ✅ PostgreSQL connected at ${res.rows[0].now}`);
  } catch (err) {
    console.error('[DB] ❌ PostgreSQL connection failed:', err.message);
    console.error('[DB]    Check DATABASE_URL or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD');
  }
})();

export default pool;
