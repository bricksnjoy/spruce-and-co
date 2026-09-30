import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDb, one, q } from "./harness";

/** People = employees, and changing a draft run's staff (migration 022). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";
const VIEWER = "00000000-0000-0000-0000-00000000000c";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}

beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin'), ($2, 'Viewer', 'viewer')`, [ADMIN, VIEWER]);
  await db.query(`insert into rates (kind, code, brackets, effective_from) values ('wht', 'default', '[{"from": 0, "to": null, "rate": 0}]', '2020-01-01')`);
  await db.query(`update employees set active = false`);
});

describe("people and employees are one list", () => {
  it("a new Live employee appears in the old people list the Message Center reads, and changes follow", async () => {
    const e = (await one<{ id: string }>(db, `insert into employees (name, job_title, phone, email, basic_salary) values ('Aisha', 'Site supervisor', '7771234', 'a@x.mv', 15000) returning id`)).id;
    const p = await one<{ name: string; title: string; phone: string; role: string }>(db,
      `select p.name, p.title, p.phone, p.role::text from people p join employees e on e.legacy_person_id = p.id where e.id = $1`, [e]);
    expect(p).toEqual({ name: "Aisha", title: "Site supervisor", phone: "7771234", role: "employee" });
    await db.query(`update employees set phone = '7779999', active = false where id = $1`, [e]);
    expect(await q(db, `select p.phone, p.active from people p join employees e on e.legacy_person_id = p.id where e.id = $1`, [e])).toEqual([{ phone: "7779999", active: false }]);
    // a Test-book employee stays out of it
    const before = Number((await one<{ n: string }>(db, `select count(*) n from people`)).n);
    await db.query(`insert into employees (name, book) values ('Trial', 'sandbox')`);
    expect(Number((await one<{ n: string }>(db, `select count(*) n from people`)).n)).toBe(before);
  });
});

describe("a draft run's staff", () => {
  it("can gain a new hire and lose someone until it is approved", async () => {
    const a = (await one<{ id: string }>(db, `insert into employees (name, basic_salary, nationality_type) values ('A', 10000, 'expatriate') returning id`)).id;
    const run = await as(ADMIN, () => one<{ id: string }>(db, `select rpc_create_payroll_run('2026-04-01', '2026-04-30') id`)).then((r) => r.id);
    const b = (await one<{ id: string }>(db, `insert into employees (name, basic_salary, nationality_type) values ('B', 8000, 'expatriate') returning id`)).id;
    const slip = await as(ADMIN, () => one<{ id: string }>(db, `select rpc_add_payslip($1, $2) id`, [run, b])).then((r) => r.id);
    expect((await one<{ net: string }>(db, `select net::text from payslips where id = $1`, [slip])).net).toBe("8000.00");
    await expect(as(ADMIN, () => db.query(`select rpc_add_payslip($1, $2)`, [run, b]))).rejects.toThrow(/already in this run/);
    await expect(as(VIEWER, () => db.query(`select rpc_add_payslip($1, $2)`, [run, a]))).rejects.toThrow(/payroll permission/);

    const aSlip = (await one<{ id: string }>(db, `select id from payslips where run_id = $1 and employee_id = $2`, [run, a])).id;
    await as(ADMIN, () => db.query(`select rpc_remove_payslip($1)`, [aSlip]));
    expect(await q(db, `select employee_id from payslips where run_id = $1`, [run])).toEqual([{ employee_id: b }]);

    await as(ADMIN, () => db.query(`select rpc_approve_payroll_run($1)`, [run]));
    await expect(as(ADMIN, () => db.query(`select rpc_add_payslip($1, $2)`, [run, a]))).rejects.toThrow(/approved/);
    await expect(as(ADMIN, () => db.query(`select rpc_remove_payslip($1)`, [slip]))).rejects.toThrow(/approved/);
  });
});
