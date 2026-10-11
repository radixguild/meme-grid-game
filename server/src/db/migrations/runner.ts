import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export function runMigrations(db: Database.Database): void {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      applied_at INTEGER DEFAULT (strftime('%s','now'))
    )
  `);

  const migrationsDir = path.join(__dirname);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Zero .sql files is always a packaging bug, never a valid state: tsc emits
  // only .js, so a build that forgets to copy the .sql files leaves this
  // directory empty and every migration silently no-ops — a fresh deploy then
  // runs against a schema-less database. Fail at boot instead.
  if (files.length === 0) {
    throw new Error(
      `[migration] no .sql files in ${migrationsDir} — build did not copy them ` +
        `(server/package.json "build" must copy src/db/migrations/*.sql into dist)`
    );
  }

  const applied = new Set(
    db
      .prepare("SELECT filename FROM _migrations")
      .all()
      .map((r: any) => r.filename)
  );

  // Apply each file and record it in ONE transaction. Without this, a file that
  // fails part-way leaves the schema half-migrated AND unrecorded in _migrations:
  // the next boot retries from the top and dies on whatever already exists, so the
  // process crash-loops permanently with no way out but manual surgery on the
  // production DB. That is not hypothetical — migrations mix idempotent DDL
  // (CREATE TABLE IF NOT EXISTS, INSERT OR IGNORE) with NON-idempotent
  // `ALTER TABLE … ADD COLUMN` (003_streaks_powerups.sql:2-5, and any future
  // column add), and ALTER is exactly what throws on the retry.
  //
  // SQLite runs DDL inside transactions, and no migration issues its own
  // BEGIN/COMMIT/PRAGMA, so wrapping is safe. Rolling back the DDL *and* the
  // bookkeeping together means a failed migration leaves the DB exactly as it was
  // and the next boot can retry cleanly.
  const applyOne = db.transaction((file: string, sql: string) => {
    db.exec(sql);
    db.prepare("INSERT INTO _migrations (filename) VALUES (?)").run(file);
  });

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    try {
      applyOne(file, sql);
    } catch (err) {
      // Surface which file failed — the bare better-sqlite3 error names the
      // offending statement but not the migration it came from.
      throw new Error(
        `[migration] ${file} failed and was rolled back: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    console.log(`[migration] applied: ${file}`);
  }
}
