"use client";

import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Card, CardHeader, Stat } from "@/components/ui";
import { FormSkeleton } from "@/components/skeleton";
import { hint, input, label, primary, small } from "@/components/form-styles";
import { money } from "@/lib/format";
import {
  MAX_PIECES,
  UNITS,
  bare,
  parseLength,
  parseList,
  planCuts,
  planParts,
  size,
  type BoardSpec,
  type PartPlan,
  type PartSize,
  type Unit,
} from "@/lib/board-cuts";
import type { Placed, Sheet } from "@/lib/cutting";

interface Row {
  id: string;
  name: string;
  length: string;
  width: string;
  thick: string;
  qty: string;
}

interface BoardText {
  length: string;
  width: string;
  thick: string;
  kerf: string;
  price: string;
  turn: boolean;
}

interface Saved {
  unit: Unit;
  rows: Row[];
  board: BoardText;
}

/** the last list, kept in this browser so it is there when you come back */
const KEY = "cut-planner";

const START: Saved = {
  unit: "in",
  rows: [
    { id: "leg", name: "Table leg", length: "2ft", width: "2in", thick: "2in", qty: "4" },
    { id: "top", name: "Table top", length: "2ft", width: "2ft", thick: "", qty: "1" },
  ],
  board: { length: "8ft", width: "4ft", thick: "", kerf: "1/8in", price: "", turn: true },
};

const INK = "#1b2330";
const MUTED = "#6b7686";
/** fill and outline for each part, in list order */
const COLORS: [string, string][] = [
  ["#dbe8f6", "#3b6aa0"],
  ["#fde3c8", "#b5651d"],
  ["#d9f0dc", "#2f7d43"],
  ["#f6d6e0", "#a3375c"],
  ["#e6def6", "#5b46a0"],
  ["#fff1b8", "#8a6d00"],
  ["#d3eeee", "#2b7a7a"],
  ["#f3d9cc", "#9a4a2a"],
  ["#e2e9cc", "#5e7225"],
  ["#e3e6ea", "#4a5563"],
];

let seq = 0;
const newId = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;
const blank = (): Row => ({ id: newId(), name: "", length: "", width: "", thick: "", qty: "1" });

const isRow = (r: unknown): r is Row =>
  typeof r === "object" && r !== null &&
  ["id", "name", "length", "width", "thick", "qty"].every((k) => typeof (r as Record<string, unknown>)[k] === "string");

function load(): Saved | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!s || !Array.isArray(s.rows) || !s.rows.every(isRow) || !UNITS.some(([u]) => u === s.unit)) return null;
    return { unit: s.unit, rows: s.rows, board: { ...START.board, ...s.board } };
  } catch {
    return null;
  }
}

/** a saw cut of nothing is allowed; any other size has to be readable */
function readKerf(text: string, unit: Unit) {
  if (!text.trim() || Number(text) === 0) return 0;
  return parseLength(text, unit);
}

function readRow(r: Row, unit: Unit) {
  const length = parseLength(r.length, unit);
  const width = parseLength(r.width, unit);
  const thick = r.thick.trim() ? parseLength(r.thick, unit) : null;
  const qty = /^\s*\d+\s*$/.test(r.qty) ? Number(r.qty) : 0;
  const bad = {
    length: length == null,
    width: width == null,
    thick: r.thick.trim() !== "" && thick == null,
    qty: qty < 1,
  };
  return { length, width, thick, qty, bad, ok: !Object.values(bad).some(Boolean) };
}

/** boards cut exactly alike, one after another, are drawn once */
function groupSheets(sheets: Sheet[]) {
  const out: { sheet: Sheet; from: number; count: number; sig: string }[] = [];
  sheets.forEach((sheet, i) => {
    const sig = sheet.placed.map((p) => `${p.code}|${p.x}|${p.y}|${p.w}|${p.h}`).join(";");
    const last = out.at(-1);
    if (last && last.sig === sig) last.count++;
    else out.push({ sheet, from: i + 1, count: 1, sig });
  });
  return out;
}

function area(sqIn: number, unit: Unit) {
  return unit === "mm" || unit === "cm"
    ? `${(sqIn * 0.00064516).toFixed(2)} m²`
    : `${Number((sqIn / 144).toFixed(1))} sq ft`;
}

