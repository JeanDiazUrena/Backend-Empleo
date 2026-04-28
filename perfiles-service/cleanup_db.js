import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "Jean0124",
    database: "perfiles_db",
});

async function cleanup() {
    try {
        console.log("Iniciando limpieza de perfiles falsos...");
        
        // 1. Eliminar profesionales sin nombre o con nombres de prueba obvios
        const res = await pool.query(`
            DELETE FROM profesionales 
            WHERE nombre IS NULL 
               OR nombre = '' 
               OR nombre = ' ' 
               OR nombre ILIKE '%tormenta%' 
               OR profesion ILIKE '%tormenta%'
            RETURNING id, nombre
        `);
        
        console.log(`Se eliminaron ${res.rowCount} perfiles de profesionales falsos.`);
        res.rows.forEach(row => console.log(` - Eliminado: ${row.nombre || 'Sin nombre'} (ID: ${row.id})`));

        // 2. Podríamos también eliminar clientes falsos si fuera necesario
        // const resClients = await pool.query("DELETE FROM clientes WHERE nombre = '' OR nombre IS NULL RETURNING id");
        // console.log(`Se eliminaron ${resClients.rowCount} clientes falsos.`);

    } catch (err) {
        console.error("Error durante la limpieza:", err);
    } finally {
        await pool.end();
    }
}

cleanup();
