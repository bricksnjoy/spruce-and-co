"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createProject, updateProject } from "@/app/actions/projects";
import type { Result } from "@/app/actions/projects";
import { ClientModal } from "@/components/client-modal";

export interface ProjectFormValues {
  id?: string;
  code?: string;
  name?: string;
  customer_id?: string | null;
  status?: string;
  description?: string | null;
  site_address?: string | null;
  contract_value?: number;
  gst_amount?: number;
  start_date?: string | null;
  duration_days?: number | null;
  progress_pct?: number;
  recognition_method?: string | null;
}

const input =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]";
const label = "mb-1.5 block text-sm font-medium";

const STATUSES = [
  ["lead", "Lead"],
  ["tendering", "Tendering"],
  ["won", "Won"],
  ["in_progress", "In progress"],
  ["on_hold", "On hold"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
];

export function ProjectForm({
  mode,
  customers,
  values = {},
  nextCode,
}: {
  mode: "create" | "edit";
  customers: { id: string; name: string }[];
  values?: ProjectFormValues;
  nextCode?: string;
}) {
  const action = mode === "create" ? createProject : updateProject;
  const [state, formAction, pending] = useActionState(
    action,
    null as Result | null,
  );
  const router = useRouter();
  const [addingCustomer, setAddingCustomer] = useState(false);
  // a customer created from the modal is selected straight away, so the new
  // project does not have to be saved and reopened to attach it
  const [justAdded, setJustAdded] = useState<{ id: string; name: string } | null>(null);
  const [customerId, setCustomerId] = useState(values.customer_id ?? "");

  // live end-date preview so the duration is not an abstract number
  const [start, setStart] = useState(values.start_date ?? "");
  const [days, setDays] = useState(
    values.duration_days === null || values.duration_days === undefined
      ? ""
      : String(values.duration_days),
  );
  const end = (() => {
    const n = parseInt(days, 10);
    if (!start || !Number.isFinite(n)) return null;
    const d = new Date(start);
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("en-GB", { dateStyle: "medium" });
  })();

  return (
    <>
    <ClientModal
      open={addingCustomer}
      onClose={() => setAddingCustomer(false)}
      onSaved={(c) => {
        setJustAdded(c);
        setCustomerId(c.id);
        router.refresh();
      }}
    />
    <form action={formAction} className="space-y-5">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label htmlFor="name" className={label}>Project name</label>
          <input id="name" name="name" required defaultValue={values.name ?? ""}
            placeholder="Ministry Of Youth — Office Renovation" className={input} />
        </div>
        <div>
          <label htmlFor="code" className={label}>Code</label>
          <input id="code" name="code" defaultValue={values.code ?? nextCode ?? ""}
            className={`${input} font-mono`} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label htmlFor="customer_id" className="text-sm font-medium">Customer</label>
            <button type="button" onClick={() => setAddingCustomer(true)}
              className="text-xs font-medium text-[var(--brand)] hover:underline">
              + Add new customer
            </button>
          </div>
          <select id="customer_id" name="customer_id" value={customerId}
            onChange={(e) => setCustomerId(e.target.value)} className={input}>
            <option value="">No customer</option>
            {justAdded && !customers.some((c) => c.id === justAdded.id) && <option value={justAdded.id}>{justAdded.name}</option>}
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status" className={label}>Status</label>
          <select id="status" name="status" defaultValue={values.status ?? "in_progress"} className={input}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="start_date" className={label}>Start date</label>
          <input id="start_date" name="start_date" type="date" value={start}
            onChange={(e) => setStart(e.target.value)} className={input} />
        </div>
        <div>
          <label htmlFor="duration_days" className={label}>Duration (days)</label>
          <input id="duration_days" name="duration_days" type="number" min="0" value={days}
            onChange={(e) => setDays(e.target.value)} className={input} />
        </div>
        <div>
          <span className={label}>Finishes</span>
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-sm text-[var(--muted)]">
            {end ?? "—"}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="contract_value" className={label}>Project value (MVR)</label>
          <input id="contract_value" name="contract_value" type="number" step="0.01"
            defaultValue={values.contract_value ?? ""} className={input} />
        </div>
        <div>
          <label htmlFor="gst_amount" className={label}>GST</label>
          <input id="gst_amount" name="gst_amount" type="number" step="0.01"
            defaultValue={values.gst_amount ?? ""} placeholder="Leave blank for 8%" className={input} />
          <p className="mt-1 text-xs text-[var(--muted)]">Blank calculates 8% of value + variations.</p>
        </div>
        <div>
          <label htmlFor="progress_pct" className={label}>Progress (%)</label>
          <input id="progress_pct" name="progress_pct" type="number" min="0" max="100"
            defaultValue={values.progress_pct ?? 0} className={input} />
        </div>
      </div>

      <div className="sm:w-1/2">
        <label htmlFor="recognition_method" className={label}>Revenue is recognised</label>
        <select id="recognition_method" name="recognition_method" defaultValue={values.recognition_method ?? ""} className={input}>
          <option value="">Company default (Settings → Accounting)</option>
          <option value="billing">As it is billed</option>
          <option value="poc">By percentage of completion</option>
        </select>
        <p className="mt-1 text-xs text-[var(--muted)]">Percentage of completion posts WIP at each period end from cost to date.</p>
      </div>

      <div>
        <label htmlFor="site_address" className={label}>
          Site address <span className="font-normal text-[var(--muted)]">(optional)</span>
        </label>
        <input id="site_address" name="site_address" defaultValue={values.site_address ?? ""} className={input} />
      </div>

      <div>
        <label htmlFor="description" className={label}>
          Description <span className="font-normal text-[var(--muted)]">(optional)</span>
        </label>
        <textarea id="description" name="description" rows={2}
          defaultValue={values.description ?? ""} className={input} />
      </div>

      {state?.error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending}
          className="rounded-lg bg-[var(--brand)] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-60">
          {pending ? "Saving…" : mode === "create" ? "Create project" : "Save changes"}
        </button>
        <Link href={values.id ? `/projects/${values.id}` : "/projects"}
          className="text-sm text-[var(--muted)] hover:underline">
          Cancel
        </Link>
      </div>
    </form>
    </>
  );
}
