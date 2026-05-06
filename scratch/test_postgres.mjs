import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'neondb',
  password: '',
  port: 5432,
});

async function test() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('Success with postgres user:', res.rows[0]);
  } catch (err) {
    console.error('Error with postgres user:', err.message);
  } finally {
    await pool.end();
  }
}

test();
