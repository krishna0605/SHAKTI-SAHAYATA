import bcrypt from 'bcryptjs';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'shakti_db',
  user: 'shakti_admin',
  password: 'localdevpassword',
});

async function fixPasswords() {
  const password = 'Shakti@123';
  const hash = await bcrypt.hash(password, 12);
  console.log('Generated hash for "Shakti@123":', hash);

  const result = await pool.query(
    'UPDATE users SET password_hash = $1',
    [hash]
  );
  console.log(`Updated ${result.rowCount} users.`);

  // Verify
  const users = await pool.query('SELECT buckle_id, email, role FROM users');
  console.log('\nRegistered users:');
  users.rows.forEach(u => console.log(`  ${u.buckle_id} | ${u.email} | ${u.role}`));

  await pool.end();
}

fixPasswords().catch(console.error);
