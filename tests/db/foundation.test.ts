import { describe, expect, it } from "vitest";
import { freshDb, one, q } from "./harness";

describe("settings, rates, accounts, contacts", () => {
  it("dates GST rates: 6% before 2023, 8% from 1 Jan 2023", async () => {
    const db = await freshDb();
    const r = await one<{ before: string; after: string }>(db,
      `select tax_rate(id, '2022-12-31') before, tax_rate(id, '2023-01-01') after from tax_codes where code = 'STD'`);
    expect([Number(r.before), Number(r.after)]).toEqual([6, 8]);
  });

  it("taxes by brackets (BPT: 15% above 500,000)", async () => {
    const db = await freshDb();
    const r = await one<{ t: string }>(db, `select bracket_tax(750000, rate_brackets('bpt','default','2026-06-30')) t`);
    expect(Number(r.t)).toBe(37500);
  });

  it("numbers documents without gaps or clashes", async () => {
    const db = await freshDb();
    const a = await one<{ a: string; b: string }>(db, `select next_doc_number('invoice','2026-03-01') a, next_doc_number('invoice','2026-03-01') b`);
    expect([a.a, a.b]).toEqual(["SC-INV/26/001", "SC-INV/26/002"]);
  });

  it("seeds the chart of accounts with one of each control account", async () => {
    const db = await freshDb();
    const r = await one<{ ar: string; ap: string; n: string }>(db,
      `select acct('ar') ar, acct('ap') ap, (select count(*) from accounts where parent_id is null) n`);
    expect(r.ar).toBeTruthy();
    // §2 lists 14 asset, 17 liability, 4 equity, 3 income, 7 job-cost and 16 expense accounts
    expect(Number(r.n)).toBe(61);
    await expect(db.query(`insert into accounts (code, name, type, subtype) values ('1101','AR 2','asset','ar')`)).rejects.toThrow();
  });

  it("copies partners in with their own loan and profit-share sub-accounts", async () => {
    const db = await freshDb();
    const rows = await q<{ name: string }>(db,
      `select a.name from accounts a join contacts c on c.id = a.contact_id order by a.code`);
    expect(rows.map((r) => r.name)).toContain("Capital Pool Loans – Mujahid");
    expect(rows.map((r) => r.name)).toContain("Profit Share Payable – Mariyam Zahir");
    expect(rows).toHaveLength(8);
    const c = await one<{ n: string; review: string }>(db, `select count(*) n, count(*) filter (where needs_review) review from contacts`);
    expect([Number(c.n), Number(c.review)]).toEqual([7, 3]);
  });

  it("keeps system accounts from being deleted or repurposed", async () => {
    const db = await freshDb();
    await expect(db.query(`delete from accounts where subtype = 'ar'`)).rejects.toThrow(/system account/);
    await expect(db.query(`update accounts set type = 'expense' where subtype = 'ar'`)).rejects.toThrow(/system account/);
  });
});
