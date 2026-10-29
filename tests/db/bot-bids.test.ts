import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, q } from "./harness";

/** The bot reads the bids only with its key (043). */
let db: PGlite;
const KEY = "a".repeat(40);
const asAnon = async <T,>(fn: () => Promise<T>) => {
  await db.exec(`set role anon`);
  try { return await fn(); } finally { await db.exec(`reset role`); }
};

beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into bot_keys (name, key_hash) values ('telegram', encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [KEY]);
  await db.query(`insert into bids (name, company, status, submission_due_at) values ('School hall', 'Ministry', 'registered', '2026-11-20T08:30:00Z'), ('Jetty', null, 'won', null)`);
});
afterEach(async () => { await assertHealthy(db); });

describe("the bot's view of the bids", () => {
  it("gives every bid with its stage and dates for the right key", async () => {
    const rows = await asAnon(() => q<{ name: string; status: string }>(db, `select name, status from bot_bids($1)`, [KEY]));
    expect(rows).toEqual([{ name: "School hall", status: "registered" }, { name: "Jetty", status: "won" }]);
  });

  it("refuses any other key, and the keys themselves cannot be read", async () => {
    await expect(asAnon(() => q(db, `select * from bot_bids($1)`, ["b".repeat(40)]))).rejects.toThrow(/Not allowed/);
    await expect(asAnon(() => q(db, `select * from bot_bids(null)`))).rejects.toThrow(/Not allowed/);
    await expect(asAnon(() => q(db, `select * from bot_keys`))).rejects.toThrow(/permission denied/);
    await expect(asAnon(() => q(db, `select * from bids`))).rejects.toThrow(/permission denied/);
  });
});
