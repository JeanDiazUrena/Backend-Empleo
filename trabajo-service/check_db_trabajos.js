import pool from './db.js';

async function check() {
    try {
        const res = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'trabajos'");
        console.log("Columns in trabajos table:");
        res.rows.forEach(row => console.log(`- ${row.column_name} (${row.data_type})`));
        
        const res2 = await pool.query("SELECT * FROM trabajos LIMIT 1");
        console.log("\nFirst row in trabajos:");
        console.log(JSON.stringify(res2.rows[0], null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        process.exit();
    }
}
check();
