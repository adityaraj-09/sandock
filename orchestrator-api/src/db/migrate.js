import pool from './index.js';
import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running database migrations...');
    
    // Run schema.sql first (creates tables if they don't exist)
    // Wrap in try-catch to handle already existing objects
    try {
      const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
      await client.query(schema);
      console.log('✓ Schema applied');
    } catch (error) {
      if (error.code === '42710' || error.code === '42P07') {
        // Object already exists (trigger, table, etc.)
        console.log('✓ Schema already exists, skipping...');
      } else {
        throw error;
      }
    }
    
    // Run all migration files in order
    const migrationsDir = join(__dirname, 'migrations');
    const migrationFiles = readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Sort to ensure order (001, 002, 003, etc.)
    
    for (const file of migrationFiles) {
      console.log(`Running migration: ${file}...`);
      try {
        const migrationSQL = readFileSync(join(migrationsDir, file), 'utf8');
        await client.query(migrationSQL);
        console.log(`✓ ${file} completed`);
      } catch (error) {
        // Skip if column/index already exists
        if (error.code === '42703' || error.code === '42P07' || error.message.includes('already exists')) {
          console.log(`⚠ ${file} - Some objects already exist, skipping...`);
        } else {
          throw error;
        }
      }
    }
    
    console.log('\nAll migrations completed successfully!');
  } catch (error) {
    console.error('Migration error:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();

