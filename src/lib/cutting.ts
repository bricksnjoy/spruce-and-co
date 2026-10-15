/**
 * Lays the cut pieces out on whole sheets the way a carpenter would mark them
 * up. Every placement splits the space left over into two rectangles, so each
 * layout can be cut with straight, edge-to-edge (guillotine) cuts. Several
 * orders and rules are tried and the layout needing the fewest sheets wins.
 */

import type { Group, Material } from "@/lib/estimator";

/** Where a piece that runs along a wall sits on it, so drawings show its joints. */
export interface Span {
  run: number;
  e0: number;
  e1: number;
  /** tiles: the row's bottom and top, above the worktop */
  y0?: number;
  y1?: number;
  /** a worktop in more than one strip: how far out from the back this one reaches */
  d0?: number;
  d1?: number;
}

export interface Piece {
  /** which cabinet or run it belongs to — BA3, TB */
  code: string;
  part: string;
  label: string;
  material_id: string;
  group: Group;
  w: number;
  h: number;
  /** may be turned 90° — not marble or tiles, whose pattern runs along the wall */
  rotate: boolean;
  span?: Span;
}

/** What the packer needs of a piece; the estimator's pieces carry more. */
export type Cut = Pick<Piece, "code" | "label" | "w" | "h" | "rotate">;

export interface Placed {
  label: string;
  code: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** turned 90° to fit */
  rotated: boolean;
}

export interface Sheet {
  placed: Placed[];
  /** share of the sheet covered by pieces, 0–1 */
  used: number;
}

export interface BoardLayout {
  material_id: string;
  name: string;
  sheet_w: number;
  sheet_h: number;
  sheets: Sheet[];
  /** pieces bigger than the sheet either way round */
  oversize: Piece[];
}

interface Free {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Fit = "short" | "long" | "area";
type Split = "shorter-axis" | "longer-axis" | "shorter-leftover" | "longer-leftover";

const SORTS: ((a: Cut, b: Cut) => number)[] = [
  (a, b) => b.w * b.h - a.w * a.h,
  (a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h,
  (a, b) => b.h - a.h || b.w - a.w,
  (a, b) => b.w - a.w || b.h - a.h,
  (a, b) => b.w + b.h - (a.w + a.h),
];
const FITS: Fit[] = ["short", "long", "area"];
/** a piece this much over the sheet still comes out of it (see SHEET_TOLERANCE_IN) */
const TOL = 0.1;
const SPLITS: Split[] = ["shorter-axis", "longer-axis", "shorter-leftover", "longer-leftover"];

function packOnce<P extends Cut>(order: P[], W: number, H: number, kerf: number, fit: Fit, split: Split) {
  const sheets: { placed: Placed[]; free: Free[] }[] = [];
  const oversize: P[] = [];

  for (const p of order) {
    const straight = p.w <= W + TOL && p.h <= H + TOL;
    const turned = p.rotate && p.h <= W + TOL && p.w <= H + TOL;
    if (!straight && !turned) {
      oversize.push(p);
      continue;
    }
    let best: { s: number; f: number; w: number; h: number; rotated: boolean; score: number; tie: number } | null = null;
    for (let s = 0; s < sheets.length; s++) {
      sheets[s].free.forEach((fr, f) => {
        for (const rotated of p.rotate ? [false, true] : [false]) {
          const w = rotated ? p.h : p.w;
          const h = rotated ? p.w : p.h;
          if (w > fr.w + TOL || h > fr.h + TOL) continue;
          const dw = fr.w - w;
          const dh = fr.h - h;
          const score = fit === "short" ? Math.min(dw, dh) : fit === "long" ? Math.max(dw, dh) : fr.w * fr.h - w * h;
          const tie = fit === "area" ? Math.min(dw, dh) : fr.w * fr.h;
          if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && tie < best.tie)) {
            best = { s, f, w, h, rotated, score, tie };
          }
        }
      });
    }
    if (!best) {
      sheets.push({ placed: [], free: [{ x: 0, y: 0, w: W, h: H }] });
      const rotated = !straight;
      best = { s: sheets.length - 1, f: 0, w: rotated ? p.h : p.w, h: rotated ? p.w : p.h, rotated, score: 0, tie: 0 };
    }
    const b = best as { s: number; f: number; w: number; h: number; rotated: boolean };
    const sheet = sheets[b.s];
    const fr = sheet.free[b.f];
    sheet.placed.push({ label: p.label, code: p.code, x: fr.x, y: fr.y, w: b.w, h: b.h, rotated: b.rotated });

    // one straight cut right across the free space, then one along the piece
    const dw = fr.w - b.w;
    const dh = fr.h - b.h;
    const across =
      split === "shorter-axis" ? fr.w < fr.h :
      split === "longer-axis" ? fr.w >= fr.h :
      split === "shorter-leftover" ? dw < dh :
      dw >= dh;
    const right: Free = { x: fr.x + b.w + kerf, y: fr.y, w: dw - kerf, h: across ? b.h : fr.h };
    const below: Free = { x: fr.x, y: fr.y + b.h + kerf, w: across ? fr.w : b.w, h: dh - kerf };
    sheet.free.splice(b.f, 1, ...[right, below].filter((r) => r.w > 0.5 && r.h > 0.5));
  }

  return {
    sheets: sheets.map((s) => ({
      placed: s.placed,
      used: s.placed.reduce((a, p) => a + p.w * p.h, 0) / (W * H),
    })),
    oversize,
  };
}

/** Pack one sheet type's pieces onto as few sheets as the rules allow. */
export function packPieces<P extends Cut>(pieces: P[], W: number, H: number, kerf: number) {
  let best: ReturnType<typeof packOnce<P>> | null = null;
  for (const sort of SORTS) {
    const order = [...pieces].sort(sort);
    for (const fit of FITS) {
      for (const split of SPLITS) {
        const r = packOnce(order, W, H, kerf, fit, split);
        if (
          !best ||
          r.sheets.length < best.sheets.length ||
          // same count: keep the one that leaves one big offcut on the last sheet
          (r.sheets.length === best.sheets.length && (r.sheets.at(-1)?.used ?? 0) < (best.sheets.at(-1)?.used ?? 0))
        ) {
          best = r;
        }
      }
    }
  }
  return best ?? { sheets: [], oversize: [] };
}

/** A cutting layout for every sheet material the pieces are cut from. */
export function cuttingLayouts(pieces: Piece[], materials: Material[], kerf: number): BoardLayout[] {
  const byMaterial = new Map<string, Piece[]>();
  for (const p of pieces) {
    const list = byMaterial.get(p.material_id) ?? [];
    list.push(p);
    byMaterial.set(p.material_id, list);
  }
  const layouts: BoardLayout[] = [];
  for (const [id, list] of byMaterial) {
    const m = materials.find((x) => x.id === id);
    if (!m || m.kind !== "board") continue;
    // lay the sheet long side across
    const a = (Number(m.length_ft) || 0) * 12;
    const b = (Number(m.width_ft) || 0) * 12;
    const W = Math.max(a, b);
    const H = Math.min(a, b);
    if (!W || !H) continue;
    const { sheets, oversize } = packPieces(list, W, H, kerf);
    layouts.push({ material_id: id, name: m.name, sheet_w: W, sheet_h: H, sheets, oversize });
  }
  return layouts.sort((x, y) => x.name.localeCompare(y.name));
}
