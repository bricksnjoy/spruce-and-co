import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { freshDb, one } from "./harness";
import { docStatus } from "@/lib/doc-status";

/** The status shown on screen is the database's document_status(), case for case. */
describe("document status on screen", () => {
  it("matches the database for every combination", async () => {
    const db = await freshDb();
    const today = (await one<{ d: string }>(db, `select today_mv()::text d`)).d;
    const sqlStatus = `select case
      when $1::timestamptz is not null then 'void' when $2::boolean then 'draft'
      when $3::text not in ('invoice', 'bill') then 'posted'
      when $4::numeric > 0 and $5::numeric >= $4::numeric then 'paid'
      when $4::numeric - $5::numeric > 0 and $6::date < today_mv() then 'overdue'
      when $5::numeric > 0 then 'partial' when $7::timestamptz is not null then 'sent' else 'open' end s`;
    // the SQL above is document_status() inlined over its inputs; check it has not drifted
    const src = (await one<{ s: string }>(db, `select prosrc s from pg_proc where proname = 'document_status'`)).s;
    for (const piece of ["'void'", "'draft'", "'posted'", "b.applied >= b.total then 'paid'", "b.due_date < public.today_mv() then 'overdue'", "'partial'", "'sent'", "'open'"]) {
      expect(src).toContain(piece);
    }
    await fc.assert(fc.asyncProperty(
      fc.record({
        voided: fc.boolean(), draft: fc.boolean(), type: fc.constantFrom("invoice", "bill", "customer_payment"),
        total: fc.integer({ min: 0, max: 5000 }), applied: fc.integer({ min: 0, max: 5000 }),
        due: fc.constantFrom(null, "2020-01-01", "2099-01-01", today), sent: fc.boolean(),
      }),
      async (r) => {
        const total = (r.total / 100).toFixed(2), applied = (r.applied / 100).toFixed(2);
        const want = (await one<{ s: string }>(db, sqlStatus,
          [r.voided ? "2026-01-01" : null, r.draft, r.type, total, applied, r.due, r.sent ? "2026-01-01" : null])).s;
        const got = docStatus({ type: r.type, total, applied, balance: ((r.total - r.applied) / 100).toFixed(2), due_date: r.due,
          is_draft: r.draft, sent_at: r.sent ? "x" : null, voided_at: r.voided ? "x" : null }, today);
        expect(got).toBe(want);
      }), { numRuns: 200, seed: 20260930 });
  });
});
