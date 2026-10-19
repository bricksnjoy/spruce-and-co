import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseLength, parseLine, parseList, planCuts, size, type BoardSpec, type PartSize } from "@/lib/board-cuts";

const BOARD: BoardSpec = { length: 96, width: 48, thick: null, kerf: 0.125, turn: true };
const part = (p: Partial<PartSize> & Pick<PartSize, "length" | "width">): PartSize =>
  ({ id: "p", name: "Part", thick: null, qty: 1, ...p });

describe("reading a length", () => {
  it.each([
    ["2ft", 24], ["2 feet", 24], ["2'", 24], ["2in", 2], ["2 inch", 2], ["2inches", 2], ['2"', 2], ["2''", 2],
    ["2'6\"", 30], ["2'6", 30], ["2ft 6in", 30], ["2ft6in", 30], ["1 1/2in", 1.5], ["1-1/2\"", 1.5], ["3/4in", 0.75],
    ["25.4mm", 1], ["2.54cm", 1], ["8ft", 96], ["2’ 6”", 30], ["0.5ft", 6], [".5in", 0.5],
  ])("%s is %d in", (text, inches) => {
    expect(parseLength(text, "in")).toBeCloseTo(inches, 9);
  });

  it("reads a plain number in the chosen unit", () => {
    expect(parseLength("24", "in")).toBe(24);
    expect(parseLength("2", "ft")).toBe(24);
    expect(parseLength("600", "mm")).toBeCloseTo(23.622, 3);
    expect(parseLength("60", "cm")).toBeCloseTo(23.622, 3);
    expect(parseLength("3/4", "in")).toBe(0.75);
  });

  it.each(["", "abc", "2 6in", "2ft x", "0", "1/0", "2inc", "-2in", "2 2"])("cannot read %j", (text) => {
    expect(parseLength(text, "in")).toBeNull();
  });
});

describe("reading a part", () => {
  it("reads the way it was asked for: 2ftx2inchx2inch times 4, 2ftx2ft", () => {
    const { parts, bad } = parseList("2ftx2inchx2inch times 4, 2ftx2ft");
    expect(bad).toEqual([]);
    expect(parts).toEqual([
      { name: "", length: "2ft", width: "2inch", thick: "2inch", qty: 4 },
      { name: "", length: "2", width: "2", thick: "", qty: 1, unit: "ft" },
    ]);
  });

  it("a unit written once covers the sizes before it: 3 x 4 ft is a 3 by 4 ft top", () => {
    expect(parseLine("Table top 3x4 ft")).toEqual({ name: "Table top", length: "3", width: "4", thick: "", qty: 1, unit: "ft" });
    expect(parseLine("Shelf: 600 x 300 mm times 2")).toEqual({ name: "Shelf", length: "600", width: "300", thick: "", qty: 2, unit: "mm" });
    expect(parseLine("Top 3 x 4 ft x 18mm")).toEqual({ name: "Top", length: "3ft", width: "4 ft", thick: "18mm", qty: 1 });
    expect(parseLine("Leg 2ft x 2 x 2in")).toEqual({ name: "Leg", length: "2ft", width: "2in", thick: "2in", qty: 1 });
    // read the way the planner reads them: 3 ft by 4 ft, not 3 inches
    const p = parseLine("Table top 3x4 ft")!;
    expect([parseLength(p.length, p.unit!), parseLength(p.width, p.unit!)]).toEqual([36, 48]);
  });

  it.each([
    ["Leg: 2ft x 2in x 2in times 4", { name: "Leg", qty: 4 }],
    ["Leg 2ft x 2in x 2in x 4", { name: "Leg", qty: 4 }],
    ["Table leg - 2ft × 2in × 2in (4)", { name: "Table leg", qty: 4 }],
    ["leg 2ft by 2in by 2in 4 pcs", { name: "leg", qty: 4 }],
    ["Shelf 2: 3ft x 1ft qty 3", { name: "Shelf 2", qty: 3 }],
    ["Side 2ft x 18in 2 nos", { name: "Side", qty: 2 }],
    ["2ft*2in*2in @ 4", { name: "", qty: 4 }],
  ])("%s", (line, want) => {
    expect(parseLine(line)).toMatchObject(want);
  });

  it("sizes stay as typed, so a plain number follows the unit picked later", () => {
    expect(parseLine("24 x 2 x 2 x 4")).toEqual({ name: "", length: "24", width: "2", thick: "2", qty: 4 });
  });

  it("a plain number after sizes with units is how many; among plain sizes it is the thickness", () => {
    expect(parseLine("Door: 6ft 6in x 18in x 4")).toEqual({ name: "Door", length: "6ft 6in", width: "18in", thick: "", qty: 4 });
    expect(parseLine("78 x 18 x 4")).toEqual({ name: "", length: "78", width: "18", thick: "4", qty: 1 });
    expect(parseLine("6ft x 18 x 4")).toEqual({ name: "", length: "6ft", width: "18", thick: "4", qty: 1 });
    expect(parseLine("6ft x 18in x 4in")).toMatchObject({ thick: "4in", qty: 1 });
  });

  it("keeps what it cannot read", () => {
    const r = parseList("Top: 2ft x 2ft\nhello\n2ft\n2 x 2 x 2 x 2 x 2");
    expect(r.parts.map((p) => p.name)).toEqual(["Top"]);
    expect(r.bad).toEqual(["hello", "2ft", "2 x 2 x 2 x 2 x 2"]);
  });
});

