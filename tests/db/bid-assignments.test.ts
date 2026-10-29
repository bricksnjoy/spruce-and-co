import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/** Who goes to a pre-bid meeting and who hands in the papers, picked in the Telegram group (046). */
let db: PGlite;
const KEY = "k".repeat(40);
const STAFF = "00000000-0000-0000-0000-00000000000a";
const anon = async <T,>(fn: () => Promise<T>) => {
  await db.exec(`set role anon`);
  try { return await fn(); } finally { await db.exec(`reset role`); }
};
let bid: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into bot_keys (name, key_hash) values ('telegram', encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [KEY]);
  bid = (await one<{ id: string }>(db, `insert into bids (name, status) values ('Call center', 'papers_ready') returning id`)).id;
});
afterEach(async () => { await assertHealthy(db); });

describe("assigning people to a bid from Telegram", () => {
  it("remembers the people seen in the group, and forgets those who leave", async () => {
    const seen = JSON.stringify([{ id: 11, name: "Muaz", username: "Muaaazz" }, { id: 12, name: "Dhonbe" }, { id: "x", name: "bad" }]);
    expect(await anon(() => q(db, `select user_id::text, name, username from bot_people($1, $2::jsonb)`, [KEY, seen]))).toEqual([
      { user_id: "12", name: "Dhonbe", username: null }, { user_id: "11", name: "Muaz", username: "Muaaazz" },
    ]);
    expect(await anon(() => q(db, `select name from bot_people($1, $2::jsonb, $3::bigint[])`, [KEY, JSON.stringify([{ id: 11, name: "Muaz H" }]), [12]])))
      .toEqual([{ name: "Muaz H" }]);
  });

  it("puts a person on and takes them off with the same tap, per task", async () => {
    const tap = (user: number, name: string, task = "submit") =>
      anon(() => q<{ name: string }>(db, `select name from bot_assign($1, $2, $3, $4, $5)`, [KEY, bid, task, user, name]));
    expect(await tap(11, "Muaz")).toEqual([{ name: "Muaz" }]);
    expect(await tap(12, "Dhonbe")).toEqual([{ name: "Muaz" }, { name: "Dhonbe" }]);
    expect(await tap(11, "Muaz")).toEqual([{ name: "Dhonbe" }]);
    expect(await tap(11, "Muaz", "prebid")).toEqual([{ name: "Muaz" }]);
    expect(await anon(() => q(db, `select task, name from bot_assignments($1) order by task`, [KEY])))
      .toEqual([{ task: "prebid", name: "Muaz" }, { task: "submit", name: "Dhonbe" }]);
    await expect(tap(13, "X", "lunch")).rejects.toThrow(/Unknown task/);
  });

  it("lets each evening reminder go once a day", async () => {
    const claim = (day: string, step: string) => anon(async () => (await one<{ ok: boolean }>(db, `select bot_claim_run($1, $2, $3) ok`, [KEY, day, step])).ok);
    expect(await claim("2026-10-29", "remind")).toBe(true);
    expect(await claim("2026-10-29", "remind")).toBe(false);
    expect(await claim("2026-10-29", "chase")).toBe(true);
    expect(await claim("2026-10-30", "remind")).toBe(true);
  });

  it("is closed without the key; the staff only read who is going", async () => {
    await expect(anon(() => q(db, `select * from bot_people($1)`, ["z".repeat(40)]))).rejects.toThrow(/Not allowed/);
    await expect(anon(() => q(db, `select * from bot_assign($1, $2, 'submit', 1, 'X')`, ["z".repeat(40), bid]))).rejects.toThrow(/Not allowed/);
    await expect(anon(() => q(db, `select * from telegram_people`))).rejects.toThrow(/permission denied/);
    await anon(() => q(db, `select * from bot_assign($1, $2, 'submit', 11, 'Muaz')`, [KEY, bid]));
    await db.query(`insert into profiles (id, full_name, role) values ($1, 'Staff', 'manager')`, [STAFF]);
    await db.query(`select set_config('app.uid', $1, false)`, [STAFF]);
    await db.exec(`set role authenticated`);
    try {
      expect(await q(db, `select name from bid_assignments`)).toEqual([{ name: "Muaz" }]);
      await expect(q(db, `insert into bid_assignments (bid_id, task, user_id, name) values ($1, 'prebid', 2, 'Y')`, [bid])).rejects.toThrow(/permission denied/);
    } finally { await db.exec(`reset role`); }
  });
});
