"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { input, label, primary } from "@/components/form-styles";

/** Pick a project and go to its Financing tab with this lender chosen. */
export function RecordLoan({ lenderId, projects }: { lenderId: string; projects: { id: string; code: string; name: string }[] }) {
  const [project, setProject] = useState("");
  const router = useRouter();
  if (projects.length === 0) return <p className="px-5 py-4 text-sm text-[var(--muted)]">No open project to record a loan on.</p>;
  return (
    <form className="flex flex-wrap items-end gap-3 px-5 py-4"
      onSubmit={(e) => { e.preventDefault(); if (project) router.push(`/projects/${project}?tab=financing&lender=${lenderId}`); }}>
      <div className="min-w-64"><label htmlFor="rl-project" className={label}>Project</label>
        <select id="rl-project" required value={project} onChange={(e) => setProject(e.target.value)} className={input}>
          <option value="">Choose…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select></div>
      <button type="submit" className={primary}>Record a loan</button>
    </form>
  );
}
