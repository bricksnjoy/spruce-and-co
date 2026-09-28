import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { migrations, q } from "./harness";

const ROOT = join(__dirname, "..", "..", "db");
const shape = (db: PGlite) => q<{ s: string }>(db, `
  select 'col ' || table_name || '.' || column_name || ' ' || data_type s from information_schema.columns where table_schema = 'public'
  union all select 'fn ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all select 'type ' || t.typname from pg_type t where t.typnamespace = 'public'::regnamespace and t.typtype = 'e'
  union all select 'trigger ' || tgrelid::regclass || '.' || tgname from pg_trigger where not tgisinternal
  order by 1`).then((r) => r.map((x) => x.s));

describe("migrations are non-destructive and reversible", () => {
  it("every down script undoes its up script, leaving production's schema and data as they were", async () => {
    const db = await PGlite.create();
    await db.exec(readFileSync(join(ROOT, "baseline", "existing.sql"), "utf8"));
    const before = await shape(db);
    const rowsBefore = await q<{ n: string }>(db, `select (select count(*) from clients) + (select count(*) from vendors) + (select count(*) from projects) + (select count(*) from people) n`);
    for (const f of migrations("up")) await db.exec(readFileSync(join(ROOT, "migrations", f), "utf8"));
    for (const f of migrations("down")) {
      try { await db.exec(readFileSync(join(ROOT, "migrations", f), "utf8")); }
      catch (e) { throw new Error(`${f}: ${(e as Error).message}`); }
    }
    expect(await shape(db)).toEqual(before);
    const rowsAfter = await q<{ n: string }>(db, `select (select count(*) from clients) + (select count(*) from vendors) + (select count(*) from projects) + (select count(*) from people) n`);
    expect(rowsAfter).toEqual(rowsBefore);
    await db.close();
  });
});
