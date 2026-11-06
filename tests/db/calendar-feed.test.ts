import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, q } from "./harness";

/** The calendar feed reads tasks and milestones with the bot's key only (056). */
let db: PGlite;
const KEY = "k".repeat(40);
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into bot_keys (name, key_hash) values ('telegram', encode(sha256(convert_to($1, 'UTF8')), 'hex'))`, [KEY]);
});
afterEach(async () => { await assertHealthy(db); });

describe("the calendar feed's items", () => {
  it("answers the bot's key, where the tables are not there with nothing, and refuses any other", async () => {
    await db.exec(`set role anon`);
    try {
      expect(await q(db, `select * from bot_calendar_items($1)`, [KEY])).toEqual([]);
      await expect(db.query(`select * from bot_calendar_items($1)`, ["x".repeat(40)])).rejects.toThrow(/Not allowed/);
    } finally { await db.exec(`reset role`); }
  });

  it("lists open tasks with a due date and milestones not reached, of projects not deleted", async () => {
    await db.exec(`create table project_tasks (id uuid primary key default gen_random_uuid(), project_id uuid, title text, status text, due_date date);
      create table milestones (id uuid primary key default gen_random_uuid(), project_id uuid, name text, status text, planned_date date);`);
    const p = (await q<{ id: string }>(db, `insert into projects (code, name, contract_value, status) values ('SC-9', 'Villa', 1, 'in_progress') returning id`))[0].id;
    await db.query(`insert into project_tasks (project_id, title, status, due_date) values ($1, 'Tiles', 'todo', '2026-11-12'), ($1, 'Done one', 'completed', '2026-11-01'), ($1, 'No date', 'todo', null)`, [p]);
    await db.query(`insert into milestones (project_id, name, status, planned_date) values ($1, 'Handover', 'planned', '2026-12-01')`, [p]);
    expect(await q(db, `select kind, title, day::text, project from bot_calendar_items($1) order by day`, [KEY])).toEqual([
      { kind: "task", title: "Tiles", day: "2026-11-12", project: "SC-9 · Villa" },
      { kind: "milestone", title: "Handover", day: "2026-12-01", project: "SC-9 · Villa" },
    ]);
  });
});
