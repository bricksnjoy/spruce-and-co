"use client";

import { useActionState, useMemo, useState, type ReactNode } from "react";
import { DocumentSheet } from "@/components/document-sheet";
import { DueIn } from "@/components/due-in";
import { saveQuotation, type DocResult, type LineInput, type QuotationInput } from "@/app/actions/documents";
import { addDays, docNumber, round2, signerFor, type SigningKit, type Template } from "@/lib/documents";
import { money } from "@/lib/format";

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const cell =
  "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none hover:border-[var(--border)] focus:border-[var(--brand)] focus:bg-[var(--field)]";
const label = "mb-1.5 block text-sm font-medium";

export interface ProjectOption {
  id: string;
  code: string;
  name: string;
  client_id: string | null;
}

export interface ClientOption {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

const blankLine = (): LineInput => ({ title: "", description: "", unit: "Nos", qty: 1, rate: 0 });

function contactOf(c: ClientOption | undefined) {
  return c ? [c.phone, c.address].filter(Boolean).join("\n") : "";
}

/**
 * Write or change a quotation. It starts from the chosen template — terms,
 * tax and validity — and the page beside the form shows exactly what the
 * client will get.
 */
export function QuotationForm({
  templates,
  projects,
  clients,
  kit,
  initial,
  number,
}: {
  templates: Template[];
  projects: ProjectOption[];
  clients: ClientOption[];
  /** the company stamp and who can sign */
  kit: SigningKit;
  initial: QuotationInput;
  /** the number it has, or will get */
  number: string | null;
}) {
  const [state, action, pending] = useActionState(saveQuotation, null as DocResult | null);
  const [q, setQ] = useState<QuotationInput>(initial);
  const [preview, setPreview] = useState(true);

  const template = templates.find((t) => t.id === q.template_id) ?? templates[0];
  const set = <K extends keyof QuotationInput>(k: K, v: QuotationInput[K]) => setQ((x) => ({ ...x, [k]: v }));
  const setLine = (i: number, patch: Partial<LineInput>) =>
    setQ((x) => ({ ...x, items: x.items.map((l, k) => (k === i ? { ...l, ...patch } : l)) }));
  const move = (i: number, by: number) =>
    setQ((x) => {
      const items = [...x.items];
      const j = i + by;
      if (j < 0 || j >= items.length) return x;
      [items[i], items[j]] = [items[j], items[i]];
      return { ...x, items };
    });

  const subtotal = round2(q.items.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.rate) || 0), 0));
  const tax = round2((subtotal * (Number(q.tax_rate) || 0)) / 100);

  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setQ((x) => ({
      ...x,
      template_id: id,
      signatory_id: t.tail.signatory_id || x.signatory_id,
      show_stamp: t.tail.show_stamp,
      terms: t.tail.terms,
      tax_rate: t.body.tax_rate,
      valid_until: t.body.valid_days ? addDays(x.issue_date, t.body.valid_days) : x.valid_until,
    }));
  }

  function pickProject(id: string) {
    const p = projects.find((x) => x.id === id);
    setQ((x) => {
      const next = { ...x, project_id: id || null };
      if (!p) return next;
      const c = clients.find((cc) => cc.id === p.client_id);
      return {
        ...next,
        client_id: p.client_id ?? x.client_id,
        to_name: x.to_name || c?.name || "",
        to_details: x.to_details || contactOf(c),
        title: x.title || p.name,
      };
    });
  }

  function pickClient(id: string) {
    const c = clients.find((x) => x.id === id);
    setQ((x) => ({
      ...x,
      client_id: id || null,
      to_name: c ? c.name : x.to_name,
      to_details: c ? contactOf(c) : x.to_details,
    }));
  }

  const shownNumber = useMemo(
    () => number ?? docNumber(template?.header.number_prefix ?? "SC-Q/{YY}/", 0, q.issue_date, 0).replace(/0$/, "…"),
    [number, template, q.issue_date],
  );

  return (
    <div className={`grid gap-6 ${preview ? "2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : ""}`}>
      <form action={action} className="min-w-0 space-y-5">
        <input type="hidden" name="payload" value={JSON.stringify(q)} />

        <Section title="Details">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="q-template" className={label}>Template</label>
              <select id="q-template" value={q.template_id ?? ""} onChange={(e) => pickTemplate(e.target.value)} className={input}>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}{t.is_default ? " (default)" : ""}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="q-project" className={label}>For project</label>
              <select id="q-project" value={q.project_id ?? ""} onChange={(e) => pickProject(e.target.value)} className={input}>
                <option value="">Not linked to a project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} · {p.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="q-client" className={label}>Client</label>
              <select id="q-client" value={q.client_id ?? ""} onChange={(e) => pickClient(e.target.value)} className={input}>
                <option value="">Someone not in Clients</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="q-to" className={label}>{template?.body.to_label.replace(/:$/, "") || "Quote to"}</label>
              <input id="q-to" required value={q.to_name} onChange={(e) => set("to_name", e.target.value)}
                className={input} placeholder="Huzam (7458876)" />
            </div>
          </div>

          <div>
            <label htmlFor="q-details" className={label}>Their details</label>
            <textarea id="q-details" rows={2} value={q.to_details} onChange={(e) => set("to_details", e.target.value)}
              className={input} placeholder="Phone, address — optional" />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="q-date" className={label}>Quote date</label>
              <input id="q-date" type="date" value={q.issue_date} className={input}
                onChange={(e) => {
                  const d = e.target.value;
                  setQ((x) => ({
                    ...x,
                    issue_date: d,
                    valid_until: template?.body.valid_days && d ? addDays(d, template.body.valid_days) : x.valid_until,
                  }));
                }} />
            </div>
            <DueIn id="q-valid" label="Valid until" from={q.issue_date} value={q.valid_until ?? ""} onChange={(d) => set("valid_until", d || null)} />
            <div>
              <label htmlFor="q-duration" className={label}>Duration</label>
              <input id="q-duration" value={q.duration} onChange={(e) => set("duration", e.target.value)}
                className={input} placeholder="13 days" />
            </div>
          </div>

          <div>
            <label htmlFor="q-title" className={label}>Heading over the lines</label>
            <input id="q-title" value={q.title} onChange={(e) => set("title", e.target.value)} className={input}
              placeholder="Optional — e.g. Custom Built Kitchen Cabinet, Apollo Tower" />
          </div>
        </Section>

        <Section title="Lines of work" action={
          <button type="button" onClick={() => set("items", [...q.items, blankLine()])}
            className="text-xs font-medium text-[var(--brand)] hover:underline">
            + Add line
          </button>
        }>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--muted)]">
                  <th className="w-6 px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Item &amp; description</th>
                  {template?.body.show_unit && <th className="w-20 px-2 py-1.5">Unit</th>}
                  <th className="w-20 px-2 py-1.5 text-right">Qty</th>
                  <th className="w-28 px-2 py-1.5 text-right">Rate</th>
                  <th className="w-28 px-2 py-1.5 text-right">Amount</th>
                  <th className="w-16" />
                </tr>
              </thead>
              <tbody>
                {q.items.map((l, i) => (
                  <tr key={i} className="border-t border-[var(--border)] align-top">
                    <td className="px-2 py-2.5 text-[var(--muted)]">{i + 1}</td>
                    <td className="px-0 py-1">
                      <input aria-label={`Line ${i + 1} item`} value={l.title} placeholder="Item"
                        onChange={(e) => setLine(i, { title: e.target.value })} className={`${cell} font-medium`} />
                      <textarea aria-label={`Line ${i + 1} description`} value={l.description} placeholder="Description (optional)"
                        rows={l.description ? 2 : 1}
                        onChange={(e) => setLine(i, { description: e.target.value })} className={`${cell} text-xs`} />
                    </td>
                    {template?.body.show_unit && (
                      <td className="px-0 py-1">
                        <input aria-label={`Line ${i + 1} unit`} value={l.unit}
                          onChange={(e) => setLine(i, { unit: e.target.value })} className={cell} />
                      </td>
                    )}
                    <td className="px-0 py-1">
                      <input aria-label={`Line ${i + 1} quantity`} type="number" step="0.01" min="0" value={l.qty}
                        onChange={(e) => setLine(i, { qty: Number(e.target.value) })} className={`${cell} text-right`} />
                    </td>
                    <td className="px-0 py-1">
                      <input aria-label={`Line ${i + 1} rate`} type="number" step="0.01" min="0" value={l.rate}
                        onChange={(e) => setLine(i, { rate: Number(e.target.value) })} className={`${cell} text-right`} />
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {money((Number(l.qty) || 0) * (Number(l.rate) || 0))}
                    </td>
                    <td className="px-1 py-2 text-right">
                      <span className="inline-flex gap-1 text-[var(--muted)]">
                        <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="px-1 hover:text-[var(--text)]">↑</button>
                        <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="px-1 hover:text-[var(--text)]">↓</button>
                        <button type="button" aria-label="Remove line"
                          onClick={() => set("items", q.items.filter((_, k) => k !== i))}
                          className="px-1 hover:text-red-700">×</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-[var(--muted)]">Sub total</span><span>{money(subtotal)}</span></div>
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="q-tax" className="text-[var(--muted)]">{template?.body.tax_label || "Tax"} %</label>
              <input id="q-tax" type="number" step="0.01" min="0" value={q.tax_rate}
                onChange={(e) => set("tax_rate", Number(e.target.value))}
                className="w-20 rounded-md border border-[var(--border)] bg-[var(--field)] px-2 py-1 text-right text-sm" />
              <span className="w-28 text-right">{money(tax)}</span>
            </div>
            <div className="flex justify-between border-t border-[var(--border)] pt-1.5 font-semibold">
              <span>Total</span><span>{money(subtotal + tax)}</span>
            </div>
          </div>
        </Section>

        <Section title="Signed by">
          <SignerPicker kit={kit} signatoryId={q.signatory_id} showStamp={q.show_stamp}
            onSigner={(id) => set("signatory_id", id)} onStamp={(v) => set("show_stamp", v)} />
        </Section>

        <Section title="Terms & notes">
          <div>
            <label htmlFor="q-terms" className={label}>Terms &amp; conditions</label>
            <textarea id="q-terms" rows={7} value={q.terms} onChange={(e) => set("terms", e.target.value)} className={input} />
            <p className="mt-1 text-xs text-[var(--muted)]">One per line. Changing them here changes this quotation only.</p>
          </div>
          <div>
            <label htmlFor="q-notes" className={label}>Internal notes</label>
            <textarea id="q-notes" rows={2} value={q.notes} onChange={(e) => set("notes", e.target.value)} className={input}
              placeholder="Not printed — for the team only" />
          </div>
        </Section>

        {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending}
            className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60">
            {pending ? "Saving…" : q.id ? "Save changes" : "Save quotation"}
          </button>
          <button type="button" onClick={() => setPreview((v) => !v)}
            className="text-sm text-[var(--muted)] hover:underline">
            {preview ? "Hide preview" : "Show preview"}
          </button>
        </div>
      </form>

      {preview && template && (
        <div className="min-w-0">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Preview</p>
          <div className="sticky top-4 overflow-auto rounded-xl border border-[var(--border)] bg-[#e9ecf0] p-4">
            <div style={{ zoom: 0.7 }}>
              <DocumentSheet header={template.header} body={template.body} tail={template.tail}
                signer={signerFor(kit, template.tail, q.signatory_id, q.show_stamp)}
                data={{
                  kind: "quotation",
                  number: shownNumber,
                  date: q.issue_date,
                  untilDate: q.valid_until,
                  duration: q.duration,
                  toName: q.to_name || "—",
                  toDetails: q.to_details,
                  title: q.title,
                  lines: q.items.map((l) => ({
                    title: l.title || null,
                    description: l.description || null,
                    unit: l.unit || null,
                    qty: Number(l.qty) || 0,
                    rate: Number(l.rate) || 0,
                    amount: round2((Number(l.qty) || 0) * (Number(l.rate) || 0)),
                  })),
                  taxRate: Number(q.tax_rate) || 0,
                  terms: q.terms,
                }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Choose who signs and whether the stamp goes on; shared by quotations and invoices. */
export function SignerPicker({
  kit,
  signatoryId,
  showStamp,
  onSigner,
  onStamp,
  names,
}: {
  kit: SigningKit;
  signatoryId: string | null;
  showStamp: boolean;
  onSigner: (id: string | null) => void;
  onStamp: (v: boolean) => void;
  /** form field names, when the picker sits in a plain form */
  names?: { signer: string; stamp: string };
}) {
  const chosen = kit.signatories.find((s) => s.id === signatoryId);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {kit.signatories.map((s) => (
          <label key={s.id}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
              s.id === signatoryId ? "border-[var(--brand)] bg-[var(--brand-soft)]" : "border-[var(--border)] hover:bg-[var(--hover)]"
            }`}>
            <input type="radio" name={names?.signer ?? "signer-choice"} value={s.id}
              checked={s.id === signatoryId} onChange={() => onSigner(s.id)} className="accent-[var(--brand)]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{s.name}</span>
              <span className="block truncate text-xs text-[var(--muted)]">{s.title ?? ""}</span>
            </span>
            {s.signatureUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.signatureUrl} alt="" className="h-8 w-16 object-contain" />
            ) : (
              <span className="text-[10px] text-amber-700">no signature yet</span>
            )}
          </label>
        ))}
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-sm">
        <input type="checkbox" name={names?.stamp} checked={showStamp} onChange={(e) => onStamp(e.target.checked)}
          className="h-4 w-4 accent-[var(--brand)]" />
        Put the company stamp beside {chosen ? `${chosen.name}'s` : "the"} signature
        {!kit.stampUrl && <span className="text-xs text-amber-700">(no stamp uploaded yet)</span>}
      </label>
      <p className="text-xs text-[var(--muted)]">
        Signatures and the stamp are uploaded under{" "}
        <a href="/quotations/signatures" target="_blank" className="underline">Signatures &amp; stamp</a>.
      </p>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="space-y-4 px-5 py-5">{children}</div>
    </section>
  );
}
