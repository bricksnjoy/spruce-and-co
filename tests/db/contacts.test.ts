import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/** Customer and vendor balances, overdue amounts and statements (migration 016). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const save = (p: object) => as(ADMIN, () => one<{ id: string }>(db, `select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)])).then((r) => r.id);
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;
const contact = async (name: string, kinds: string) =>
  (await one<{ id: string }>(db, `insert into contacts (name, kinds) values ($1, $2::text[]) returning id`, [name, kinds])).id;
type Bal = { receivable: string; payable: string; overdue_receivable: string; overdue_payable: string; documents: string };
const bal = (id: string) => as(ADMIN, () => one<Bal>(db,
  `select receivable::text, payable::text, overdue_receivable::text, overdue_payable::text, documents::text from contact_balances_v where contact_id = $1`, [id]));

beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [ADMIN]);
});

describe("contact balances", () => {
  it("come from the ledger: owed, overdue, and what has been paid", async () => {
    const c = await contact("Resort Co", "{customer}");
    const bank = await acct("1010");
    const old = await save({ type: "invoice", date: "2026-01-10", due_date: "2026-02-10", contact_id: c, lines: [{ amount: "1000.00" }] });
    await save({ type: "invoice", date: "2099-01-10", due_date: "2099-02-10", contact_id: c, lines: [{ amount: "500.00" }] });
    expect(await bal(c)).toEqual({ receivable: "1500.00", payable: "0", overdue_receivable: "1000.00", overdue_payable: "0", documents: "2" });

    await save({ type: "customer_payment", date: "2026-02-20", contact_id: c, bank_account_id: bank, total_amount: "400.00", applications: [{ to: old, amount: "400.00" }] });
    expect(await bal(c)).toMatchObject({ receivable: "1100.00", overdue_receivable: "600.00" });
    await assertHealthy(db);
  });

  it("keeps vendors on the payable side and ignores drafts and voids", async () => {
    const v = await contact("Timber Ltd", "{vendor}");
    const mat = await acct("5000");
    const bill = await save({ type: "bill", date: "2026-01-05", due_date: "2026-01-20", contact_id: v, lines: [{ account_id: mat, amount: "250.00" }] });
    await save({ type: "bill", date: "2026-01-06", due_date: "2026-01-20", contact_id: v, is_draft: true, lines: [{ account_id: mat, amount: "999.00" }] });
    expect(await bal(v)).toMatchObject({ payable: "250.00", overdue_payable: "250.00", receivable: "0" });
    await as(ADMIN, () => db.query(`select rpc_void($1, 'entered twice')`, [bill]));
    expect(await bal(v)).toMatchObject({ payable: "0", overdue_payable: "0" });
  });

  it("show only the book you are in", async () => {
    const live = await contact("Live Co", "{customer}");
    await save({ type: "invoice", date: "2026-01-10", contact_id: live, lines: [{ amount: "10.00" }] });
    await as(ADMIN, () => db.query(`select rpc_set_book('sandbox')`));
    expect(await as(ADMIN, () => q(db, `select * from contact_balances_v where contact_id = $1`, [live]))).toEqual([]);
  });
});

describe("statements", () => {
  it("bring the balance forward and run it down each document", async () => {
    const c = await contact("Resort Co", "{customer}");
    const bank = await acct("1010");
    await save({ type: "invoice", date: "2026-01-10", contact_id: c, lines: [{ amount: "1000.00" }] });
    const inv2 = await save({ type: "invoice", date: "2026-02-10", contact_id: c, lines: [{ amount: "300.00" }] });
    await save({ type: "customer_payment", date: "2026-02-15", contact_id: c, bank_account_id: bank, total_amount: "300.00", applications: [{ to: inv2, amount: "300.00" }] });
    await save({ type: "credit_note", date: "2026-02-20", contact_id: c, lines: [{ amount: "100.00" }] });

    const rows = await as(ADMIN, () => q<{ type: string | null; amount: string | null; balance: string }>(db,
      `select type::text, amount::text, balance::text from contact_statement($1, 'customer', '2026-02-01', '2026-02-28')`, [c]));
    expect(rows).toEqual([
      { type: null, amount: null, balance: "1000.00" },
      { type: "invoice", amount: "300.00", balance: "1300.00" },
      { type: "customer_payment", amount: "-300.00", balance: "1000.00" },
      { type: "credit_note", amount: "-100.00", balance: "900.00" },
    ]);
    // it ends where the ledger does
    expect((await bal(c)).receivable).toBe("900.00");
  });

  it("shows a vendor what we owe them", async () => {
    const v = await contact("Timber Ltd", "{vendor}");
    const rows = await as(ADMIN, async () => {
      await save({ type: "bill", date: "2026-03-01", contact_id: v, lines: [{ account_id: await acct("5000"), amount: "80.00" }] });
      return q<{ amount: string | null; balance: string }>(db, `select amount::text, balance::text from contact_statement($1, 'vendor', '2026-01-01', '2026-12-31')`, [v]);
    });
    expect(rows.at(-1)).toEqual({ amount: "80.00", balance: "80.00" });
  });
});
