/**
 * The board cut planner: the parts of a piece of furniture, typed the way a
 * carpenter says them ("2ft x 2in x 2in times 4"), laid out on whole boards
 * (an 8 × 4 ft sheet unless told otherwise). The packing is the cabinet
 * estimator's (lib/cutting), so both cut a board the same way.
 */

import { packPieces, type Sheet } from "@/lib/cutting";

/** What a plain number means, and the unit sizes are shown in. */
export type Unit = "in" | "ft" | "mm" | "cm";

export const UNITS: [Unit, string][] = [
  ["in", "inches"],
  ["ft", "feet"],
  ["mm", "mm"],
  ["cm", "cm"],
];

/** inches in one of each */
const PER: Record<string, number> = {
  in: 1, inch: 1, inches: 1, '"': 1,
  ft: 12, foot: 12, feet: 12, "'": 12,
  mm: 1 / 25.4, cm: 10 / 25.4, m: 1000 / 25.4,
};

/** 2, 2.5, .5, 3/4, and 1 1/2 or 1-1/2; then a unit, if there is one (longest spelling first) */
const TERM = /\s*(\d+[ -]+\d+\/\d+|\d+\/\d+|\d*\.?\d+)\s*(feet|foot|ft|inches|inch|in|mm|cm|m|'|")?/y;

function num(t: string) {
  const mixed = t.match(/^(\d+)[ -]+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

/**
 * A length as typed — 2ft, 2in, 24", 2'6", 2ft 6in, 1 1/2in, 3/4, 18mm, 1.2m —
 * in inches. A plain number is in `unit`, except straight after feet, where it
 * is inches (2'6 is 2 ft 6 in). Null when it cannot be read.
 */
export function parseLength(text: string, unit: Unit): number | null {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[′’‘`]/g, "'")
    .replace(/[″”“]/g, '"')
    .replace(/''/g, '"');
  if (!s) return null;
  let total = 0;
  let pos = 0;
  let prev = "";
  while (pos < s.length) {
    TERM.lastIndex = pos;
    const m = TERM.exec(s);
    if (!m) return null;
    pos = TERM.lastIndex;
    let u = m[2];
    if (!u) {
      // a bare number only ends a length: "2 6in" is a typo, not 2 plus 6
      if (pos < s.length) return null;
      u = PER[prev] === 12 ? "in" : unit;
    }
    total += num(m[1]) * PER[u];
    prev = u;
  }
  return Number.isFinite(total) && total > 0 ? total : null;
}

/** One part as typed in the quick box, sizes still as text. */
export interface PartText {
  name: string;
  length: string;
  width: string;
  /** blank: as thick as the board */
  thick: string;
  qty: number;
  /** when every size is in one unit (3 x 4 ft): the sizes are plain numbers in it */
  unit?: Unit;
}

/** how many, written after the sizes: "times 4", "x 4 pcs", "4 nos", "(4)", "qty 4" */
const QTY_AFTER = [
  /\s*(?:x\s*)?(\d+)\s*(?:times|pcs?\.?|pieces?|nos?\.?|off)\s*$/,
  /\s*(?:times|qty|pcs?\.?|pieces?|nos?\.?|@|=)\s*:?\s*(\d+)\s*$/,
  /\s*\(\s*(\d+)\s*\)\s*$/,
];

/**
 * One part from a line: an optional name ("Leg:" or just "Leg"), two or three
 * sizes split by x, × or "by", and an optional count. Null when it is not a part.
 * Read the preview before trusting it: "24 x 18 x 4" is a 4in-thick part, while
 * "2ft x 18in x 4" is four parts.
 */
export function parseLine(line: string): PartText | null {
  const t = line.trim();
  if (!t) return null;
  let name = "";
  let rest = t;
  const colon = t.match(/^([^:]*[a-z][^:]*):(.*)$/i);
  if (colon) {
    name = colon[1];
    rest = colon[2];
  } else {
    const lead = t.match(/^(.*?)[\s–—-]*((?:\d|\.\d).*)$/);
    if (!lead) return null;
    name = lead[1];
    rest = lead[2];
  }
  rest = rest.toLowerCase().replace(/[×*]/g, "x").replace(/\bby\b/g, "x").trim();

  let qty = 1;
  for (const re of QTY_AFTER) {
    const m = rest.match(re);
    if (m) {
      qty = Number(m[1]);
      rest = rest.slice(0, m.index).trim();
      break;
    }
  }
  const dims = rest.split(/\s*x\s*/).map((d) => d.trim()).filter(Boolean);
  // a plain number after the sizes is the count: 2ft x 2in x 2in x 4, and
  // 6ft x 18in x 4, where sizes written with units would have one on a thickness too
  const plain = (d: string) => /^\d+$/.test(d);
  if (qty === 1 && dims.length === 4 && plain(dims[3])) qty = Number(dims.pop());
  else if (qty === 1 && dims.length === 3 && plain(dims[2]) && !plain(dims[0]) && !plain(dims[1])) qty = Number(dims.pop());
  if (dims.length < 2 || dims.length > 3 || !Number.isInteger(qty) || qty < 1) return null;
  const { sizes, unit } = shareUnit(dims);
  return { name: name.trim().replace(/[\s:–—-]+$/, ""), length: sizes[0], width: sizes[1], thick: sizes[2] ?? "", qty, ...(unit ? { unit } : {}) };
}

const NUMBER = String.raw`(\d+[ -]+\d+\/\d+|\d+\/\d+|\d*\.?\d+)`;
const PLAIN = new RegExp(`^${NUMBER}$`);
const ONE_UNIT = new RegExp(`^${NUMBER}\\s*(feet|foot|ft|inches|inch|in|mm|cm|m|'|")$`);
const AS_UNIT: Record<string, Unit> = { feet: "ft", foot: "ft", ft: "ft", "'": "ft", inches: "in", inch: "in", in: "in", '"': "in", mm: "mm", cm: "cm" };

/**
 * A unit written once covers the sizes before it, as people say it: "3 x 4 ft"
 * is 3 ft by 4 ft, and "3 x 4 ft x 18mm" a 3 by 4 ft top, 18mm thick. When
 * every size ends up in one unit, they come back as plain numbers in it.
 */
function shareUnit(dims: string[]): { sizes: string[]; unit?: Unit } {
  const sizes = [...dims];
  for (let i = sizes.length - 2; i >= 0; i--) {
    const next = sizes[i + 1].match(ONE_UNIT);
    if (PLAIN.test(sizes[i]) && next) sizes[i] = `${sizes[i]}${next[2]}`;
  }
  const units = sizes.map((d) => d.match(ONE_UNIT));
  const unit = units[0] ? AS_UNIT[units[0][2]] : undefined;
  if (!unit || units.some((m) => !m || AS_UNIT[m[2]] !== unit)) return { sizes };
  return { sizes: units.map((m) => m![1]), unit };
}

/** Several parts at once, one per line or split by commas or semicolons. */
export function parseList(text: string): { parts: PartText[]; bad: string[] } {
  const parts: PartText[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[\n;,]+/)) {
    const line = raw.trim();
    if (!line) continue;
    const p = parseLine(line);
    if (p) parts.push(p);
    else bad.push(line);
  }
  return { parts, bad };
}

/** A part with its sizes read, in inches. */
export interface PartSize {
  id: string;
  name: string;
  length: number;
  width: number;
  /** null: not given, so as thick as the board */
  thick: number | null;
  qty: number;
}

export interface BoardSpec {
  /** inches; the longer side is laid across, and the grain runs along it */
  length: number;
  width: number;
  /** null: not given, so every part is cut once whatever its thickness */
  thick: number | null;
  /** width of the saw cut */
  kerf: number;
  /** pieces may be turned 90° to fit; off keeps every part's length along the grain */
  turn: boolean;
}

export interface PartPlan extends PartSize {
  /** the face cut from the board: its longer side, along the grain, then across */
  cutL: number;
  cutW: number;
  /** the part's thickness, the board's when none was given */
  t: number | null;
  /** thicker than the board: this many layers are cut and glued */
  layers: number;
  /** qty × layers */
  pieces: number;
  /** thinner than the board, so it needs planing down */
  thinner: boolean;
  /** bigger than the board either way round */
  oversize: boolean;
}

export interface CutPlan {
  /** the board as laid out: its long side across */
  sheetW: number;
  sheetH: number;
  parts: PartPlan[];
  sheets: Sheet[];
  /** square inches of parts on the boards, and of the boards themselves */
  usedArea: number;
  boardArea: number;
}

/** More than this and the planner would freeze the page while it tries every order. */
export const MAX_PIECES = 1000;

const EPS = 1e-6;

/** How each part comes out of the board: its face, its layers, how many pieces. */
export function planParts(parts: PartSize[], board: BoardSpec): PartPlan[] {
  const sheetW = Math.max(board.length, board.width);
  const sheetH = Math.min(board.length, board.width);
  return parts.map((p) => {
    let face = [p.length, p.width];
    let t = p.thick ?? board.thick;
    if (p.thick != null) {
      // the smallest size is the thickness, the other two the face
      const dims = [p.length, p.width, p.thick];
      let i = 2;
      if (dims[1] < dims[i]) i = 1;
      if (dims[0] < dims[i]) i = 0;
      t = dims[i];
      face = dims.filter((_, j) => j !== i);
    }
    // the grain runs along the part's longer side
    const cutL = Math.max(face[0], face[1]);
    const cutW = Math.min(face[0], face[1]);
    const layers = board.thick && t && t > board.thick + EPS ? Math.ceil(t / board.thick - EPS) : 1;
    const thinner = Boolean(board.thick && t && t < board.thick - EPS);
    const fits =
      (cutL <= sheetW + EPS && cutW <= sheetH + EPS) || (board.turn && cutW <= sheetW + EPS && cutL <= sheetH + EPS);
    return { ...p, cutL, cutW, t, layers, pieces: p.qty * layers, thinner, oversize: !fits };
  });
}

/** The pieces to cut, and the fewest boards they fit on. */
export function planCuts(parts: PartSize[], board: BoardSpec): CutPlan {
  const sheetW = Math.max(board.length, board.width);
  const sheetH = Math.min(board.length, board.width);
  const plans = planParts(parts, board);
  const pieces = plans.flatMap((p) =>
    Array.from({ length: p.oversize ? 0 : p.pieces }, () => ({
      code: p.id,
      label: p.name,
      w: p.cutL,
      h: p.cutW,
      rotate: board.turn,
    })),
  );
  const { sheets } = packPieces(pieces, sheetW, sheetH, board.kerf);
  const usedArea = sheets.reduce((s, sh) => s + sh.placed.reduce((a, p) => a + p.w * p.h, 0), 0);
  return { sheetW, sheetH, parts: plans, sheets, usedArea, boardArea: sheets.length * sheetW * sheetH };
}

const trim = (n: number, digits: number) => Number(n.toFixed(digits)).toString();

/** A size in inches, written in `unit`: 24 in, 2' 6", 600 mm, 60 cm. */
export function size(inches: number, unit: Unit): string {
  if (unit === "mm") return `${Math.round(inches * 25.4)} mm`;
  if (unit === "cm") return `${trim(inches * 2.54, 1)} cm`;
  if (unit === "ft") {
    const ft = Math.floor(inches / 12 + EPS);
    const rest = Number((inches - ft * 12).toFixed(2));
    if (!ft) return `${trim(rest, 2)}"`;
    return rest >= 0.005 ? `${ft}' ${trim(rest, 2)}"` : `${ft}'`;
  }
  return `${trim(inches, 2)} in`;
}

/** The same, without the unit: for drawings that say their unit once. */
export function bare(inches: number, unit: Unit): string {
  if (unit === "mm") return String(Math.round(inches * 25.4));
  if (unit === "cm") return trim(inches * 2.54, 1);
  if (unit === "ft") return size(inches, "ft");
  return trim(inches, 2);
}
