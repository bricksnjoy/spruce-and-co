"use client";

import { useActionState, useState, type ReactNode } from "react";
import { DocumentSheet } from "@/components/document-sheet";
import { saveTemplate, type DocResult } from "@/app/actions/documents";
import {
  docNumber,
  signerFor,
  type SigningKit,
  type Template,
  type TemplateBody,
  type TemplateHeader,
  type TemplateTail,
} from "@/lib/documents";
import { SignerPicker } from "../../quotation-form";
import { DeleteTemplate } from "../template-buttons";
import { today } from "@/lib/format";

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-sm font-medium";
const hint = "mt-1 text-xs text-[var(--muted)]";

type Part = "header" | "body" | "tail";

// what the preview is filled with, so the layout can be judged before real use
const SAMPLE_LINES = [
  { title: "Custom build kitchen Cabinet", description: "Carcass Structure Interior, 18mm Blockboard, Quartstone Countertop, Tiles Backsplash", unit: "Nos", qty: 1, rate: 55500 },
  { title: "Dustbin 2 tray", description: "", unit: "Nos", qty: 1, rate: 2500 },
  { title: "2 Bowl Sink & Faucet", description: "", unit: "Nos", qty: 1, rate: 5800 },
];

/**
 * Edit a template the way Zoho lays it out: the header (who we are, what the
 * document is, how it is numbered), the body (the table and totals) and the
 * tail (terms, closing note, stamp and signature) — with the page beside it
 * updating as you type.
 */
