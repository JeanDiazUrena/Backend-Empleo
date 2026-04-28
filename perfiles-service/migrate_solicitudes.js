import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "Jean0124",
    database: "perfiles_db",
});

async function migrate() {
    try {
        console.log("Migrando tabla solicitudes...");
        await pool.query(`
            ALTER TABLE solicitudes 
            ADD COLUMN IF NOT EXISTS urgencia VARCHAR(50),
            ADD COLUMN IF NOT EXISTS ubicacion VARCHAR(255),
            ADD COLUMN IF NOT EXISTS disponibilidad VARCHAR(100),
            ADD COLUMN IF NOT EXISTS presupuesto_min DECIMAL(12,2),
            ADD COLUMN IF NOT EXISTS presupuesto_max DECIMAL(12,2)
        `);
        console.log("OK - Columnas agregadas.");
    } catch (err) {
        console.error("Error:", err.message);
    } finally {
        await pool.end();
    }
}
migrate();
