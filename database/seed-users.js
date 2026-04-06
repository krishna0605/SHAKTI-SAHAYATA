import bcrypt from 'bcryptjs';
import pg from 'pg';

const pool = new pg.Pool({
  host: 'localhost',
  port: 5432,
  database: 'shakti_db',
  user: 'shakti_admin',
  password: 'localdevpassword',
});

async function seedUsers() {
  const password = 'Shakti@123';
  const hash = await bcrypt.hash(password, 12);
  console.log('Generated hash for password:', password);
  console.log('Hash:', hash);

  // Create demo users
  const users = [
    { buckleId: 'BK-4782', email: 'rajesh@police.gov.in', fullName: 'Rajesh Kumar Sharma', role: 'officer' },
    { buckleId: 'BK-9999', email: 'admin@police.gov.in', fullName: 'Priya Patel', role: 'super_admin' },
  ];

  for (const u of users) {
    try {
      await pool.query(
        `INSERT INTO users (buckle_id, email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (buckle_id) DO UPDATE SET
           password_hash = $3, role = $5, email = $2`,
        [u.buckleId, u.email, hash, u.fullName, u.role]
      );
      console.log(`✅ User ${u.fullName} (${u.buckleId}) created/updated`);
    } catch (err) {
      console.error(`❌ Failed to create user ${u.buckleId}:`, err.message);
    }
  }

  console.log('\n=== Demo Credentials ===');
  console.log('Officer:     BK-4782 / rajesh@police.gov.in / Shakti@123');
  console.log('Admin:       BK-9999 / admin@police.gov.in  / Shakti@123');
  console.log('========================\n');

  await pool.end();
}

seedUsers().catch(err => { console.error(err); process.exit(1); });
