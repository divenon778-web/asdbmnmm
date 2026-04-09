const db = require('./db');
const redis = require('./redis');

async function migrate() {
    console.log('Starting migration from SQLite to Redis...');
    
    try {
        const rows = db.prepare('SELECT * FROM keys').all();
        console.log(`Found ${rows.length} keys in SQLite.`);

        for (const row of rows) {
            const redisKey = `WAVE:KEY:${row.key_string}`;
            const data = {
                key: row.key_string,
                type: row.type,
                is_active: row.is_active,
                expires_at: row.expires_at || 'null',
                hardware_id: row.hardware_id || 'null',
                created_at: row.created_at
            };
            
            await redis.hmset(redisKey, data);
            console.log(`Migrated: ${row.key_string} (${row.type})`);
        }

        console.log('Migration completed successfully!');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        process.exit(0);
    }
}

// Give redis a second to connect
setTimeout(migrate, 1000);