describe("planning the cuts", () => {
  it("a table — four 2ft × 2in × 2in legs and a 2ft × 2ft top — comes out of one 8 × 4 board", () => {
    const plan = planCuts(
      [part({ id: "leg", name: "Leg", length: 24, width: 2, thick: 2, qty: 4 }), part({ id: "top", name: "Top", length: 24, width: 24 })],
      BOARD,
    );
    expect(plan.sheets).toHaveLength(1);
    expect(plan.sheets[0].placed).toHaveLength(5);
    expect(plan.parts.find((p) => p.id === "leg")).toMatchObject({ cutL: 24, cutW: 2, t: 2, layers: 1, pieces: 4 });
    expect(plan.usedArea).toBe(4 * 24 * 2 + 24 * 24);
    expect(plan.boardArea).toBe(96 * 48);
  });

  it("glues a part thicker than the board from layers", () => {
    const plan = planCuts([part({ length: 24, width: 2, thick: 2, qty: 4 })], { ...BOARD, thick: 0.75 });
    expect(plan.parts[0]).toMatchObject({ layers: 3, pieces: 12, thinner: false });
    expect(plan.sheets[0].placed).toHaveLength(12);
  });

  it("notes a part thinner than the board, and one with no thickness takes the board's", () => {
    const plan = planCuts([part({ length: 24, width: 12, thick: 0.5 }), part({ length: 24, width: 12 })], { ...BOARD, thick: 0.75 });
    expect(plan.parts.map((p) => [p.t, p.layers, p.thinner])).toEqual([[0.5, 1, true], [0.75, 1, false]]);
  });

  it("the smallest size is the thickness, whatever order it was typed in", () => {
    const [p] = planCuts([part({ length: 2, width: 2, thick: 24 })], BOARD).parts;
    expect([p.cutL, p.cutW, p.t]).toEqual([24, 2, 2]);
  });

  it("needs more boards when the parts do not fit on one", () => {
    // eight 4ft × 2ft panels fill two boards exactly, leaving no room for the saw
    const plan = planCuts([part({ length: 48, width: 24, qty: 8 })], { ...BOARD, kerf: 0 });
    expect(plan.sheets).toHaveLength(2);
    const tight = planCuts([part({ length: 48, width: 24, qty: 8 })], BOARD);
    expect(tight.sheets.length).toBeGreaterThan(2);
  });

  it("leaves out a part bigger than the board and says so", () => {
    const plan = planCuts([part({ id: "big", length: 100, width: 10 }), part({ id: "ok", length: 10, width: 10 })], BOARD);
    expect(plan.parts.map((p) => p.oversize)).toEqual([true, false]);
    expect(plan.sheets.flatMap((s) => s.placed.map((p) => p.code))).toEqual(["ok"]);
  });

  it("keeps the grain when told not to turn pieces", () => {
    // 46in long pieces only fit across a 48in board if turned; kept straight they run along it
    const plan = planCuts([part({ length: 46, width: 10, qty: 4 })], { ...BOARD, turn: false });
    expect(plan.sheets.flatMap((s) => s.placed).every((p) => !p.rotated && p.w === 46)).toBe(true);
  });

  it("every piece lands inside its board, with no two overlapping", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ l: fc.integer({ min: 1, max: 96 }), w: fc.integer({ min: 1, max: 48 }), q: fc.integer({ min: 1, max: 6 }) }), { minLength: 1, maxLength: 8 }),
        fc.boolean(),
        (list, turn) => {
          const parts = list.map((x, i) => part({ id: `p${i}`, length: x.l, width: x.w, qty: x.q }));
          const plan = planCuts(parts, { ...BOARD, turn });
          const want = plan.parts.filter((p) => !p.oversize).reduce((s, p) => s + p.pieces, 0);
          expect(plan.sheets.reduce((s, sh) => s + sh.placed.length, 0)).toBe(want);
          for (const sh of plan.sheets) {
            for (const p of sh.placed) {
              expect(p.x + p.w).toBeLessThanOrEqual(96 + 0.1);
              expect(p.y + p.h).toBeLessThanOrEqual(48 + 0.1);
            }
            for (let i = 0; i < sh.placed.length; i++) {
              for (let j = i + 1; j < sh.placed.length; j++) {
                const a = sh.placed[i];
                const b = sh.placed[j];
                const apart = a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9;
                expect(apart).toBe(true);
              }
            }
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("writing a size", () => {
  it.each([
    [24, "in", "24 in"], [0.75, "in", "0.75 in"], [30, "ft", "2' 6\""], [24, "ft", "2'"], [6, "ft", "6\""],
    [24, "mm", "610 mm"], [24, "cm", "61 cm"],
  ] as const)("%d in as %s is %s", (inches, unit, text) => {
    expect(size(inches, unit)).toBe(text);
  });
});
