import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getDatabase } from './connection';

export function initializeDatabase(db?: Database.Database): void {
  const database = db || getDatabase();

  // Phase 1: base schema
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  database.exec(schema);

  // Phase 2: migration
  runPhase2Migration(database);
}

export function runPhase2Migration(database: Database.Database): void {
  // 1. Create all new Phase 2 tables
  const migrationPath = path.resolve(__dirname, 'migration-phase2.sql');
  const migration = fs.readFileSync(migrationPath, 'utf-8');
  database.exec(migration);

  // 2. Add stop_loss_price column to positions (idempotent)
  const positionCols = database.prepare('PRAGMA table_info(positions)').all() as { name: string }[];
  const hasStopLoss = positionCols.some((c) => c.name === 'stop_loss_price');
  if (!hasStopLoss) {
    database.exec('ALTER TABLE positions ADD COLUMN stop_loss_price REAL');
  }

  // 2b. Add last_login_at column to users (idempotent, for 24h inactive user filtering)
  const userCols = database.prepare('PRAGMA table_info(users)').all() as { name: string }[];
  const hasLastLogin = userCols.some((c) => c.name === 'last_login_at');
  if (!hasLastLogin) {
    database.exec('ALTER TABLE users ADD COLUMN last_login_at DATETIME');
  }

  // 2c. Add agreed_terms column to users (idempotent, for user agreement tracking)
  const hasAgreedTerms = userCols.some((c) => c.name === 'agreed_terms');
  if (!hasAgreedTerms) {
    database.exec('ALTER TABLE users ADD COLUMN agreed_terms INTEGER DEFAULT 0');
  }

  // 3. Recreate messages table without CHECK constraint on type
  //    SQLite doesn't support ALTER COLUMN, so we rebuild the table
  //    to remove the type CHECK constraint (Phase 2 adds 9 new message types).
  //    Only rebuild if the old CHECK constraint still exists.
  const messagesSchema = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='messages'"
  ).get() as { sql: string } | undefined;

  if (messagesSchema && messagesSchema.sql.includes("CHECK(type IN")) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS messages_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        stock_code TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT NOT NULL,
        analysis_id INTEGER,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (analysis_id) REFERENCES analyses(id)
      );
      INSERT INTO messages_new SELECT * FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_new RENAME TO messages;
    `);
  }
}

// Run directly via: npx ts-node src/db/init.ts
if (require.main === module) {
  console.log('Initializing database...');
  initializeDatabase();
  console.log('Database initialized successfully.');
}
