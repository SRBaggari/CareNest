"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

/** `when` is the formatted date and `label` the formatted reading (both prepared on the server). */
export type ChartPoint = { at: number; values: (number | null)[]; label: string; when: string };

type Props = {
  /** Sorted oldest first. `values[i]` belongs to `series[i]`. */
  points: ChartPoint[];
  series: { name: string }[];
  /** Accessible summary, e.g. "Blood pressure over the last 30 days". */
  title: string;
  labels: { showTable: string; date: string };
};

// The chart is laid out at its real pixel width (not scaled), so its text stays readable on phones.
const H = 220;
const FONT = 14;
const PAD = { top: 16, right: 64, bottom: 28, left: 44 };
const COLORS = ["var(--series-1)", "var(--series-2)"];

/** Rounded, evenly spaced axis values covering [min, max]. */
function niceTicks(min: number, max: number, count = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return ticks;
}

/**
 * A small line chart for readings over time: 2px lines, ringed markers, hairline grid, a crosshair
 * and tooltip on hover or arrow keys, a legend and end labels for two series, and a table view.
 */
export function LineChart({ points, series, title, labels }: Props) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const all = points.flatMap((p) => p.values.filter((v): v is number => v !== null));
    const ticks = niceTicks(Math.min(...all), Math.max(...all));
    const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
    const t0 = points[0]?.at ?? 0;
    const t1 = points[points.length - 1]?.at ?? 1;
    const x = (at: number) => (t1 === t0 ? (PAD.left + W - PAD.right) / 2 : PAD.left + ((at - t0) / (t1 - t0)) * (W - PAD.left - PAD.right));
    const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.top - PAD.bottom);
    return { ticks, x, y };
  }, [points, W]);

  if (points.length === 0) return null;
  const { ticks, x, y } = geometry;
  const last = points[points.length - 1];

  function nearest(clientX: number, svg: SVGSVGElement) {
    const box = svg.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * W;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].at) - px) < Math.abs(x(points[best].at) - px)) best = i;
    return best;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((i) => Math.min(points.length - 1, Math.max(0, (i ?? (step > 0 ? -1 : points.length)) + step)));
    } else if (e.key === "Escape") setActive(null);
  }

  const shown = active === null ? null : points[active];
  const tipLeft = shown ? Math.min(Math.max((x(shown.at) / W) * 100, 12), 88) : 0;

  return (
    <figure className="flex flex-col gap-2">
      {series.length > 1 && (
        <ul aria-hidden="true" className="flex flex-wrap gap-x-5 gap-y-1 text-base text-muted">
          {series.map((s, i) => (
            <li key={s.name} className="inline-flex items-center gap-2">
              <span className="inline-block h-0.5 w-5 rounded-full" style={{ background: COLORS[i] }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div ref={box} className="relative">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block max-w-full touch-pan-y overflow-visible rounded-lg focus-visible:outline-offset-4"
          role="img"
          aria-label={title}
          aria-describedby={`${id}-table`}
          tabIndex={0}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
          onPointerLeave={() => setActive(null)}
          onKeyDown={onKey}
          onBlur={() => setActive(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.35em" textAnchor="end" fontSize={FONT} fill="var(--muted)">
                {t}
              </text>
            </g>
          ))}
          {[points[0], ...(points.length > 1 ? [last] : [])].map((p, i) => (
            <text key={i} x={x(p.at)} y={H - 6} textAnchor={i === 0 ? "start" : "end"} fontSize={FONT} fill="var(--muted)">
              {p.when}
            </text>
          ))}
          {shown && <line x1={x(shown.at)} x2={x(shown.at)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--muted)" strokeWidth={1} />}
          {series.map((s, si) => {
            const pts = points.filter((p) => p.values[si] !== null);
            return (
              <g key={s.name}>
                <polyline
                  points={pts.map((p) => `${x(p.at)},${y(p.values[si]!)}`).join(" ")}
                  fill="none"
                  stroke={COLORS[si]}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {pts.map((p) => (
                  <circle key={p.at} cx={x(p.at)} cy={y(p.values[si]!)} r={shown === p ? 6 : 4} fill={COLORS[si]} stroke="var(--surface)" strokeWidth={2} />
                ))}
                {series.length > 1 && last.values[si] !== null && (
                  <text x={x(last.at) + 10} y={y(last.values[si]!)} dy="0.35em" fontSize={FONT} fill="var(--foreground)">
                    {s.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {shown && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-border bg-surface px-3 py-1.5 text-base shadow-card"
            style={{ left: `${tipLeft}%` }}
          >
            <span className="block text-muted">{shown.when}</span>
            <span className="font-bold">{shown.label}</span>
          </div>
        )}
      </div>
      <details className="text-base print:hidden">
        <summary className="inline-flex min-h-12 cursor-pointer items-center font-semibold text-primary">{labels.showTable}</summary>
        <table id={`${id}-table`} className="mt-2 w-full border-collapse text-left">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="py-1 pr-4">
                {labels.date}
              </th>
              <th scope="col" className="py-1">
                {series.map((s) => s.name).join(" / ")}
              </th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.at} className="border-b border-border">
                <td className="py-1 pr-4">{p.when}</td>
                <td className="py-1">{p.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
