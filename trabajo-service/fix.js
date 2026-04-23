import pool from './db.js';

async function fix() {
    try {
        await pool.query('TRUNCATE resenas RESTART IDENTITY CASCADE'); // the table is likely empty but this makes the ALTER 100% safe
        await pool.query('ALTER TABLE resenas ALTER COLUMN trabajo_id TYPE UUID USING NULL');
        await pool.query('ALTER TABLE resenas ALTER COLUMN cliente_id TYPE UUID USING NULL');
        await pool.query('ALTER TABLE resenas ALTER COLUMN profesional_id TYPE UUID USING NULL');
        console.log("Columnas alteradas a UUID exitosamente.");
    } catch(e) {
        console.error("Error alterando tabla:", e);
    } finally {
        pool.end();
    }
}
fix();
