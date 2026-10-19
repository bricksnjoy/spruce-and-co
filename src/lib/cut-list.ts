/**
 * The board cut planner's list as it is saved: in the database for each person
 * (so it is on every device), with a copy in the browser. Shared by the page
 * and the server, which checks a list before saving it.
 */
import { UNITS, type Unit } from "./board-cuts";

export interface Row {
  id: string;
  name: string;
  length: string;
  width: string;
  thick: string;
  /** what a plain number in this part's sizes means */
  unit: Unit;
  qty: string;
}

export interface BoardText {
  length: string;
  width: string;
  thick: string;
  kerf: string;
  price: string;
  turn: boolean;
}

export interface Saved {
  unit: Unit;
  rows: Row[];
  board: BoardText;
}

export const START: Saved = {
  unit: "in",
  rows: [
    { id: "leg", name: "Table leg", length: "2ft", width: "2", thick: "2", unit: "in", qty: "4" },
    { id: "top", name: "Table top", length: "2", width: "2", thick: "", unit: "ft", qty: "1" },
  ],
  board: { length: "8ft", width: "4ft", thick: "", kerf: "1/8in", price: "", turn: true },
};

/** more parts than anyone lists for one job; keeps a saved list small */
export const MAX_ROWS = 500;

const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : null);

/**
 * A saved list read back, with its fields in one fixed order (the database
 * reorders them), or null if it is not a list. Missing board settings take
 * the usual ones.
 */
export function readSaved(v: unknown): Saved | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  if (!UNITS.some(([u]) => u === s.unit) || !Array.isArray(s.rows) || s.rows.length > MAX_ROWS) return null;
  const rows: Row[] = [];
  for (const r of s.rows as unknown[]) {
    if (typeof r !== "object" || r === null) return null;
    const x = r as Record<string, unknown>;
    const [id, name, length, width, thick, qty] = [x.id, x.name, x.length, x.width, x.thick, x.qty].map(str);
    if ([id, name, length, width, thick, qty].some((f) => f === null)) return null;
    // lists saved before each part had its own unit take the list's
    const unit = UNITS.some(([u]) => u === x.unit) ? (x.unit as Unit) : (s.unit as Unit);
    rows.push({ id: id!, name: name!, length: length!, width: width!, thick: thick!, unit, qty: qty! });
  }
  const b = (typeof s.board === "object" && s.board !== null ? s.board : {}) as Record<string, unknown>;
  const text = (k: keyof Omit<BoardText, "turn">) => str(b[k]) ?? START.board[k];
  return {
    unit: s.unit as Unit,
    rows,
    board: {
      length: text("length"), width: text("width"), thick: text("thick"), kerf: text("kerf"), price: text("price"),
      turn: typeof b.turn === "boolean" ? b.turn : START.board.turn,
    },
  };
}

/** A list as text, always in the same order, so two copies can be compared. */
export const pack = (s: Saved) => JSON.stringify(readSaved(s));
