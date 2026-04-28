import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "Jean0124",
    database: "trabajo_db",
});

async function migrate() {
    try {
        console.log("Iniciando migración de la tabla trabajos...");
        
        await pool.query(`
            ALTER TABLE trabajos 
            ADD COLUMN IF NOT EXISTS titulo VARCHAR(255),
            ADD COLUMN IF NOT EXISTS descripcion TEXT
        `);
        
        console.log("Migración completada exitosamente.");
    } catch (err) {
        console.error("Error durante la migración:", err);
    } finally {
        await pool.end();
    }
}

migrate();
