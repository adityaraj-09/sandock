import pool from './index.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runJwtMigration() {
  const client = await pool.connect();
  try {
    console.log('Running JWT migration (003_replace_clerk_with_jwt.sql)...');
    
    const migrationSQL = readFileSync(
      join(__dirname, 'migrations', '003_replace_clerk_with_jwt.sql'),
      'utf8'
    );
    
    await client.query(migrationSQL);
    
    console.log('✓ JWT migration completed successfully!');
    console.log('  - Added password_hash column');
    console.log('  - Made clerk_user_id nullable');
    console.log('  - Added unique index on email');
  } catch (error) {
    if (error.code === '42703') {
      console.error('Error: Column already exists or migration already run');
    } else {
      console.error('Migration error:', error.message);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runJwtMigration();

