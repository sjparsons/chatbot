import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

/**
 * Opens the database and applies the schema. The schema is idempotent
 * (CREATE TABLE IF NOT EXISTS), which is fine while it is still additive —
 * swap in a real migration tool before the first destructive change.
 */
export function openDatabase(url: string): Db {
  if (url !== ":memory:") {
    mkdirSync(dirname(url), { recursive: true });
  }

  const db = new Database(url);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(readFileSync(resolve(here, "schema.sql"), "utf8"));

  return db;
}
