import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  user: 'Jean',
  host: 'localhost',
  database: 'neondb',
  password: 'Jean_0124@DB!',
  port: 5432,
});

async function test() {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log('Success:', res.rows[0]);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

test();
