"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, Table, Th, Td } from "@/components/ui";
import { money, date, num } from "@/lib/format";
import { ShopModal, type ShopValues } from "@/components/shop-modal";
import { deleteShop } from "@/app/actions/shops";

export interface ShopRow extends ShopValues {
  id: string;
  name: string;
  bills: number;
  spend: number;
  gst: number;
  last_bill: string | null;
  projects: { id: string; name: string; spend: number }[];
}

type Sort = "spend" | "name" | "bills" | "recent";

const SORTS: { key: Sort; label: string }[] = [
  { key: "name", label: "Shop name (A–Z)" },
  { key: "spend", label: "Most spent" },
  { key: "bills", label: "Most bills" },
  { key: "recent", label: "Most recent" },
];

export function ShopsTable({ rows }: { rows: ShopRow[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ShopRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  /** shops with no TIN cannot go on a GST claim, so they are worth isolating */
  const [onlyMissingTin, setOnlyMissingTin] = useState(false);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      if (onlyMissingTin && r.tin) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.tin ?? "").toLowerCase().includes(needle) ||
        (r.trade ?? "").toLowerCase().includes(needle) ||
        r.projects.some((p) => p.name.toLowerCase().includes(needle))
      );
    });

    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (sort === "bills") return b.bills - a.bills || b.spend - a.spend;
      if (sort === "recent") return (b.last_bill ?? "").localeCompare(a.last_bill ?? "");
      return b.spend - a.spend || a.name.localeCompare(b.name);
    });
  }, [rows, q, sort, onlyMissingTin]);

  const shownSpend = shown.reduce((s, r) => s + num(r.spend), 0);

  async function remove(id: string) {
    const r = await deleteShop(id);
    setNotice(r.error ?? null);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search shop, TIN or project"
          className="w-64 rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]"
        />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}
          className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)]">
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
          <input type="checkbox" checked={onlyMissingTin}
            onChange={(e) => setOnlyMissingTin(e.target.checked)}
            className="h-4 w-4 rounded border-[var(--border)]" />
          Missing a TIN
        </label>

        <div className="ml-auto flex items-center gap-3">
          {notice && <p className="text-xs text-red-700">{notice}</p>}
          <button type="button" onClick={() => setAdding(true)}
            className="inline-flex items-center justify-center rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)]">
            + Add new shop
          </button>
        </div>
      </div>

      <Card>
        {shown.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm text-[var(--muted)]">
              {rows.length === 0
                ? "No shops yet. They also add themselves as you photograph bills."
                : "No shop matches that."}
            </p>
            {rows.length === 0 && (
              <button type="button" onClick={() => setAdding(true)}
                className="mt-4 inline-flex items-center justify-center rounded-lg bg-[var(--brand)] px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--brand-hover)]">
                + Add new shop
              </button>
            )}
          </div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Shop</Th><Th>TIN</Th><Th>Projects</Th><Th>Contact</Th>
                <Th right>Bills</Th><Th right>Spend</Th>
                <Th right>Last bill</Th><Th right>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className="hover:bg-[var(--hover)]">
                  <Td className="font-medium">
                    <Link href={`/shops/${s.id}`} className="hover:text-[var(--brand)] hover:underline">
                      {s.name}
                    </Link>
                    {s.trade && (
                      <span className="block text-xs font-normal text-[var(--muted)]">
                        {s.trade}
                      </span>
                    )}
                  </Td>
                  <Td className="font-mono text-xs">
                    {s.tin ?? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">
                        missing
                      </span>
                    )}
                  </Td>
                  <Td>
                    {s.projects.length === 0 ? (
                      <span className="text-xs text-[var(--muted)]">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {s.projects.map((p) => (
                          <Link key={p.id} href={`/projects/${p.id}`}
                            title={`${money(p.spend)} on ${p.name}`}
                            className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] text-[var(--brand)] hover:underline">
                            {p.name}
                          </Link>
                        ))}
                      </span>
                    )}
                  </Td>
                  <Td className="text-xs text-[var(--muted)]">
                    {s.contact_name || s.phone || s.email ? (
                      <>
                        {s.contact_name && <span className="block">{s.contact_name}</span>}
                        {s.phone && <span className="block">{s.phone}</span>}
                      </>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td right>{s.bills || "—"}</Td>
                  <Td right className="font-medium">{s.spend ? money(s.spend) : "—"}</Td>
                  <Td right className="text-xs text-[var(--muted)]">
                    {s.last_bill ? date(s.last_bill) : "—"}
                  </Td>
                  <Td right>
                    <button type="button" onClick={() => setEditing(s)}
                      className="text-xs text-[var(--muted)] hover:text-[var(--brand)] hover:underline">
                      Edit
                    </button>
                    {s.bills === 0 && (
                      <button type="button" onClick={() => remove(s.id)}
                        className="ml-2 text-xs text-[var(--muted)] hover:text-red-700">
                        Remove
                      </button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[var(--hover)] font-semibold">
                <Td>{shown.length === rows.length ? "All shops" : `${shown.length} shown`}</Td>
                <Td>{""}</Td><Td>{""}</Td><Td>{""}</Td>
                <Td right>{shown.reduce((s, r) => s + r.bills, 0)}</Td>
                <Td right>{money(shownSpend)}</Td>
                <Td>{""}</Td><Td>{""}</Td>
              </tr>
            </tfoot>
          </Table>
        )}
      </Card>

      <ShopModal open={adding} onClose={() => setAdding(false)} />
      <ShopModal open={editing !== null} onClose={() => setEditing(null)}
        values={editing ?? undefined} key={editing?.id ?? "none"} />
    </>
  );
}
