import { PageHeader } from "@/components/ui";

export function NoPayrollAccess() {
  return (
    <div className="max-w-xl">
      <PageHeader title="Payroll" />
      <p className="rounded-lg border border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">
        Pay is private: only admin, finance, or someone an admin has given payroll permission can see it.
      </p>
    </div>
  );
}