const cell = (bad: boolean) =>
  `${bad ? input.replace("border-[var(--border)]", "border-red-400") : input} px-2 py-1.5`;

const never = () => () => {};

/** The list lives in the browser, so the planner is drawn there and not on the server. */
export function CutPlanner() {
  const browser = useSyncExternalStore(never, () => true, () => false);
  return browser ? <Planner /> : <FormSkeleton />;
}

function Planner() {
  const [saved] = useState(() => load() ?? START);
  const [unit, setUnit] = useState<Unit>(saved.unit);
  const [rows, setRows] = useState<Row[]>(saved.rows);
  const [board, setBoard] = useState<BoardText>(saved.board);
  const [quick, setQuick] = useState("");
  const figs = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ unit, rows, board } satisfies Saved));
    } catch {
      // private window or storage full: the planner still works, it just forgets
    }
  }, [unit, rows, board]);

  const read = rows.map((r) => readRow(r, unit));
  const named = (i: number) => rows[i].name.trim() || `Part ${i + 1}`;
  const parts: PartSize[] = rows.flatMap((r, i) => {
    const x = read[i];
    return x.ok ? [{ id: r.id, name: named(i), length: x.length!, width: x.width!, thick: x.thick, qty: x.qty }] : [];
  });

  const bl = parseLength(board.length, unit);
  const bw = parseLength(board.width, unit);
  const bt = board.thick.trim() ? parseLength(board.thick, unit) : null;
  const kerf = readKerf(board.kerf, unit);
  const price = Number(board.price.replace(/,/g, ""));
  const boardBad = {
    length: bl == null,
    width: bw == null,
    thick: board.thick.trim() !== "" && bt == null,
    kerf: kerf == null,
    price: board.price.trim() !== "" && !(price >= 0),
  };
  const spec: BoardSpec | null =
    bl != null && bw != null && kerf != null && !boardBad.thick ? { length: bl, width: bw, thick: bt, kerf, turn: board.turn } : null;

  // typing stays quick on a long list: the layout catches up a moment later
  const job = useDeferredValue(JSON.stringify({ parts, spec }));
  const result = useMemo(() => {
    const { parts, spec } = JSON.parse(job) as { parts: PartSize[]; spec: BoardSpec | null };
    if (!spec || !parts.length) return null;
    const count = planParts(parts, spec).reduce((s, p) => s + (p.oversize ? 0 : p.pieces), 0);
    return { spec, count, plan: count > MAX_PIECES ? null : planCuts(parts, spec) };
  }, [job]);
  const plan = result?.plan ?? null;
  // the board the drawings were made for, which may be a keystroke behind the form
  const planSpec = result?.spec ?? null;

  const colorOf = (id: string) => COLORS[Math.max(0, rows.findIndex((r) => r.id === id)) % COLORS.length];
  const quickRead = useMemo(() => parseList(quick), [quick]);

  function addQuick() {
    const { parts: found, bad } = parseList(quick);
    if (!found.length) return;
    setRows((rs) => [
      ...rs.filter((r) => r.name || r.length || r.width || r.thick),
      ...found.map((p) => ({ id: newId(), name: p.name, length: p.length, width: p.width, thick: p.thick, qty: String(p.qty) })),
    ]);
    setQuick(bad.join("\n"));
  }

  const update = (id: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const setB = (patch: Partial<BoardText>) => setBoard((b) => ({ ...b, ...patch }));
  const left = rows.filter((_, i) => !read[i].ok && (rows[i].length || rows[i].width)).length;

  const stale = plan ? JSON.stringify({ parts, spec }) !== job : false;
  const groups = plan ? groupSheets(plan.sheets) : [];
  const boards = plan?.sheets.length ?? 0;
  const oversize = plan?.parts.filter((p) => p.oversize) ?? [];

  function print() {
    if (!plan) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const figures = [...(figs.current?.querySelectorAll<HTMLElement>("[data-board]") ?? [])]
      .map((f) => `<section class="page"><h2>${esc(f.dataset.board ?? "")}</h2>${f.querySelector("svg")?.outerHTML ?? ""}</section>`)
      .join("");
    const body = plan.parts
      .map((p) =>
        `<tr><td>${esc(p.name)}</td><td>${esc(partSize(p, unit))}</td><td class="n">${p.qty}</td>` +
        `<td>${esc(size(p.cutL, unit))} × ${esc(size(p.cutW, unit))}</td><td class="n">${p.oversize ? "—" : p.pieces}</td><td>${esc(note(p, planSpec, unit))}</td></tr>`,
      )
      .join("");
    w.document.write(`<!doctype html><html><head><title>Board cut plan</title>
      <style>
        @page { size: A4 landscape; margin: 10mm; }
        body { font-family: Poppins, Arial, sans-serif; color: ${INK}; margin: 0; }
        header { margin: 0 0 5mm; } header h1 { font-size: 16pt; margin: 0; } header p { margin: 1mm 0 0; font-size: 9.5pt; color: ${MUTED}; }
        .page { page-break-after: always; break-after: page; }
        h2 { font-size: 11pt; margin: 0 0 3mm; }
        svg { display: block; width: 100%; height: auto; max-height: 160mm; }
        table { width: 100%; border-collapse: collapse; font-size: 9pt; }
        th { text-align: left; color: ${MUTED}; font-weight: 500; border-bottom: 1px solid #ccd; padding: 1.2mm 2mm; }
        td { border-bottom: 1px solid #e3e6ea; padding: 1.2mm 2mm; vertical-align: top; }
        td.n { text-align: right; }
      </style></head><body>
      <header><h1>Board cut plan</h1><p>Spruce &amp; Co · ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} ·
        ${boards} board${boards === 1 ? "" : "s"} of ${esc(boardName(plan.sheetW, plan.sheetH, planSpec?.thick ?? null, unit))} · saw cut ${esc(planSpec?.kerf ? size(planSpec.kerf, unit) : "none")}</p></header>
      ${figures}
      <section><h2>Cut list</h2><table><thead><tr><th>Part</th><th>Size</th><th>Qty</th><th>Cut from the board</th><th>Pieces</th><th>Note</th></tr></thead><tbody>${body}</tbody></table></section>
      <script>window.onload = () => { setTimeout(() => window.print(), 300); };</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="Parts"
            subtitle="Everything you need cut, one line per part"
            action={
              <label className="flex shrink-0 items-center gap-2 text-xs text-[var(--muted)]">
                Plain numbers in
                <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--field)] px-2 py-1 text-xs text-[var(--text)] outline-none focus:border-[var(--brand)]">
                  {UNITS.map(([u, text]) => <option key={u} value={u}>{text}</option>)}
                </select>
              </label>
            }
          />
          <div className="space-y-5 px-5 py-4">
            <div>
              <label htmlFor="quick" className={label}>Type parts</label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <textarea id="quick" rows={2} value={quick} onChange={(e) => setQuick(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      addQuick();
                    }
                  }}
                  placeholder="Table leg: 2ft x 2in x 2in times 4, Table top: 2ft x 2ft"
                  className={`${input} min-h-[42px] resize-y`} />
                <button type="button" onClick={addQuick} disabled={!quickRead.parts.length} className={`${primary} shrink-0`}>
                  Add{quickRead.parts.length > 1 ? ` ${quickRead.parts.length}` : ""}
                </button>
              </div>
              {quick.trim() ? (
                <ul className="mt-2 space-y-0.5 text-xs">
                  {quickRead.parts.map((p, i) => {
                    const r = readRow({ id: "", ...p, qty: String(p.qty) }, unit);
                    return (
                      <li key={i} className={r.ok ? "text-[var(--muted)]" : "text-red-700"}>
                        {r.ok ? "✓" : "✗"} {p.name || "Part"} ·{" "}
                        {r.ok ? `${bare(r.length!, unit)} × ${bare(r.width!, unit)}${r.thick ? ` × ${bare(r.thick, unit)}` : ""} ${unitWord(unit)}` : "a size cannot be read"}
                        {" "}· {p.qty} {p.qty === 1 ? "piece" : "pieces"}
                      </li>
                    );
                  })}
                  {quickRead.bad.map((b, i) => (
                    <li key={`bad${i}`} className="text-red-700">✗ “{b}” — write it as length x width, e.g. 2ft x 18in</li>
                  ))}
                </ul>
              ) : (
                <p className={hint}>
                  Name first if you like, then length x width (x thickness), then how many: times 4, x 4 or 4 pcs. Split parts
                  with commas or new lines. Check the line that appears here: it shows how each part reads. Feet: 2ft or 2&apos;. Inches: 2in or 2&quot;. Also 2&apos;6&quot;, 3/4in, 18mm. Enter adds them.
                </p>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--muted)]">
                    <th className="w-6 pb-1.5 font-medium" aria-label="Colour" />
                    <th className="pb-1.5 pr-2 font-medium">Part</th>
                    <th className="w-24 pb-1.5 pr-2 font-medium">Length</th>
                    <th className="w-24 pb-1.5 pr-2 font-medium">Width</th>
                    <th className="w-24 pb-1.5 pr-2 font-medium">Thickness</th>
                    <th className="w-16 pb-1.5 pr-2 font-medium">Qty</th>
                    <th className="w-40 pb-1.5 pr-2 font-medium">Reads as</th>
                    <th className="w-8 pb-1.5" aria-label="Remove" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const x = read[i];
                    const [fill, line] = COLORS[i % COLORS.length];
                    const empty = !r.length && !r.width;
                    return (
                      <tr key={r.id}>
                        <td className="py-1 pr-2">
                          <span className="block h-4 w-4 rounded" style={{ background: fill, border: `1.5px solid ${line}` }} />
                        </td>
                        <td className="py-1 pr-2">
                          <input aria-label={`Part ${i + 1} name`} value={r.name} placeholder={`Part ${i + 1}`}
                            onChange={(e) => update(r.id, { name: e.target.value })} className={cell(false)} />
                        </td>
                        <td className="py-1 pr-2">
                          <input aria-label={`${named(i)} length`} value={r.length} placeholder="2ft"
                            onChange={(e) => update(r.id, { length: e.target.value })} className={cell(!empty && x.bad.length)} />
                        </td>
                        <td className="py-1 pr-2">
                          <input aria-label={`${named(i)} width`} value={r.width} placeholder="18in"
                            onChange={(e) => update(r.id, { width: e.target.value })} className={cell(!empty && x.bad.width)} />
                        </td>
                        <td className="py-1 pr-2">
                          <input aria-label={`${named(i)} thickness`} value={r.thick} placeholder="board"
                            onChange={(e) => update(r.id, { thick: e.target.value })} className={cell(x.bad.thick)} />
                        </td>
                        <td className="py-1 pr-2">
                          <input aria-label={`${named(i)} quantity`} value={r.qty} inputMode="numeric"
                            onChange={(e) => update(r.id, { qty: e.target.value })} className={cell(x.bad.qty)} />
                        </td>
                        <td className="py-1 pr-2 text-xs text-[var(--muted)]">
                          {x.ok
                            ? `${bare(x.length!, unit)} × ${bare(x.width!, unit)}${x.thick ? ` × ${bare(x.thick, unit)}` : ""} ${unitWord(unit)}`
                            : empty ? "" : <span className="text-red-700">{problem(x.bad)}</span>}
                        </td>
                        <td className="py-1 text-right">
                          <button type="button" onClick={() => setRows((rs) => rs.filter((o) => o.id !== r.id))}
                            aria-label={`Remove ${named(i)}`} title="Remove"
                            className="rounded-md px-2 py-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-red-700">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setRows((rs) => [...rs, blank()])} className={small}>+ Add a part</button>
              {rows.length > 0 && (
                <button type="button" onClick={() => window.confirm("Clear every part from the list?") && setRows([])}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--muted)] hover:text-red-700">
                  Clear all
                </button>
              )}
              {left > 0 && (
                <span className="text-xs text-red-700">
                  {left} part{left === 1 ? " is" : "s are"} left out until {left === 1 ? "its" : "their"} sizes can be read
                </span>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Board" subtitle="The sheet the parts are cut from" />
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 px-5 py-4">
            <Field label="Length" bad={boardBad.length} value={board.length} placeholder="8ft" onChange={(v) => setB({ length: v })} />
            <Field label="Width" bad={boardBad.width} value={board.width} placeholder="4ft" onChange={(v) => setB({ width: v })} />
            <Field label="Thickness" bad={boardBad.thick} value={board.thick} placeholder="e.g. 18mm" onChange={(v) => setB({ thick: v })} />
            <Field label="Saw cut" bad={boardBad.kerf} value={board.kerf} placeholder="1/8in" onChange={(v) => setB({ kerf: v })} />
            <div className="col-span-2">
              <Field label="Price per board (optional)" bad={boardBad.price} value={board.price} placeholder="MVR" inputMode="decimal"
                onChange={(v) => setB({ price: v })} />
            </div>
            <label className="col-span-2 flex items-start gap-2 text-sm">
              <input type="checkbox" checked={board.turn} onChange={(e) => setB({ turn: e.target.checked })} className="mt-0.5" />
              <span>
                Pieces may be turned to fit
                <span className={`${hint} block`}>Untick to keep the grain along the board: each part&apos;s longer side runs along its length.</span>
              </span>
            </label>
            <p className={`${hint} col-span-2 mt-0`}>
              With a thickness, a part thicker than the board — a 2in leg from 18mm board — is cut in layers to glue up.
              Leave it blank to cut every part once.
            </p>
          </div>
        </Card>
      </div>

      {!parts.length ? (
        <Card className="px-5 py-10 text-center text-sm text-[var(--muted)]">Add a part to see how the boards are cut.</Card>
      ) : !spec ? (
        <Card className="px-5 py-10 text-center text-sm text-red-700">Enter the board&apos;s length and width to see how it is cut.</Card>
      ) : result && !plan ? (
        <Card className="px-5 py-10 text-center text-sm text-red-700">
          That is {result.count.toLocaleString()} pieces. The planner lays out up to {MAX_PIECES.toLocaleString()} at a time — split the job into smaller lists.
        </Card>
      ) : plan && (
        <div className={`space-y-6 transition-opacity ${stale ? "opacity-60" : ""}`}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Boards needed" value={String(boards)} hint={boardName(plan.sheetW, plan.sheetH, planSpec?.thick ?? null, unit)} />
            <Stat label="Pieces to cut" value={String(plan.sheets.reduce((s, sh) => s + sh.placed.length, 0))}
              hint={`from ${plan.parts.length} part${plan.parts.length === 1 ? "" : "s"} on the list`} />
            <Stat label="Wood used" value={plan.boardArea ? `${Math.round((plan.usedArea / plan.boardArea) * 100)}%` : "—"}
              hint={plan.boardArea ? `${area(plan.boardArea - plan.usedArea, unit)} left as offcuts` : undefined} />
            <Stat label="Boards cost" value={price > 0 ? money(boards * price) : "—"}
              hint={price > 0 ? `${boards} × ${money(price)}` : "Add a price per board"} />
          </div>

          {oversize.length > 0 && (
            <p className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              Bigger than the board, so left out: {oversize.map((p) => `${p.name} (${size(p.cutL, unit)} × ${size(p.cutW, unit)})`).join(", ")}.
              Join it from smaller pieces or use a bigger board.
            </p>
          )}

          <Card>
            <CardHeader
              title="How each board is cut"
              subtitle={`Sizes in ${unitWord(unit)}. Hatched areas are offcuts. Every cut runs straight from edge to edge.`}
              action={boards > 0 && <button type="button" onClick={print} className={small}>Print</button>}
            />
            <div ref={figs} className="space-y-6 px-5 py-4">
              {groups.map((g) => {
                const name = g.count > 1
                  ? `Boards ${g.from}–${g.from + g.count - 1} — ${g.count} boards cut the same way`
                  : `Board ${g.from} of ${boards}`;
                return (
                  <figure key={g.from} data-board={name} className="mx-auto max-w-5xl space-y-2">
                    <figcaption className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="font-medium">{name}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {g.sheet.placed.length} piece{g.sheet.placed.length === 1 ? "" : "s"} · {Math.round(g.sheet.used * 100)}% used
                      </span>
                    </figcaption>
                    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                      <BoardDrawing sheet={g.sheet} W={plan.sheetW} H={plan.sheetH} unit={unit} colorOf={colorOf} />
                    </div>
                  </figure>
                );
              })}
              {!boards && <p className="text-sm text-[var(--muted)]">Nothing fits on the board.</p>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Cut list" subtitle="What to cut for each part" />
            <div className="overflow-x-auto px-5 py-4">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--muted)]">
                    <th className="pb-1.5 pr-3 font-medium">Part</th>
                    <th className="pb-1.5 pr-3 font-medium">Size</th>
                    <th className="pb-1.5 pr-3 text-right font-medium">Qty</th>
                    <th className="pb-1.5 pr-3 font-medium">Cut from the board</th>
                    <th className="pb-1.5 pr-3 text-right font-medium">Pieces</th>
                    <th className="pb-1.5 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.parts.map((p) => {
                    const [fill, line] = colorOf(p.id);
                    return (
                      <tr key={p.id} className="[&>td]:border-t [&>td]:border-[var(--border)]">
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-2">
                            <span className="h-3.5 w-3.5 shrink-0 rounded" style={{ background: fill, border: `1.5px solid ${line}` }} />
                            {p.name}
                          </span>
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3">{partSize(p, unit)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{p.qty}</td>
                        <td className="whitespace-nowrap py-2 pr-3">{size(p.cutL, unit)} × {size(p.cutW, unit)}</td>
                        <td className="py-2 pr-3 text-right font-medium tabular-nums">{p.oversize ? "—" : p.pieces}</td>
                        <td className={`py-2 text-xs ${p.oversize ? "text-amber-800" : "text-[var(--muted)]"}`}>{note(p, planSpec, unit)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Field({
  label: text,
  bad,
  value,
  placeholder,
  inputMode,
  onChange,
}: {
  label: string;
  bad: boolean;
  value: string;
  placeholder?: string;
  inputMode?: "decimal";
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={label}>{text}</label>
      <input id={id} value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)}
        className={cell(bad)} aria-invalid={bad || undefined} />
    </div>
  );
}

/* ─────────────── one board ─────────────── */

function BoardDrawing({
  sheet,
  W,
  H,
  unit,
  colorOf,
}: {
  sheet: Sheet;
  W: number;
  H: number;
  unit: Unit;
  colorOf: (id: string) => [string, string];
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const fs = Math.max(W, H * 2) / 40;
  const padL = fs * 2.4;
  const padT = fs * 2.4;
  const pad = fs * 0.8;
  const tick = fs * 0.5;
  return (
    <svg viewBox={`${-padL} ${-padT} ${W + padL + pad} ${H + padT + pad}`} xmlns="http://www.w3.org/2000/svg" role="img"
      aria-label={`Board ${size(W, unit)} by ${size(H, unit)} with ${sheet.placed.length} pieces`}
      style={{ width: "100%", height: "auto", background: "#fff", display: "block" }} fontFamily="Poppins, Arial, sans-serif">
      <defs>
        <pattern id={`${uid}off`} width={fs * 0.9} height={fs * 0.9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={fs * 0.9} height={fs * 0.9} fill="#f4efe6" />
          <line x1={0} y1={0} x2={0} y2={fs * 0.9} stroke="#ddd2c0" strokeWidth={fs / 6} />
        </pattern>
      </defs>

      {/* the board's size, along the top and down the left */}
      <g stroke={MUTED} strokeWidth={fs / 16}>
        <line x1={0} y1={-fs * 1.1} x2={W} y2={-fs * 1.1} />
        <line x1={0} y1={-fs * 1.1 - tick} x2={0} y2={-fs * 1.1 + tick} />
        <line x1={W} y1={-fs * 1.1 - tick} x2={W} y2={-fs * 1.1 + tick} />
        <line x1={-fs * 1.1} y1={0} x2={-fs * 1.1} y2={H} />
        <line x1={-fs * 1.1 - tick} y1={0} x2={-fs * 1.1 + tick} y2={0} />
        <line x1={-fs * 1.1 - tick} y1={H} x2={-fs * 1.1 + tick} y2={H} />
      </g>
      <text x={W / 2} y={-fs * 1.5} fontSize={fs * 0.85} fill={MUTED} textAnchor="middle">{side(W, unit)}</text>
      <text x={-fs * 1.5} y={H / 2} fontSize={fs * 0.85} fill={MUTED} textAnchor="middle" transform={`rotate(-90 ${-fs * 1.5} ${H / 2})`}>
        {side(H, unit)}
      </text>

      <rect x={0} y={0} width={W} height={H} fill={`url(#${uid}off)`} stroke={INK} strokeWidth={fs / 8} />
      {sheet.placed.map((p, i) => (
        <PieceShape key={i} p={p} fs={fs} unit={unit} color={colorOf(p.code)} />
      ))}
    </svg>
  );
}

function PieceShape({ p, fs, unit, color }: { p: Placed; fs: number; unit: Unit; color: [string, string] }) {
  const dims = `${bare(p.rotated ? p.h : p.w, unit)} × ${bare(p.rotated ? p.w : p.h, unit)}`;
  // text runs along the piece's longer side
  const turn = p.h > p.w * 1.3;
  const long = turn ? p.h : p.w;
  const short = turn ? p.w : p.h;
  const two = Math.min(fs, (long * 1.6) / Math.max(p.label.length, dims.length, 4), short / 2.6);
  const one = Math.min(fs, (long * 1.6) / (p.label.length + dims.length + 3), short * 0.62);
  const stacked = two >= one * 0.9;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  return (
    <g>
      <title>{`${p.label}: ${size(p.rotated ? p.h : p.w, unit)} × ${size(p.rotated ? p.w : p.h, unit)}${p.rotated ? " (turned to fit)" : ""}`}</title>
      <rect x={p.x} y={p.y} width={p.w} height={p.h} fill={color[0]} stroke={color[1]} strokeWidth={fs / 14} />
      <g transform={turn ? `rotate(-90 ${cx} ${cy})` : undefined}>
        {stacked ? (
          <>
            <text x={cx} y={cy - two * 0.55} fontSize={two} fill={INK} textAnchor="middle" dominantBaseline="middle" fontWeight={500}>
              {p.label}
            </text>
            <text x={cx} y={cy + two * 0.7} fontSize={two * 0.85} fill={MUTED} textAnchor="middle" dominantBaseline="middle">
              {dims}
            </text>
          </>
        ) : (
          <text x={cx} y={cy} fontSize={one} fill={INK} textAnchor="middle" dominantBaseline="middle">
            {p.label} · {dims}
          </text>
        )}
      </g>
    </g>
  );
}

/* ─────────────── words ─────────────── */

function unitWord(unit: Unit) {
  return unit === "in" ? "inches" : unit === "ft" ? "feet and inches" : unit;
}

/** boards are bought by the foot: 8' × 4' */
const feet = (x: number, unit: Unit) => size(x, unit === "in" ? "ft" : unit);

function boardName(W: number, H: number, thick: number | null, unit: Unit) {
  return `${feet(W, unit)} × ${feet(H, unit)}${thick ? ` · ${size(thick, unit)} thick` : ""}`;
}

/** a side of the board on the drawing, in the unit of the pieces and in feet */
function side(x: number, unit: Unit) {
  return unit === "in" ? `${size(x, "in")} (${feet(x, unit)})` : size(x, unit);
}

function partSize(p: PartPlan, unit: Unit) {
  return `${size(p.length, unit)} × ${size(p.width, unit)}${p.thick ? ` × ${size(p.thick, unit)}` : ""}`;
}

function problem(bad: { length: boolean; width: boolean; thick: boolean; qty: boolean }) {
  const what = [bad.length && "length", bad.width && "width", bad.thick && "thickness"].filter(Boolean) as string[];
  if (what.length) return `Can't read the ${what.join(" or ")}`;
  return bad.qty ? "Qty must be 1 or more" : "";
}

function note(p: PartPlan, spec: BoardSpec | null, unit: Unit) {
  if (p.oversize) return "Bigger than the board — left out";
  const bt = spec?.thick;
  if (p.layers > 1 && bt && p.t) {
    const glued = p.layers * bt;
    return `Glue ${p.layers} layers: ${size(glued, unit)}${glued - p.t > 0.01 ? `, plane to ${size(p.t, unit)}` : ""}`;
  }
  if (p.thinner && bt && p.t) return `Board is ${size(bt, unit)}: plane to ${size(p.t, unit)}`;
  return "";
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
