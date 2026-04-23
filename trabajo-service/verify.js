import pool from './db.js';

async function verify() {
    try {
        const res = await pool.query(`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name IN ('resenas', 'acciones_trabajo')
        `);
        console.table(res.rows);
    } catch(e) {
        console.error(e);
    } finally {
        pool.end();
    }
}
verify();
