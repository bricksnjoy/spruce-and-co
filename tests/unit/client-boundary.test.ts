import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

/**
 * A server file that imports a plain value (a table, a helper function) from a
 * "use client" module gets a client reference, not the value — it crashes only
 * in the production build (this broke New invoice and New bill). Components
 * (Capitalised) and types are fine to import.
 */
const SRC = join(__dirname, "..", "..", "src");
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p, out); else if (/\.tsx?$/.test(p)) out.push(p); }
  return out;
};
const isClient = (s: string) => /^\s*["']use client["']/.test(s);
const resolve = (spec: string, from: string) => {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? normalize(join(dirname(from), spec)) : null;
  if (!base) return null;
  return [".tsx", ".ts", "/index.tsx", "/index.ts"].map((e) => base + e).find((p) => existsSync(p)) ?? null;
};

describe("server code never takes plain values from client modules", () => {
  it("imports from 'use client' files on the server are components or types only", () => {
    const files = walk(SRC);
    const exported = new Map<string, Set<string>>();
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      if (isClient(s)) exported.set(f, new Set([...s.matchAll(/export\s+(?:const|let|function|class)\s+([A-Za-z_]\w*)/g)].map((m) => m[1])));
    }
    const bad: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      if (isClient(s)) continue;
      for (const m of s.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
        const target = resolve(m[2], f);
        const names = target ? exported.get(target) : undefined;
        if (!names) continue;
        for (const part of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
          if (part.startsWith("type ")) continue;
          const n = part.split(/\s+as\s+/)[0];
          if (names.has(n) && !/^[A-Z][a-z]/.test(n)) bad.push(`${relative(SRC, f)} imports ${n} from ${relative(SRC, target!)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
