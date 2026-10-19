"use client";

import { useState } from "react";

export type Point = { label: string; start: string; closing: number; cashIn: number; cashOut: number };

const W = 720, H = 220, PAD_L = 64, PAD_R = 16, PAD_T = 16, PAD_B = 28;
const fmt = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** A clean step for about 4 gridlines. */
function niceStep(range: number) {
  const raw = range / 4 || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
}

/** Projected cash at the end of each week: one series, one axis, a hover tooltip per week. */
export function ForecastChart({ points, start }: { points: Point[]; start: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const vals = [start, ...points.map((p) => p.closing)];
  const step = niceStep(Math.max(...vals, 0) - Math.min(...vals, 0));
  const lo = Math.min(0, Math.floor(Math.min(...vals) / step) * step);
  const hi = Math.max(step, Math.ceil(Math.max(...vals) / step) * step);
  const x = (i: number) => PAD_L + (i * (W - PAD_L - PAD_R)) / Math.max(points.length - 1, 1);
  const y = (v: number) => PAD_T + ((hi - v) * (H - PAD_T - PAD_B)) / (hi - lo || 1);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.closing).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} L${x(0).toFixed(1)},${y(Math.max(lo, 0)).toFixed(1)} Z`;
  const h = hover === null ? null : points[hover];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected cash at the end of each of the next 12 weeks" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={t === 0 ? 1.5 : 1} />
            <text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{compact(t)}</text>
          </g>
        ))}
        {points.map((p, i) => (i % 2 === 0 || i === points.length - 1) && (
          <text key={p.start} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.label}</text>
        ))}
        <path d={area} fill="var(--brand)" opacity={0.1} />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} stroke="var(--muted)" strokeWidth={1} />}
        {points.map((p, i) => (
          <g key={p.start}>
            <circle cx={x(i)} cy={y(p.closing)} r={hover === i ? 5 : 4} fill="var(--brand)" stroke="var(--surface)" strokeWidth={2} />
            <rect x={x(i) - (W - PAD_L - PAD_R) / points.length / 2} y={PAD_T} width={(W - PAD_L - PAD_R) / points.length} height={H - PAD_T - PAD_B}
              fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`Week of ${p.label}: ${fmt(p.closing)}`} />
          </g>
        ))}
        <text x={x(points.length - 1)} y={y(points[points.length - 1].closing) - 10} textAnchor="end" fontSize="11" fill="var(--text)" fontWeight={600}>
          {fmt(points[points.length - 1].closing)}
        </text>
      </svg>
      {h && hover !== null && (
        <div className="pointer-events-none absolute top-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-xs shadow-sm"
          style={{ left: `${Math.min(Math.max((x(hover) / W) * 100, 12), 70)}%` }}>
          <p className="font-semibold">Week of {h.label}</p>
          <p className="tabular-nums">In {fmt(h.cashIn)} · Out {fmt(h.cashOut)}</p>
          <p className="tabular-nums">Cash at week end <strong>{fmt(h.closing)}</strong></p>
        </div>
      )}
    </div>
  );
}
