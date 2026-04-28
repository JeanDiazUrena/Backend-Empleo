import pool from './db.js';

async function migrate() {
    try {
        console.log("Running migration...");
        await pool.query(`
            ALTER TABLE trabajos 
            ADD COLUMN IF NOT EXISTS cliente_nombre TEXT,
            ADD COLUMN IF NOT EXISTS categoria TEXT;
        `);
        console.log("Migration successful: added cliente_nombre and categoria to trabajos table.");
        
        const res = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'trabajos'");
        console.log("Current columns:", res.rows.map(r => r.column_name).join(", "));
    } catch (err) {
        console.error("Migration failed:", err.message);
    } finally {
        process.exit();
    }
}
migrate();
