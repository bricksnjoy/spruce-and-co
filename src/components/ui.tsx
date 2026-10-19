import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-[var(--muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--muted)]">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const toneClass = {
    default: "text-[var(--text)]",
    good: "text-emerald-700",
    bad: "text-red-700",
    warn: "text-amber-700",
  }[tone];
  return (
    <Card className="px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
    </Card>
  );
}

const BADGE_TONES: Record<string, string> = {
  lead: "bg-slate-100 text-slate-700",
  tendering: "bg-blue-50 text-blue-700",
  won: "bg-emerald-50 text-emerald-700",
  in_progress: "bg-emerald-50 text-emerald-700",
  on_hold: "bg-amber-50 text-amber-700",
  completed: "bg-[var(--brand-soft)] text-[var(--brand)]",
  cancelled: "bg-red-50 text-red-700",
  not_started: "bg-slate-100 text-slate-700",
  blocked: "bg-red-50 text-red-700",
  prospect: "bg-slate-100 text-slate-700",
  kyc_pending: "bg-amber-50 text-amber-700",
  active: "bg-emerald-50 text-emerald-700",
  inactive: "bg-slate-100 text-slate-500",
  draft: "bg-slate-100 text-slate-700",
  open: "bg-blue-50 text-blue-700",
  funded: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-600",
  pledged: "bg-blue-50 text-blue-700",
  signed: "bg-indigo-50 text-indigo-700",
  defaulted: "bg-red-50 text-red-700",
  withdrawn: "bg-slate-100 text-slate-500",
  sent: "bg-blue-50 text-blue-700",
  part_paid: "bg-amber-50 text-amber-700",
  paid: "bg-emerald-50 text-emerald-700",
  filed: "bg-amber-50 text-amber-700",
  overdue: "bg-red-50 text-red-700",
  void: "bg-slate-100 text-slate-500",
  awaiting_approval: "bg-amber-50 text-amber-700",
  approved: "bg-blue-50 text-blue-700",
  disputed: "bg-red-50 text-red-700",
  admin: "bg-[var(--brand-soft)] text-[var(--brand)]",
  manager: "bg-blue-50 text-blue-700",
  finance: "bg-indigo-50 text-indigo-700",
  viewer: "bg-slate-100 text-slate-600",
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-[var(--muted)]">—</span>;
  const tone = BADGE_TONES[value] ?? "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {value.replace(/_/g, " ")}
    </span>
  );
}

export function Progress({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Number(value ?? 0)));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--border)]">
        <div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs tabular-nums text-[var(--muted)]">{v.toFixed(0)}%</span>
    </div>
  );
}

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children,
  right = false,
  className = "",
}: {
  children: ReactNode;
  right?: boolean;
  className?: string;
}) {
  return (
    <th
      className={`border-b border-[var(--border)] px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-[var(--muted)] ${
        right ? "text-right" : "text-left"
      } ${className}`}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  right = false,
  className = "",
  colSpan,
}: {
  children: ReactNode;
  right?: boolean;
  className?: string;
  colSpan?: number;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border-b border-[var(--border)] px-5 py-3 ${
        right ? "text-right tabular-nums" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}

export function Empty({ message }: { message: string }) {
  return <p className="px-5 py-10 text-center text-sm text-[var(--muted)]">{message}</p>;
}

export function Button({
  children,
  href,
  type = "button",
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  href?: string;
  type?: "button" | "submit";
  variant?: "primary" | "ghost";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm font-medium transition-colors";
  const styles =
    variant === "primary"
      ? "bg-[var(--brand)] text-white hover:bg-[var(--brand-hover)]"
      : "border border-[var(--border)] bg-[var(--field)] hover:bg-[var(--brand-soft)]";
  const cls = `${base} ${styles} ${className}`;
  if (href) return <Link href={href} className={cls}>{children}</Link>;
  return <button type={type} className={cls}>{children}</button>;
}
