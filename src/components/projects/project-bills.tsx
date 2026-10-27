"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExpenseForm } from "@/components/expenses/expense-form";
import { primary, small } from "@/components/form-styles";
import { previewBillSheet, recheckBillSheet, saveBillSheet, type Preview, type SaveResult } from "@/app/actions/project-bills";
import { norm, type ShopChoices } from "@/lib/bill-import";
import type { ExpenseFormData } from "@/server/expense-data";
import type { ExpenseValues } from "@/lib/expense-doc";
import { money } from "@/lib/format";
import { Modal } from "@/components/modal";

/** The Bills tab's actions: a new bill in a pop-up, the bills sheet to download, and uploading it back. */
export function ProjectBills({ projectId, data, blank, openNew }: { projectId: string; data: ExpenseFormData; blank: ExpenseValues; openNew: boolean }) {
  const router = useRouter();
  const [newOpen, setNewOpen] = useState(openNew);
  const [formKey, setFormKey] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<SaveResult | null>(null);
  const [choices, setChoices] = useState<ShopChoices>({});
  // receipts are entered once paid, so by default they are saved as paid from this account
  const [paidFrom, setPaidFrom] = useState(data.payFrom[0]?.id ?? "");
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    setResult(null);
    setChoices({});
    start(async () => setPreview(await previewBillSheet(projectId, fd)));
  };
  // a shop picked for a name not on file (a spelling slip), or "new" to add it: the rows are checked again
  const choose = (name: string, choice: string) => {
    const next = { ...choices, [norm(name)]: choice };
    if (!choice) delete next[norm(name)];
    setChoices(next);
    start(async () => setPreview(await recheckBillSheet(projectId, preview!.raw!, next)));
  };
  const save = () => start(async () => {
    const r = await saveBillSheet(projectId, preview!.raw!, choices, paidFrom || null);
    setResult(r);
    if (!r.error && !(r.failed ?? []).length) { setPreview(null); router.refresh(); }
    else router.refresh();
  });
  const rows = preview?.rows ?? [];
  const counts = { new: rows.filter((r) => r.status === "new").length, saved: rows.filter((r) => r.status === "saved").length, error: rows.filter((r) => r.status === "error").length };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primary} onClick={() => { setFormKey((k) => k + 1); setNewOpen(true); setMsg(null); }}>New bill</button>
        <a className={small} href={`/projects/${projectId}/bills/sheet`}>Download bills (Excel)</a>
        <button type="button" className={small} disabled={pending} onClick={() => fileRef.current?.click()}>{pending && !preview ? "Reading…" : "Upload filled sheet"}</button>
        <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" aria-label="Filled bills sheet"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        {msg && <span className="text-sm text-emerald-700">{msg}</span>}
      </div>
      {result && !preview && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          Saved {result.saved} bill{result.saved === 1 ? "" : "s"}{result.skipped ? `; ${result.skipped} row${result.skipped === 1 ? " was" : "s were"} already saved and skipped` : ""}.
          {(result.notes ?? []).map((n) => <span key={n} className="block text-xs">{n}</span>)}
        </p>
      )}

      {newOpen && (
        <Modal title="New bill" onClose={() => setNewOpen(false)}>
          <ExpenseForm key={formKey} data={data} values={blank}
            onSaved={(_id, note) => { setNewOpen(false); setMsg(note ? `Bill saved. ${note}` : "Bill saved."); router.refresh(); }} />
        </Modal>
      )}

      {preview && (
        <Modal title="Check the bills before saving" onClose={() => { setPreview(null); setResult(null); setChoices({}); }}>
          {preview.error ? <p className="text-sm text-red-700">{preview.error}</p> : (
            <div className="space-y-4">
              <p className="text-sm">
                <strong>{preview.bills}</strong> new bill{preview.bills === 1 ? "" : "s"} ({counts.new} row{counts.new === 1 ? "" : "s"}), total <strong className="tabular-nums">{money(Number(preview.total))}</strong> with GST
                {counts.saved > 0 && <> · {counts.saved} already saved (skipped)</>}
                {counts.error > 0 && <> · <span className="font-medium text-red-700">{counts.error} with problems</span></>}
              </p>
              {(preview.unknownShops ?? []).length > 0 && (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                  <p className="font-medium">Shops not on file: pick the right one (a spelling slip), or add it as a new shop</p>
                  {preview.unknownShops!.map((u) => (
                    <div key={u.name} className="flex flex-wrap items-center gap-2">
                      <span className="min-w-40">&ldquo;{u.name}&rdquo; <span className="text-xs text-amber-800">row{u.rows.length === 1 ? "" : "s"} {u.rows.join(", ")}</span></span>
                      <select aria-label={`Shop for ${u.name}`} value={choices[norm(u.name)] ?? ""} disabled={pending}
                        onChange={(e) => choose(u.name, e.target.value)}
                        className="rounded-md border border-amber-300 bg-white px-2 py-1 text-sm">
                        <option value="">Choose…</option>
                        {u.suggestions.length > 0 && (
                          <optgroup label="Did you mean">
                            {u.suggestions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="Add">
                          <option value="new">Add &ldquo;{u.name}&rdquo; as a new shop</option>
                        </optgroup>
                        <optgroup label="All shops">
                          {(preview.shops ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </optgroup>
                      </select>
                    </div>
                  ))}
                  <p className="text-xs text-amber-800">A new shop is added to Vendors marked for review; add its TIN there so its GST can be claimed.</p>
                </div>
              )}
              <div className="max-h-[55vh] overflow-auto rounded-lg border border-[var(--border)]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[var(--surface)] text-left text-[var(--muted)]">
                    <tr>{["Row", "Status", "Date", "Shop", "Invoice no.", "Category", "Amount", "Discount", "GST", "Total", "GST claimed"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {rows.map((r) => (
                      <tr key={r.row} className={r.status === "error" ? "bg-red-50" : r.status === "saved" ? "text-[var(--muted)]" : ""}>
                        <td className="px-2 py-1.5 tabular-nums">{r.row}</td>
                        <td className="px-2 py-1.5">
                          {r.status === "new" ? <span className="text-emerald-700">New{r.note && <span className="block text-[10px] text-[var(--muted)]">{r.note}</span>}</span>
                            : r.status === "saved" ? <span>{r.note}</span>
                            : <span className="text-red-700">{r.errors.join("; ")}</span>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">{r.date}</td>
                        <td className="px-2 py-1.5">
                          {r.shop}{r.new_vendor && r.status === "new" && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-800">new shop</span>}
                          {r.typed_shop && norm(r.typed_shop) !== norm(r.shop) && <span className="block text-[10px] text-[var(--muted)]">typed &ldquo;{r.typed_shop}&rdquo;</span>}
                        </td>
                        <td className="px-2 py-1.5">{r.invoice_no ?? ""}</td>
                        <td className="px-2 py-1.5">{r.category}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.amount}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.discount !== "0.00" ? r.discount : ""}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.gst}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{r.total}</td>
                        <td className="px-2 py-1.5">{r.claimable ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result?.error && <p className="text-sm text-red-700">{result.error}</p>}
              {(result?.failed ?? []).map((f) => <p key={f.rows.join()} className="text-sm text-red-700">Rows {f.rows.join(", ")}: {f.error}</p>)}
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm">Paid from
                  <select aria-label="Paid from" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-sm">
                    {data.payFrom.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    <option value="">Not paid yet</option>
                  </select>
                </label>
                <button type="button" className={primary} disabled={pending || counts.error > 0 || !preview.bills} onClick={save}>
                  {pending ? "Saving…" : `Save ${preview.bills} bill${preview.bills === 1 ? "" : "s"}`}
                </button>
                {counts.error > 0 && <span className="text-sm text-[var(--muted)]">Pick the shops above; fix any other rows in red in the sheet and upload it again.</span>}
                {counts.error === 0 && !preview.bills && <span className="text-sm text-[var(--muted)]">Nothing new to save.</span>}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
