"use client";

import { useActionState, useState, useTransition } from "react";
import { deleteAsset, saveAsset, type BooksResult } from "@/app/actions/books";
import { date, money } from "@/lib/format";

export interface AssetView {
  id: string;
  name: string;
  category: string | null;
  purchased_on: string;
  cost: number;
  life_years: number;
  bill_id: string | null;
  bill_label: string | null;
  disposed_on: string | null;
  disposal_amount: number | null;
  serial_no: string | null;
  location: string | null;
  note: string | null;
  depreciation: number;
  value: number;
  monthly: number;
}

const field = "mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1.5 text-sm text-[var(--text)]";
const CATEGORIES = ["Tools", "Machinery", "Vehicles", "Computers and phones", "Furniture", "Other"];

export function AssetForm({ a, bill, life, compact, onDone }: {
  a?: AssetView;
  bill?: { id: string; date: string; total: number; name: string };
  life: number;
  compact?: boolean;
  onDone?: () => void;
}) {
  const [state, action, pending] = useActionState<BooksResult | null, FormData>(async (p, fd) => {
    const r = await saveAsset(p, fd);
    if (r.ok) onDone?.();
    return r;
  }, null);
  const [disposed, setDisposed] = useState(Boolean(a?.disposed_on));
  const onBill = Boolean(bill || a?.bill_id);

  if (compact && bill) {
    return (
      <form action={action} className="mt-2 flex flex-wrap items-end gap-2 text-xs text-[var(--muted)] sm:pl-[108px]">
        <input type="hidden" name="bill_id" value={bill.id} />
        <input type="hidden" name="purchased_on" value={bill.date} />
        <input type="hidden" name="cost" value={bill.total} />
        <label className="min-w-0 flex-1">Name<input name="name" defaultValue={bill.name} placeholder="e.g. Table saw" className={field} /></label>
        <label className="w-36">Kind
          <select name="category" defaultValue="Tools" className={field}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label className="w-20">Life (yrs)<input name="life_years" inputMode="decimal" defaultValue={life} className={field} /></label>
        <button type="submit" disabled={pending} className="rounded-md bg-[var(--brand)] px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-60">{pending ? "Adding…" : "Add to register"}</button>
        {state?.error && <p className="w-full text-red-700">{state.error}</p>}
      </form>
    );
  }

  return (
    <form action={action} className="grid grid-cols-2 gap-3 px-5 py-4 text-xs text-[var(--muted)]">
      {a && <input type="hidden" name="id" value={a.id} />}
      {a?.bill_id && <input type="hidden" name="bill_id" value={a.bill_id} />}
      <label className="col-span-2">Name<input name="name" defaultValue={a?.name} placeholder="e.g. Toyota Hilux P1234" className={field} /></label>
      <label>Kind
        <select name="category" defaultValue={a?.category ?? "Tools"} className={field}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
      </label>
      <label>Useful life (years)<input name="life_years" inputMode="decimal" defaultValue={a?.life_years ?? life} className={field} /></label>
      {onBill ? (
        <>
          <input type="hidden" name="purchased_on" value={a?.purchased_on} />
          <input type="hidden" name="cost" value={a?.cost} />
          <p className="col-span-2">Bought on {date(a?.purchased_on)} for {money(a?.cost)} — from the bill {a?.bill_label}.</p>
        </>
      ) : (
        <>
          <label>Bought on<input name="purchased_on" type="date" defaultValue={a?.purchased_on} className={field} /></label>
          <label>Cost (MVR)<input name="cost" inputMode="decimal" defaultValue={a?.cost} className={field} /></label>
        </>
      )}
      <label>Serial or plate no.<input name="serial_no" defaultValue={a?.serial_no ?? ""} className={field} /></label>
      <label>Kept at<input name="location" defaultValue={a?.location ?? ""} placeholder="Workshop, site…" className={field} /></label>
      <label className="col-span-2">Notes<input name="note" defaultValue={a?.note ?? ""} className={field} /></label>
      {a && (
        <label className="col-span-2 flex items-center gap-2 text-[var(--text)]">
          <input type="checkbox" checked={disposed} onChange={(e) => setDisposed(e.target.checked)} /> Sold or scrapped
        </label>
      )}
      {disposed && (
        <>
          <label>On<input name="disposed_on" type="date" defaultValue={a?.disposed_on ?? ""} className={field} /></label>
          <label>Sold for (0 if scrapped)<input name="disposal_amount" inputMode="decimal" defaultValue={a?.disposal_amount ?? 0} className={field} /></label>
        </>
      )}
      {state?.error && <p className="col-span-2 text-red-700">{state.error}</p>}
      {state?.ok && !a && <p className="col-span-2 text-emerald-700">Added.</p>}
      <button type="submit" disabled={pending} className="col-span-2 justify-self-start rounded-lg bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white hover:bg-[var(--brand-hover)] disabled:opacity-60">
        {pending ? "Saving…" : a ? "Save" : "Add to register"}
      </button>
    </form>
  );
}

export function AssetRow({ a }: { a: AssetView }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="text-sm">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-left hover:bg-[var(--hover)]">
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-medium ${a.disposed_on ? "text-[var(--muted)] line-through" : ""}`}>{a.name}</span>
          <span className="block text-xs text-[var(--muted)]">
            {a.category ?? "Equipment"} · bought {date(a.purchased_on)} · {a.life_years} yrs{a.serial_no ? ` · ${a.serial_no}` : ""}
            {a.disposed_on ? ` · ${a.disposal_amount ? `sold for ${money(a.disposal_amount)}` : "scrapped"} ${date(a.disposed_on)}` : ""}
          </span>
        </span>
        <span className="w-28 text-right text-xs text-[var(--muted)] tabular-nums">cost {money(a.cost)}</span>
        <span className="w-28 text-right font-medium tabular-nums">{a.disposed_on ? "—" : money(a.value)}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--border)] bg-[var(--hover)]/40">
          <p className="px-5 pt-3 text-xs text-[var(--muted)]">Written off {money(a.monthly)} a month; {money(a.depreciation)} so far.</p>
          <AssetForm a={a} life={a.life_years} onDone={() => setOpen(false)} />
          <div className="px-5 pb-3 text-xs">
            {error && <span className="mr-2 text-red-700">{error}</span>}
            <button type="button" disabled={pending} className="text-[var(--muted)] hover:text-red-700"
              onClick={() => { if (confirm(`Delete ${a.name} from the register? To record that it was sold or scrapped, tick that instead.`)) start(async () => { const r = await deleteAsset(a.id); setError(r.error ?? null); }); }}>
              Delete from register
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
