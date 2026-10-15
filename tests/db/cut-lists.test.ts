import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, q } from "./harness";

/** The cut planner's list in the database (migration 028): one per person, never overwritten by a stale device. */
let db: PGlite;
const A = "00000000-0000-0000-0000-0000000000aa";
const B = "00000000-0000-0000-0000-0000000000bb";
const NOBODY = "00000000-0000-0000-0000-0000000000cc"; // signed in, but not on the staff list

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
type Saved = { updated_at: string; conflict?: boolean; data?: { rows: string[] } };
const save = (uid: string, data: object, base: string | null) =>
  as(uid, () => one<{ r: Saved }>(db, `select rpc_save_cut_list($1::jsonb, $2::timestamptz) r`, [JSON.stringify(data), base]).then((x) => x.r));
const mine = (uid: string) => as(uid, () => q<{ user_id: string; data: { rows: string[] } }>(db, `select user_id, data from cut_lists`));

beforeEach(async () => {
  db = await freshDb();
  for (const [id, role] of [[A, "manager"], [B, "viewer"]]) {
    await db.query(`insert into auth.users (id) values ($1)`, [id]);
    await db.query(`insert into profiles (id, full_name, role) values ($1, 'X', $2)`, [id, role]);
  }
  await db.query(`insert into auth.users (id) values ($1)`, [NOBODY]);
});

describe("saved cut lists", () => {
  it("each person saves and reads only their own list", async () => {
    const a = await save(A, { rows: ["leg"] }, null);
    expect(a.conflict).toBeUndefined();
    await save(B, { rows: ["shelf"] }, null);
    expect(await mine(A)).toEqual([{ user_id: A, data: { rows: ["leg"] } }]);
    expect(await mine(B)).toEqual([{ user_id: B, data: { rows: ["shelf"] } }]);
    await expect(save(NOBODY, { rows: [] }, null)).rejects.toThrow(/row-level security/);
  });

  it("a device holding an older copy cannot overwrite a newer save; it gets the newer list back", async () => {
    const first = await save(A, { rows: ["leg"] }, null);
    const phone = await save(A, { rows: ["leg", "top"] }, first.updated_at); // the phone started from the first copy
    expect(phone.conflict).toBeUndefined();
    const pc = await save(A, { rows: ["leg", "drawer"] }, first.updated_at); // the PC still holds the first copy
    expect(pc).toMatchObject({ conflict: true, data: { rows: ["leg", "top"] }, updated_at: phone.updated_at });
    expect((await mine(A))[0].data.rows).toEqual(["leg", "top"]);
    // keeping the PC's list, knowingly: it saves on top of the copy it was shown
    await save(A, { rows: ["leg", "drawer"] }, pc.updated_at);
    expect((await mine(A))[0].data.rows).toEqual(["leg", "drawer"]);
  });

  it("refuses something that is not a list", async () => {
    await expect(save(A, [1, 2] as unknown as object, null)).rejects.toThrow(/check constraint/);
  });
});
