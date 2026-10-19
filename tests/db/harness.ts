import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

export type Db = PGlite | Transaction;

const ROOT = join(__dirname, "..", "..", "db");

/** The migration files in order, as they are applied to Supabase. */
export function migrations(dir: "up" | "down" = "up") {
  const files = readdirSync(join(ROOT, "migrations")).filter((f) => f.endsWith(`.${dir}.sql`)).sort();
  return dir === "up" ? files : files.reverse();
}

let template: Blob | File | null = null;

/**
 * A fresh database that looks like production (baseline) with every migration
 * applied. Built once per test file, then copied for each test.
 */
export async function freshDb(): Promise<PGlite> {
  if (!template) {
    const db = await PGlite.create();
    await db.exec(readFileSync(join(ROOT, "baseline", "existing.sql"), "utf8"));
    for (const f of migrations("up")) {
      try {
        await db.exec(readFileSync(join(ROOT, "migrations", f), "utf8"));
      } catch (e) {
        throw new Error(`${f}: ${(e as Error).message}`);
      }
    }
    template = await db.dumpDataDir("none");
    await db.close();
  }
  return PGlite.create({ loadDataDir: template });
}

/** Run a statement and return its rows. */
export async function q<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const rows = await q<T>(db, sql, params);
  if (rows.length !== 1) throw new Error(`expected one row, got ${rows.length}: ${sql}`);
  return rows[0];
}

/** Numeric columns come back as strings; compare money as exact decimal strings. */
export const n = (v: unknown) => Number(v ?? 0).toFixed(2);

/** The §13 invariants must hold after every scenario. */
export async function assertHealthy(db: Db) {
  const bad = await q<{ no: number; name: string; detail: string }>(db, `select no, name, detail from health_check() where not ok`);
  if (bad.length) throw new Error("Health check failed: " + bad.map((b) => `#${b.no} ${b.name} (${b.detail})`).join("; "));
}