export function TemplateEditor({
  template,
  kit,
}: {
  template: Template;
  kit: SigningKit;
}) {
  const [state, action, pending] = useActionState(saveTemplate, null as DocResult | null);
  const [part, setPart] = useState<Part>("header");
  const [name, setName] = useState(template.name);
  const [header, setHeader] = useState<TemplateHeader>(template.header);
  const [body, setBody] = useState<TemplateBody>(template.body);
  const [tail, setTail] = useState<TemplateTail>(template.tail);
  // "Saved" shows only while the page still matches what was last saved
  const [submitted, setSubmitted] = useState<string | null>(null);

  const h = <K extends keyof TemplateHeader>(k: K, v: TemplateHeader[K]) => setHeader((x) => ({ ...x, [k]: v }));
  const b = <K extends keyof TemplateBody>(k: K, v: TemplateBody[K]) => setBody((x) => ({ ...x, [k]: v }));
  const t = <K extends keyof TemplateTail>(k: K, v: TemplateTail[K]) => setTail((x) => ({ ...x, [k]: v }));

  const isQuote = template.kind === "quotation";
  const todayIso = today();
  const sampleNumber = docNumber(header.number_prefix, 6, todayIso, header.number_pad);
  const payload = JSON.stringify({ id: template.id, name, header, body, tail });
  const saved = Boolean(state?.ok) && !pending && submitted === payload;

  return (
    <div className="grid gap-6 2xl:grid-cols-[minmax(0,460px)_1fr] xl:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-4">
      <form action={action} onSubmit={() => setSubmitted(payload)} className="space-y-4">
        <input type="hidden" name="payload" value={payload} />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="t-name" className={label}>Template name</label>
            <input id="t-name" value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </div>
          <span className="rounded-full bg-[var(--hover)] px-2.5 py-1 text-xs font-medium capitalize text-[var(--muted)]">
            {template.kind}{template.is_default ? " · default" : ""}
          </span>
        </div>

        <div role="tablist" className="flex rounded-lg border border-[var(--border)] bg-[var(--field)] p-0.5 text-sm font-medium">
          {(["header", "body", "tail"] as Part[]).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={part === p} onClick={() => setPart(p)}
              className={`flex-1 rounded-md px-3 py-2 capitalize transition-colors ${
                part === p ? "bg-[var(--brand)] text-white" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}>
              {p === "tail" ? "Tail (footer)" : p}
            </button>
          ))}
        </div>

        <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          {part === "header" && (
            <>
              <Check checked={header.show_logo} onChange={(v) => h("show_logo", v)}>Show the Spruce &amp; Co logo</Check>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="h-name" text="Company name">
                  <input id="h-name" value={header.company_name} onChange={(e) => h("company_name", e.target.value)} className={input} />
                </Field>
                <Field id="h-sub" text="Line under the name">
                  <input id="h-sub" value={header.company_sub} onChange={(e) => h("company_sub", e.target.value)} className={input} />
                </Field>
              </div>
              <Field id="h-addr" text="Address block" note="One line per line — include the email if it should show.">
                <textarea id="h-addr" rows={5} value={header.address} onChange={(e) => h("address", e.target.value)} className={input} />
              </Field>
              <Field id="h-tin" text="TIN" note="Leave empty to leave it off the page.">
                <input id="h-tin" value={header.tin} onChange={(e) => h("tin", e.target.value)} className={input} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="h-title" text="Document title">
                  <input id="h-title" value={header.title} onChange={(e) => h("title", e.target.value)} className={input} />
                </Field>
                <Field id="h-nl" text="Number label">
                  <input id="h-nl" value={header.number_label} onChange={(e) => h("number_label", e.target.value)} className={input} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_110px]">
                <Field id="h-np" text="Numbers start with" note={`{YY} is the year (26), {YYYY} the full year. Next one looks like ${sampleNumber}.`}>
                  <input id="h-np" value={header.number_prefix} onChange={(e) => h("number_prefix", e.target.value)} className={input} />
                </Field>
                <Field id="h-pad" text="Digits">
                  <input id="h-pad" type="number" min={0} max={6} value={header.number_pad}
                    onChange={(e) => h("number_pad", Number(e.target.value))} className={input} />
                </Field>
              </div>
              <Field id="h-acc" text="Colour" note="Used for the title, table header and total.">
                <div className="flex items-center gap-3">
                  <input id="h-acc" type="color" value={header.accent} onChange={(e) => h("accent", e.target.value)}
                    className="h-10 w-14 cursor-pointer rounded border border-[var(--border)]" />
                  <input value={header.accent} onChange={(e) => h("accent", e.target.value)} className={input} />
                </div>
              </Field>
            </>
          )}

          {part === "body" && (
            <>
              <Field id="b-to" text="Recipient label">
                <input id="b-to" value={body.to_label} onChange={(e) => b("to_label", e.target.value)} className={input} />
              </Field>
              <Field id="b-intro" text="Opening text" note="Optional — a line before the table.">
                <textarea id="b-intro" rows={2} value={body.intro} onChange={(e) => b("intro", e.target.value)} className={input} />
              </Field>
              <p className="text-sm font-medium">Table columns</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <input aria-label="Description column" value={body.col_description} onChange={(e) => b("col_description", e.target.value)} className={input} />
                <input aria-label="Quantity column" value={body.col_qty} onChange={(e) => b("col_qty", e.target.value)} className={input} />
                <input aria-label="Rate column" value={body.col_rate} onChange={(e) => b("col_rate", e.target.value)} className={input} />
                <input aria-label="Amount column" value={body.col_total} onChange={(e) => b("col_total", e.target.value)} className={input} />
              </div>
              <Check checked={body.show_unit} onChange={(v) => b("show_unit", v)}>Show a unit column</Check>
              {body.show_unit && (
                <input aria-label="Unit column" value={body.col_unit} onChange={(e) => b("col_unit", e.target.value)} className={input} />
              )}
              <Check checked={body.show_duration} onChange={(v) => b("show_duration", v)}>Show the job&apos;s duration beside the date</Check>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="b-tl" text="Tax name">
                  <input id="b-tl" value={body.tax_label} onChange={(e) => b("tax_label", e.target.value)} className={input} />
                </Field>
                <Field id="b-tr" text="Tax rate %" note="0 leaves tax off — right until GST registration.">
                  <input id="b-tr" type="number" step="0.01" min={0} value={body.tax_rate}
                    onChange={(e) => b("tax_rate", Number(e.target.value))} className={input} />
                </Field>
              </div>
              {isQuote ? (
                <Field id="b-vd" text="Valid for (days)" note="Sets each new quotation's valid-until date.">
                  <input id="b-vd" type="number" min={0} value={body.valid_days ?? 0}
                    onChange={(e) => b("valid_days", Number(e.target.value))} className={input} />
                </Field>
              ) : (
                <Field id="b-dd" text="Payment due in (days)">
                  <input id="b-dd" type="number" min={0} value={body.due_days ?? 0}
                    onChange={(e) => b("due_days", Number(e.target.value))} className={input} />
                </Field>
              )}
            </>
          )}

          {part === "tail" && (
            <>
              <Field id="t-terms" text="Terms & conditions" note="One per line. Each new document starts with these, and can be changed on it.">
                <textarea id="t-terms" rows={8} value={tail.terms} onChange={(e) => t("terms", e.target.value)} className={input} />
              </Field>
              <Field id="t-close" text="Closing note" note="Who to call, how long the quote stands.">
                <textarea id="t-close" rows={2} value={tail.closing_note} onChange={(e) => t("closing_note", e.target.value)} className={input} />
              </Field>
              <Field id="t-bank" text="Bank details" note="Optional — printed under the terms.">
                <textarea id="t-bank" rows={2} value={tail.bank_details} onChange={(e) => t("bank_details", e.target.value)} className={input} />
              </Field>
              <div>
                <p className={label}>Signed by, unless the document says otherwise</p>
                <SignerPicker kit={kit} signatoryId={tail.signatory_id || null} showStamp={tail.show_stamp}
                  onSigner={(id) => t("signatory_id", id ?? "")} onStamp={(v) => t("show_stamp", v)}
                  names={{ signer: "tpl-signer", stamp: "tpl-stamp" }} />
              </div>
              <Check checked={tail.show_client_signature} onChange={(v) => t("show_client_signature", v)}>
                Space for the client to sign
              </Check>
              <Field id="t-foot" text="Footer band" note="Optional — a coloured strip at the bottom of the page.">
                <input id="t-foot" value={tail.footer_text} onChange={(e) => t("footer_text", e.target.value)} className={input} />
              </Field>
            </>
          )}
        </div>

        {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="submit" disabled={pending}
              className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60">
              {pending ? "Saving…" : "Save template"}
            </button>
            {saved && <span className="text-sm text-emerald-700">Saved</span>}
          </div>
          {!template.is_default && <DeleteTemplate id={template.id} />}
        </div>
      </form>

      </div>

      <div className="min-w-0">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Preview</p>
        <div className="sticky top-4 overflow-auto rounded-xl border border-[var(--border)] bg-[#e9ecf0] p-4">
          <div style={{ zoom: 0.72 }}>
            <DocumentSheet header={header} body={body} tail={tail} signer={signerFor(kit, tail, null, null)}
              data={{
                kind: template.kind,
                number: sampleNumber,
                quotationNumber: isQuote ? null : "SC-Q/26/06",
                date: todayIso,
                untilDate: null,
                duration: "13 days",
                toName: "Huzam (7458876)",
                title: null,
                lines: SAMPLE_LINES.map((l) => ({ ...l, amount: l.qty * l.rate })),
                taxRate: body.tax_rate,
                terms: tail.terms,
              }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ id, text, note, children }: { id: string; text: string; note?: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      {children}
      {note && <p className={hint}>{note}</p>}
    </div>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[var(--brand)]" />
      {children}
    </label>
  );
}
