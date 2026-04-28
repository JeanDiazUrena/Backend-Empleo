import pg from "pg";
const { Pool } = pg;

// Pool for perfiles_db
const perfilesPool = new Pool({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "Jean0124",
    database: "perfiles_db",
});

// Pool for trabajo_db
const trabajoPool = new Pool({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "Jean0124",
    database: "trabajo_db",
});

async function backfill() {
    try {
        console.log("Iniciando backfill de títulos y descripciones en trabajos...");
        
        // 1. Obtener todos los trabajos que no tienen título pero sí solicitud_id
        const jobsResult = await trabajoPool.query("SELECT id, solicitud_id FROM trabajos WHERE (titulo IS NULL OR titulo = '') AND solicitud_id IS NOT NULL");
        
        console.log(`Encontrados ${jobsResult.rowCount} trabajos para actualizar.`);

        for (const job of jobsResult.rows) {
            // 2. Buscar la solicitud en perfiles_db
            const solResult = await perfilesPool.query("SELECT titulo, descripcion FROM solicitudes WHERE id = $1", [job.solicitud_id]);
            
            if (solResult.rows.length > 0) {
                const { titulo, descripcion } = solResult.rows[0];
                // 3. Actualizar el trabajo en trabajo_db
                await trabajoPool.query("UPDATE trabajos SET titulo = $1, descripcion = $2 WHERE id = $3", [titulo, descripcion, job.id]);
                console.log(` - Actualizado Trabajo #${job.id} con título: ${titulo}`);
            }
        }
        
        console.log("Backfill completado.");
    } catch (err) {
        console.error("Error durante el backfill:", err);
    } finally {
        await perfilesPool.end();
        await trabajoPool.end();
    }
}

backfill();
