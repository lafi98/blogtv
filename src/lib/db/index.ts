/**
 * SQLite connection (better-sqlite3). One file-backed database, WAL mode, foreign keys on.
 * All queries elsewhere use prepared statements with bound parameters — never string
 * concatenation of user input — which is the primary SQL-injection defence.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../config';
import { migrations } from './migrations';

type DB = Database.Database;

const globalForDb = globalThis as unknown as { __hhDb?: DB };

export function getDb(): DB {
  if (globalForDb.__hhDb) return globalForDb.__hhDb;
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  const db = new Database(config.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  migrate(db);
  globalForDb.__hhDb = db;
  return db;
}

export function migrate(db: DB): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  const ran: number[] = [];
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.sql);
      m.run?.(db);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        nowIso(),
      );
    })();
    ran.push(m.version);
  }
  return ran;
}

export const nowIso = () => new Date().toISOString();

/** Parse a JSON column defensively. */
export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function audit(action: string, opts: { userId?: number | null; entity?: string; entityId?: number | null; details?: string } = {}) {
  getDb()
    .prepare('INSERT INTO audit_log (user_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(opts.userId ?? null, action, opts.entity ?? '', opts.entityId ?? null, (opts.details ?? '').slice(0, 2000), nowIso());
}
