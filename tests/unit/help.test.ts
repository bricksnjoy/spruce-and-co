import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { HELP, guideMarkdown, helpFor } from "@/lib/help";
import { NAV, OLD_SCREENS } from "@/lib/nav";

/** The guide covers every page on the menu, points only at real pages, and docs/USER_GUIDE.md matches it. */
const APP = join(__dirname, "..", "..", "src", "app");
const GUIDE = join(__dirname, "..", "..", "docs", "USER_GUIDE.md");
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); }
  return out;
};
const pages = walk(APP).filter((f) => /[/\\]page\.tsx$/.test(f))
  .map((f) => "/" + relative(APP, f).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s)).join("/"));

describe("user guide", () => {
  it("every page on the menu has a guide entry", () => {
    const missing = NAV.flatMap((g) => g.items).map((i) => i.href).filter((h) => !helpFor(h));
    expect(missing).toEqual([]);
  });

  it("every guide entry is a real page, and each page has one entry", () => {
    const norm = (p: string) => (p === "/" ? "/" : p.replace(/\/$/, "")).replace(/\[[^\]]+\]/g, "[id]");
    const real = new Set(pages.map((p) => norm(p === "/" ? "/" : p)));
    expect(HELP.map((h) => h.path).filter((p) => !real.has(norm(p)))).toEqual([]);
    expect(new Set(HELP.map((h) => h.path)).size).toBe(HELP.length);
  });

  it("old screens are off the menu", () => {
    const menu = new Set(NAV.flatMap((g) => g.items.map((i) => i.href)));
    expect(OLD_SCREENS.filter((o) => menu.has(o.href))).toEqual([]);
    expect(NAV.flatMap((g) => g.items).filter((i) => /\(old\)/.test(i.label))).toEqual([]);
  });

  it("docs/USER_GUIDE.md is the same guide (UPDATE_GUIDE=1 rewrites it)", () => {
    const md = guideMarkdown(OLD_SCREENS);
    if (process.env.UPDATE_GUIDE === "1" || !existsSync(GUIDE)) writeFileSync(GUIDE, md);
    expect(readFileSync(GUIDE, "utf8")).toBe(md);
  });
});
