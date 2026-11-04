import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/** Bids: the Posted stage, the Bid summary topic, and Won / Lost pressed in Telegram (055). */
let db: PGlite;
const KEY = "k".repeat(40);
const anon = async <T,>(fn: () => Promise<T>) => {
  await db.exec(`set role anon`);
  try { return await fn(); } finally { await db.exec(`reset role`); }
};
let bid: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into bot_keys (name, key_hash) values ('telegram', encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [KEY]);
  bid = (await one<{ id: string }>(db, `insert into bids (name, status) values ('Call center', 'posted') returning id`)).id;
});
afterEach(async () => { await assertHealthy(db); });

describe("submitted bids in the Bid summary topic", () => {
  it("has a Posted stage before Registered", async () => {
    await db.query(`insert into bid_events (bid_id, status) values ($1, 'posted')`, [bid]);
    await expect(db.query(`update bids set status = 'mailed' where id = $1`, [bid])).rejects.toThrow();
  });

  it("starts with the bid summary topic, and the bot can move it", async () => {
    expect(await q(db, `select value from bot_settings where name = 'summary_topic'`)).toEqual([{ value: "37" }]);
    await anon(() => db.query(`select bot_put_setting($1, 'summary_topic', '42')`, [KEY]));
    expect(await q(db, `select value from bot_settings where name = 'summary_topic'`)).toEqual([{ value: "42" }]);
    await expect(anon(() => db.query(`select bot_put_setting($1, 'summary_topic', '1')`, ["x".repeat(40)]))).rejects.toThrow(/Not allowed/);
  });

  it("moves the bid to won or lost when pressed, with who pressed it in its history", async () => {
    await db.query(`update bids set status = 'submitted' where id = $1`, [bid]);
    expect(await anon(() => q(db, `select name, status from bot_set_bid_status($1, $2, 'won', 'Muaz')`, [KEY, bid])))
      .toEqual([{ name: "Call center", status: "won" }]);
    expect(await q(db, `select status, note from bid_events where bid_id = $1`, [bid])).toEqual([{ status: "won", note: "From Telegram, by Muaz" }]);
    await anon(() => db.query(`select bot_set_bid_status($1, $2, 'lost', '')`, [KEY, bid]));
    expect((await one<{ status: string }>(db, `select status from bids where id = $1`, [bid])).status).toBe("lost");
    await expect(anon(() => db.query(`select bot_set_bid_status($1, $2, 'posted', 'x')`, [KEY, bid]))).rejects.toThrow(/Only won/);
    await expect(anon(() => db.query(`select bot_set_bid_status($1, $2, 'won', 'x')`, ["x".repeat(40), bid]))).rejects.toThrow(/Not allowed/);
  });
});
