"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Card, CardHeader, Table, Th, Td, Empty } from "@/components/ui";
import { money, date, num } from "@/lib/format";
import { updateBill, deleteBill } from "@/app/actions/project-items";
import { BillsModal } from "./bills-modal";

export interface BillRow {
  id: string;
  bill_no: string;
  shop: string | null;
  vendor_id: string | null;
  description: string | null;
  category_id: string;
  category: string | null;
  issue_date: string | null;
  subtotal: number;
  tax_amount: number;
  total: number;
  gst_rate: number;
  supplier_tin: string | null;
  taxable_activity_no: string | null;
  expense_class: string;
  /** signed URL for the stored photo, if there is one */
  photo_url: string | null;
}

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const tiny = "mb-1 block text-[10px] uppercase tracking-wide text-[var(--muted)]";

export function BillsPanel({
  projectId,
  rows,
  categories,
  defaultActivityNo,
  autoReadOn,
  gstRegistered,
  locked = false,
}: {
  projectId: string;
  rows: BillRow[];
  categories: { id: string; name: string }[];
  /** carried over from the last bill entered, since it rarely changes */
  defaultActivityNo?: string | null;
  /** whether the server can read bills off their photos */
  autoReadOn: boolean;
  /** an activity number only means something once GST is registered */
  gstRegistered: boolean;
  /** completed and paid: shown, but no longer changeable */
  locked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [lightbox, setLightbox] = useState<BillRow | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const total = rows.reduce((s, r) => s + num(r.total), 0);

  return (
    <>
      <Card>
        <CardHeader
          title="Bills"
          subtitle={`${rows.length} bills · ${money(total)} — this is the project's EXP`}
          action={
            locked ? undefined : (
              <button type="button" onClick={() => setOpen(true)}
                className="text-xs font-medium text-[var(--brand)] hover:underline">
                + Add bill
              </button>
            )
          }
        />

        {rows.length === 0 ? (
          <Empty message="No bills yet. Add one and its total feeds straight into EXP." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Bill</Th><Th>Shop</Th><Th>Category</Th>
                <Th right>Net</Th><Th right>GST</Th><Th right>Total</Th>
                <Th className="w-20 pl-10">Photo</Th><Th right>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) =>
                editing === b.id ? (
                  <tr key={b.id} className="bg-[var(--hover)]">
                    <Td colSpan={8}>
                      <form action={updateBill} className="flex flex-wrap items-end gap-2 py-1">
                        <input type="hidden" name="id" value={b.id} />
                        <input type="hidden" name="project_id" value={projectId} />
                        <div className="min-w-[180px] flex-1">
                          <label className={tiny}>Category</label>
                          <select name="category_id" defaultValue={b.category_id} className={input}>
                            <option value="">Uncategorised</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="w-28">
                          <label className={tiny}>Net</label>
                          <input name="subtotal" type="number" step="0.01" defaultValue={b.subtotal} className={input} />
                        </div>
                        <div className="w-24">
                          <label className={tiny}>GST</label>
                          <input name="tax_amount" type="number" step="0.01" defaultValue={b.tax_amount} className={input} />
                        </div>
                        <div className="w-24">
                          <label className={tiny}>Rate</label>
                          <select name="gst_rate" defaultValue={String(b.gst_rate)} className={input}>
                            <option value="0">None</option>
                            <option value="6">6% (before 2023)</option>
                            <option value="8">8%</option>
                            <option value="12">12%</option>
                          </select>
                        </div>
                        <div className="w-36">
                          <label className={tiny}>Activity no.</label>
                          <input name="taxable_activity_no" defaultValue={b.taxable_activity_no ?? ""} className={input} />
                        </div>
                        <div className="w-28">
                          <label className={tiny}>Class</label>
                          <select name="expense_class" defaultValue={b.expense_class} className={input}>
                            <option value="revenue">Revenue</option>
                            <option value="capital">Capital</option>
                          </select>
                        </div>
                        <div className="w-28">
                          <label className={tiny}>Total</label>
                          <input name="total" type="number" step="0.01" defaultValue={b.total} className={input} />
                        </div>
                        <div className="w-36">
                          <label className={tiny}>Date</label>
                          <input name="issue_date" type="date" defaultValue={b.issue_date ?? ""} className={input} />
                        </div>
                        <button type="submit"
                          className="rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-medium text-white">
                          Save
                        </button>
                        <button type="button" onClick={() => setEditing(null)}
                          className="px-2 py-2 text-xs text-[var(--muted)] hover:underline">
                          Cancel
                        </button>
                      </form>
                    </Td>
                  </tr>
                ) : (
                  <tr key={b.id} className="hover:bg-[var(--hover)]">
                    <Td>
                      <span className="font-mono text-xs">{b.bill_no}</span>
                      <span className="block text-xs text-[var(--muted)]">{date(b.issue_date)}</span>
                    </Td>
                    <Td>
                      {b.vendor_id && b.shop ? (
                        <Link href={`/shops/${b.vendor_id}`}
                          className="hover:text-[var(--brand)] hover:underline">
                          {b.shop}
                        </Link>
                      ) : (
                        (b.shop ?? "—")
                      )}
                      {b.supplier_tin && (
                        <span className="block font-mono text-[10px] text-[var(--muted)]">
                          TIN {b.supplier_tin}
                        </span>
                      )}
                    </Td>
                    <Td className="max-w-xs truncate text-[var(--muted)]">
                      {b.category ?? "—"}
                    </Td>
                    <Td right>{money(b.subtotal)}</Td>
                    <Td right className="text-[var(--muted)]">{money(b.tax_amount)}</Td>
                    <Td right className="font-medium">{money(b.total)}</Td>
                    <Td className="w-20 pl-10">
                      {b.photo_url ? (
                        <button type="button" onClick={() => setLightbox(b)}
                          className="block h-10 w-10 overflow-hidden rounded border border-[var(--border)]">
                          <Image src={b.photo_url} alt={`Bill ${b.bill_no}`} width={40} height={40}
                            unoptimized className="h-full w-full object-cover" />
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--muted)]">—</span>
                      )}
                    </Td>
                    <Td right>
                      {!locked && (
                        <>
                          <button type="button" onClick={() => setEditing(b.id)}
                            className="text-xs text-[var(--muted)] hover:text-[var(--brand)] hover:underline">
                            Edit
                          </button>
                          <button type="button" onClick={() => deleteBill(b.id, projectId)}
                            className="ml-2 text-xs text-[var(--muted)] hover:text-red-700">
                            Remove
                          </button>
                        </>
                      )}
                    </Td>
                  </tr>
                ),
              )}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--hover)] font-semibold">
                <Td>EXP</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td><Td>{""}</Td>
                <Td right>{money(total)}</Td><Td>{""}</Td><Td>{""}</Td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      {lightbox?.photo_url && (
        <div role="dialog" aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setLightbox(null)}>
          <div className="max-h-full max-w-3xl overflow-auto rounded-xl bg-[var(--field)] p-3"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-sm font-medium">
                {lightbox.bill_no} · {lightbox.shop} · {money(lightbox.total)}
              </p>
              <button type="button" onClick={() => setLightbox(null)}
                className="text-sm text-[var(--muted)] hover:underline">Close</button>
            </div>
            <Image src={lightbox.photo_url} alt={`Bill ${lightbox.bill_no}`}
              width={1000} height={1400} unoptimized
              className="h-auto w-full rounded-lg object-contain" />
          </div>
        </div>
      )}

      <BillsModal
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        categories={categories}
        defaultActivityNo={defaultActivityNo ?? ""}
        autoReadOn={autoReadOn}
        gstRegistered={gstRegistered}
      />
    </>
  );
}
