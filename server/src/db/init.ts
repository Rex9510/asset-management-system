import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDatabase } from './connection';

export function initializeDatabase(db?: Database.Database): void {
  const database = db || getDatabase();
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  database.exec(schema);
}

// Run directly via: npx ts-node src/db/init.ts
if (require.main === module) {
  console.log('Initializing database...');
  initializeDatabase();
  console.log('Database initialized successfully.');
}
