import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { assertHealthy, freshDb, one, q } from "./harness";

/** Banking: statement import and matching, adding lines, rules, reconciliation (migration 023). */
let db: PGlite;
const ADMIN = "00000000-0000-0000-0000-00000000000a";

async function as<T>(uid: string, fn: () => Promise<T>): Promise<T> {
  await db.query(`select set_config('app.uid', $1, false)`, [uid]);
  await db.exec(`set role authenticated`);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('app.uid', '', false)`); }
}
const save = (p: object) => as(ADMIN, () => one<{ id: string }>(db, `select rpc_save_transaction($1::jsonb) id`, [JSON.stringify(p)])).then((r) => r.id);
const acct = async (code: string) => (await one<{ id: string }>(db, `select id from accounts where code = $1`, [code])).id;
const importLines = (bank: string, lines: object[]) =>
  as(ADMIN, () => one<{ r: { added: number; duplicates: number; matched: number } }>(db, `select rpc_import_statement($1, 'stmt.csv', $2::jsonb) r`, [bank, JSON.stringify(lines)])).then((x) => x.r);
const line = (date: string, description: string, amount: string, fp = `${date}|${description}|${amount}`) => ({ date, description, amount, fingerprint: fp });

let bank: string, customer: string, vendor: string;
beforeEach(async () => {
  db = await freshDb();
  await db.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [ADMIN]);
  bank = await acct("1010");
  customer = (await one<{ id: string }>(db, `insert into contacts (kinds, name) values ('{customer}', 'Resort') returning id`)).id;
  vendor = (await one<{ id: string }>(db, `insert into contacts (kinds, name) values ('{vendor}', 'Timber') returning id`)).id;
});

describe("statement import", () => {
  it("matches lines to the ledger by amount and nearby date, skips duplicates, and leaves the rest open", async () => {
    const inv = await save({ type: "invoice", date: "2026-03-01", contact_id: customer, lines: [{ amount: "5000.00" }] });
    await save({ type: "customer_payment", date: "2026-03-04", contact_id: customer, bank_account_id: bank, total_amount: "5000.00", applications: [{ to: inv, amount: "5000.00" }] });
    const r = await importLines(bank, [line("2026-03-05", "TRF FROM RESORT", "5000.00"), line("2026-03-06", "DHIRAAGU BILL", "-450.00")]);
    expect(r).toEqual({ added: 2, duplicates: 0, matched: 1 });
    expect(await importLines(bank, [line("2026-03-05", "TRF FROM RESORT", "5000.00")])).toEqual({ added: 0, duplicates: 1, matched: 0 });
    const rows = await as(ADMIN, () => q<{ description: string; status: string }>(db, `select description, status from bank_statement_lines order by date`));
    expect(rows).toEqual([{ description: "TRF FROM RESORT", status: "matched" }, { description: "DHIRAAGU BILL", status: "open" }]);
  });

  it("adds an unmatched line to the books: money out as an expense, money in as a journal", async () => {
    await importLines(bank, [line("2026-03-06", "DHIRAAGU BILL", "-450.00"), line("2026-03-07", "INTEREST", "12.50")]);
    const [out, inn] = (await as(ADMIN, () => q<{ id: string }>(db, `select id from bank_statement_lines order by date`))).map((x) => x.id);
    const utilities = await acct("6110"), other = await acct("4900");
    const exp = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_add_from_line($1, $2) id`, [out, utilities]))).id;
    const jnl = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_add_from_line($1, $2) id`, [inn, other]))).id;
    expect(await q(db, `select type::text, doc_total(id)::text total from transactions where id in ($1, $2) order by type`, [exp, jnl]))
      .toEqual([{ type: "expense", total: "450.00" }, { type: "journal", total: "0" }]);
    expect(await as(ADMIN, () => q(db, `select status from bank_statement_lines order by date`))).toEqual([{ status: "added" }, { status: "added" }]);
    const b = await one<{ b: string }>(db, `select sum(debit - credit)::text b from journal_lines where account_id = $1`, [bank]);
    expect(b.b).toBe("-437.50");
    await expect(as(ADMIN, () => db.query(`select rpc_add_from_line($1, $2)`, [out, utilities]))).rejects.toThrow(/already dealt with/);
    await assertHealthy(db);
  });

  it("suggests the rule that fits, and lets a line be matched by hand or excluded", async () => {
    await db.query(`insert into bank_rules (name, contains, direction, account_id) values ('Phone', 'dhiraagu', 'out', $1), ('Any out', null, 'out', $2)`, [await acct("6110"), await acct("6130")]);
    await db.query(`update bank_rules set priority = 200 where name = 'Any out'`);
    await importLines(bank, [line("2026-03-06", "DHIRAAGU BILL", "-450.00"), line("2026-03-06", "SERVICE FEE", "-5.00")]);
    const rows = await as(ADMIN, () => q<{ description: string; rule: string }>(db,
      `select b.description, r.name rule from bank_statement_lines b left join bank_rules r on r.id = bank_rule_for(b.id) order by b.description`));
    expect(rows).toEqual([{ description: "DHIRAAGU BILL", rule: "Phone" }, { description: "SERVICE FEE", rule: "Any out" }]);

    const bill = await save({ type: "bill", date: "2026-03-01", contact_id: vendor, lines: [{ account_id: await acct("5000"), amount: "450.00" }] });
    // a payment dated too far away is not matched automatically, but can be by hand
    const pay = await save({ type: "bill_payment", date: "2026-02-10", contact_id: vendor, bank_account_id: bank, total_amount: "450.00", applications: [{ to: bill, amount: "450.00" }] });
    const jl = (await one<{ id: string }>(db, `select id::text from journal_lines where transaction_id = $1 and account_id = $2`, [pay, bank])).id;
    const dhir = (await as(ADMIN, () => one<{ id: string }>(db, `select id from bank_statement_lines where description = 'DHIRAAGU BILL'`))).id;
    const fee = (await as(ADMIN, () => one<{ id: string }>(db, `select id from bank_statement_lines where description = 'SERVICE FEE'`))).id;
    await expect(as(ADMIN, () => db.query(`select rpc_match_line($1, $2)`, [fee, jl]))).rejects.toThrow(/amounts differ/);
    await as(ADMIN, () => db.query(`select rpc_match_line($1, $2)`, [dhir, jl]));
    await as(ADMIN, () => db.query(`select rpc_unmatch_line($1, 'excluded')`, [fee]));
    expect(await as(ADMIN, () => q(db, `select description, status from bank_statement_lines order by description`)))
      .toEqual([{ description: "DHIRAAGU BILL", status: "matched" }, { description: "SERVICE FEE", status: "excluded" }]);
  });
});

describe("reconciliation", () => {
  it("finishes only at a difference of 0, locks what it reconciled, and only the latest can be undone", async () => {
    const inv = await save({ type: "invoice", date: "2026-03-01", contact_id: customer, lines: [{ amount: "1000.00" }] });
    const pay = await save({ type: "customer_payment", date: "2026-03-05", contact_id: customer, bank_account_id: bank, total_amount: "1000.00", applications: [{ to: inv, amount: "1000.00" }] });
    const exp = await save({ type: "expense", date: "2026-03-10", bank_account_id: bank, lines: [{ account_id: await acct("6130"), amount: "25.00" }] });
    const lines = (await q<{ id: string }>(db, `select id::text from journal_lines where account_id = $1 order by date`, [bank])).map((x) => x.id);

    const r1 = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_start_reconciliation($1, '2026-03-31', 975) id`, [bank]))).id;
    await as(ADMIN, () => db.query(`select rpc_set_cleared($1, $2::bigint[], true)`, [r1, [lines[0]]]));
    const st = await as(ADMIN, () => one<{ cleared_balance: string; difference: string }>(db, `select cleared_balance::text, difference::text from reconciliation_status($1)`, [r1]));
    expect(st).toEqual({ cleared_balance: "1000.00", difference: "-25.00" });
    await expect(as(ADMIN, () => db.query(`select rpc_finish_reconciliation($1)`, [r1]))).rejects.toThrow(/must be 0/);
    await as(ADMIN, () => db.query(`select rpc_set_cleared($1, $2::bigint[], true)`, [r1, [lines[1]]]));
    await as(ADMIN, () => db.query(`select rpc_finish_reconciliation($1)`, [r1]));

    // reconciled lines cannot change underneath it
    await expect(as(ADMIN, () => db.query(`select rpc_void($1, 'x')`, [exp]))).rejects.toThrow(/reconciliation/);
    // a later reconciliation, then only the latest can be undone
    const r2 = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_start_reconciliation($1, '2026-04-30', 975) id`, [bank]))).id;
    await as(ADMIN, () => db.query(`select rpc_finish_reconciliation($1)`, [r2]));
    await expect(as(ADMIN, () => db.query(`select rpc_undo_reconciliation($1)`, [r1]))).rejects.toThrow(/Only the latest/);
    await as(ADMIN, () => db.query(`select rpc_undo_reconciliation($1)`, [r2]));
    await as(ADMIN, () => db.query(`select rpc_undo_reconciliation($1)`, [r1]));
    await as(ADMIN, () => db.query(`select rpc_void($1, 'bank error')`, [exp]));
    void pay;
    await assertHealthy(db);
  });

  it("ticking a line cleared is allowed after the books are closed", async () => {
    await save({ type: "expense", date: "2026-01-10", bank_account_id: bank, lines: [{ account_id: await acct("6130"), amount: "10.00" }] });
    await db.query(`update settings set closing_date = '2026-01-31'`);
    const jl = (await one<{ id: string }>(db, `select id::text from journal_lines where account_id = $1`, [bank])).id;
    const r = (await as(ADMIN, () => one<{ id: string }>(db, `select rpc_start_reconciliation($1, '2026-01-31', -10) id`, [bank]))).id;
    await as(ADMIN, () => db.query(`select rpc_set_cleared($1, $2::bigint[], true)`, [r, [jl]]));
    await as(ADMIN, () => db.query(`select rpc_finish_reconciliation($1)`, [r]));
    expect((await one<{ cleared: string }>(db, `select cleared from journal_lines where id = $1`, [jl])).cleared).toBe("reconciled");
  });

  it("the Test reset clears Test banking and leaves Live alone", async () => {
    await importLines(bank, [line("2026-03-06", "LIVE LINE", "-1.00")]);
    await as(ADMIN, () => db.query(`select rpc_set_book('sandbox')`));
    await importLines(bank, [line("2026-03-06", "TEST LINE", "-1.00")]);
    await db.transaction(async (tx) => { await tx.query(`select set_config('app.uid', $1, true)`, [ADMIN]); await tx.query(`select rpc_reset_test_book()`); });
    expect(await q(db, `select description, book from bank_statement_lines`)).toEqual([{ description: "LIVE LINE", book: "live" }]);
  });
});
