import pool from './db.js'; pool.query('ALTER TABLE trabajos ALTER COLUMN solicitud_id TYPE integer USING NULL').then(() => { console.log('ALTERED'); pool.end(); }).catch(e => console.error(e));
