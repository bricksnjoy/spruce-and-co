import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * §14 "no dead routes": every internal link in the code — hrefs, redirects,
 * router pushes, the menu — must match a page or route handler under src/app.
 */
const SRC = join(__dirname, "..", "..", "src");
const APP = join(SRC, "app");

function walk(dir: string, out: string[] = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

/** Each page/route as a regex over URL paths: (groups) vanish, [param] matches one segment, [...all] the rest. */
const routes = walk(APP).filter((f) => /[/\\](page|route)\.tsx?$/.test(f)).map((f) => {
  const segs = relative(APP, f).split(sep).slice(0, -1).filter((s) => !/^\(.*\)$/.test(s));
  const re = segs.map((s) => (/^\[\.\.\..+\]$/.test(s) ? ".+" : /^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|\\]/g, "\\$&"))).join("/");
  return { file: relative(SRC, f), re: new RegExp(`^/${re}/?$`) };
});

/** Internal paths written in the code, with template holes turned into one segment. */
function links() {
  const found: { path: string; where: string }[] = [];
  const pats = [
    /href=\{?["'`](\/[^"'`\s]*)["'`]/g,
    /href:\s*["'`](\/[^"'`\s]*)["'`]/g,
    /(?:redirect|push|replace)\(\s*["'`](\/[^"'`\s]*)["'`]/g,
    /\[\s*["'`](\/[a-z][^"'`\s]*)["'`]\s*,\s*["'][A-Z]/g, // [href, label] tab lists
  ];
  for (const f of walk(SRC).filter((x) => /\.tsx?$/.test(x))) {
    const text = readFileSync(f, "utf8");
    for (const re of pats) for (const m of text.matchAll(re)) {
      const raw = m[1].replace(/\$\{[^}]*\}/g, "X").split(/[?#]/)[0];
      if (!raw || raw.startsWith("//") || /\.(png|svg|ico|jpg|webp)$/.test(raw)) continue;
      found.push({ path: raw.replace(/\/$/, "") || "/", where: relative(SRC, f) });
    }
  }
  return found;
}

describe("no dead routes", () => {
  it("finds the app's routes, and would catch a dead one", () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.some((r) => r.re.test("/sales/X"))).toBe(true);
    expect(routes.some((r) => r.re.test("/sales/X/nowhere"))).toBe(false);
  });

  it("every internal link goes to a page or route that exists", () => {
    const all = links();
    expect(all.length).toBeGreaterThan(200);
    const dead = all.filter((l) => !routes.some((r) => r.re.test(l.path)));
    expect(dead.map((d) => `${d.path}  (${d.where})`)).toEqual([]);
  });
});
