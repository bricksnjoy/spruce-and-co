import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, q } from "./harness";

/** Bids (migration 029): every staff member sees them, only admin, manager and finance change them. */
let db: PGlite;
const MANAGER = "00000000-0000-0000-0000-0000000000aa";
const VIEWER = "00000000-0000-0000-0000-0000000000bb";
const NOBODY = "00000000-0000-0000-0000-0000000000cc"; // signed in, but not on the staff list

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}

beforeEach(async () => {
  db = await freshDb();
  for (const [id, role] of [[MANAGER, "manager"], [VIEWER, "viewer"]]) {
    await db.query(`insert into auth.users (id) values ($1)`, [id]);
    await db.query(`insert into profiles (id, full_name, role) values ($1, 'X', $2)`, [id, role]);
  }
  await db.query(`insert into auth.users (id) values ($1)`, [NOBODY]);
});

describe("bids", () => {
  it("a manager adds a bid and moves it along; its history keeps each step", async () => {
    const bid = await as(MANAGER, () => one<{ id: string; status: string; created_by: string }>(db,
      `insert into bids (name, company, gazette_url, prebid_meeting_at, prebid_attendance) values
       ('School hall, Th. Vilufushi', 'Ministry of Education', 'https://www.gazette.gov.mv/iulaan/123', '2026-11-03 05:00+00', 'compulsory')
       returning id, status, created_by`));
    expect(bid).toMatchObject({ status: "registered", created_by: MANAGER });
    await as(MANAGER, async () => {
      await db.query(`update bids set status = 'submitted' where id = $1`, [bid.id]);
      await db.query(`insert into bid_events (bid_id, status, note) values ($1, 'submitted', 'handed in')`, [bid.id]);
    });
    const history = await as(VIEWER, () => q<{ status: string; note: string }>(db, `select status, note from bid_events where bid_id = $1`, [bid.id]));
    expect(history).toEqual([{ status: "submitted", note: "handed in" }]);
    // deleting the bid takes its history with it
    await db.query(`delete from bids where id = $1`, [bid.id]);
    expect(await q(db, `select 1 from bid_events`)).toHaveLength(0);
  });

  it("a viewer sees bids but cannot add or change them; someone not on the staff sees nothing", async () => {
    await as(MANAGER, () => db.query(`insert into bids (name) values ('Jetty repair')`));
    expect(await as(VIEWER, () => q(db, `select name from bids`))).toEqual([{ name: "Jetty repair" }]);
    await expect(as(VIEWER, () => db.query(`insert into bids (name) values ('Mine')`))).rejects.toThrow(/row-level security/);
    await as(VIEWER, () => db.query(`update bids set status = 'won'`));
    expect((await q<{ status: string }>(db, `select status from bids`))[0].status).toBe("registered");
    expect(await as(NOBODY, () => q(db, `select name from bids`))).toEqual([]);
  });

  it("refuses an unknown stage, a blank name, a link that is not a web address, and attendance other than optional or compulsory", async () => {
    await expect(db.query(`insert into bids (name, status) values ('A', 'maybe')`)).rejects.toThrow(/check/);
    await expect(db.query(`insert into bids (name) values ('  ')`)).rejects.toThrow(/check/);
    await expect(db.query(`insert into bids (name, gazette_url) values ('A', 'gazette.gov.mv')`)).rejects.toThrow(/check/);
    await expect(db.query(`insert into bids (name, prebid_attendance) values ('A', 'sometimes')`)).rejects.toThrow(/check/);
  });
});
