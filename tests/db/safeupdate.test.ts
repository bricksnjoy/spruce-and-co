import { describe, expect, it } from "vitest";
import { freshDb, q } from "./harness";

/**
 * Supabase runs API requests with safeupdate: a DELETE or UPDATE with no WHERE
 * is refused, even inside a function. PGlite does not load it, so this reads
 * every function's final definition and fails on such a statement.
 */
describe("safeupdate", () => {
  it("no function deletes or updates without a WHERE", async () => {
    const db = await freshDb();
    const fns = await q<{ name: string; def: string }>(db,
      `select p.oid::regprocedure::text name, pg_get_functiondef(p.oid) def from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prolang in (select oid from pg_language where lanname in ('plpgsql', 'sql'))`);
    const bad: string[] = [];
    for (const f of fns) {
      const body = f.def.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ""); // no strings or comments
      for (const m of body.matchAll(/\b(?:delete\s+from\s+[\w."]+|update\s+[\w."]+(?:\s+\w+)?\s+set\b)[^;]*;/gi)) {
        if (!/\bwhere\b/i.test(m[0])) bad.push(`${f.name}: ${m[0].replace(/\s+/g, " ").slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
