"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type Series = {
  label: string;
  values: (number | null)[];
  color: string;
  dashed?: boolean;
};

type Props = {
  ts: string[];
  series: Series[];
  bands?: { start: string; end: string; kind: string }[];
  height?: number;
  unit: (v: number) => string;
  onBandClick?: (index: number) => void;
  activeBand?: number | null;
};

const PAD = { top: 12, right: 12, bottom: 24, left: 60 };
const BAND_FILL: Record<string, string> = {
  price: "rgba(200,118,58,0.14)",
  dr: "rgba(60,56,51,0.12)",
  emergency: "rgba(122,46,18,0.16)",
};

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** Single-axis line chart with event bands, crosshair and tooltip. */
export function LineChart({ ts, series, bands = [], height = 240, unit, onBandClick, activeBand }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const t = useMemo(() => ts.map((s) => new Date(s).getTime()), [ts]);
  const t0 = t[0] ?? 0;
  const t1 = t[t.length - 1] ?? 1;
  const yMax = useMemo(() => {
    let m = 0;
    for (const s of series) for (const v of s.values) if (v != null && v > m) m = v;
    return m * 1.08 || 1;
  }, [series]);
  const ticks = niceTicks(yMax);
  const top = Math.max(yMax, ticks[ticks.length - 1]);
  const iw = width - PAD.left - PAD.right;
  const ih = height - PAD.top - PAD.bottom;
  const x = (ms: number) => PAD.left + ((ms - t0) / Math.max(1, t1 - t0)) * iw;
  const y = (v: number) => PAD.top + ih - (v / top) * ih;

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(t[i]).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  const xTicks = useMemo(() => {
    const n = Math.max(2, Math.floor(iw / 110));
    return Array.from({ length: n }, (_, i) => t0 + ((t1 - t0) * i) / (n - 1));
  }, [iw, t0, t1]);
  const spanDays = (t1 - t0) / 86400000;
  const xFmt = (ms: number) =>
    new Date(ms).toLocaleString(undefined, spanDays > 2 ? { month: "short", day: "numeric" } : { hour: "2-digit", minute: "2-digit" });

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = (e.target as SVGRectElement).getBoundingClientRect();
    const ms = t0 + ((e.clientX - rect.left) / rect.width) * (t1 - t0);
    let lo = 0;
    let hi = t.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (t[mid] < ms) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && ms - t[lo - 1] < t[lo] - ms) lo -= 1;
    setHover(lo);
  }

  const hx = hover != null ? x(t[hover]) : 0;
  const tipLeft = hover != null && hx > width - 200;

  return (
    <div ref={ref} className="relative w-full select-none">
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-gray-600">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden>
              <line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? "4 3" : undefined} />
            </svg>
            {s.label}
          </span>
        ))}
        {bands.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-3.5 rounded-sm" style={{ background: BAND_FILL.price }} /> price event
            <span className="ml-2 inline-block h-2.5 w-3.5 rounded-sm" style={{ background: BAND_FILL.dr }} /> DR / emergency
          </span>
        )}
      </div>
      <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(" vs ")}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="#ece9e2" />
            <text x={PAD.left - 8} y={y(v)} dy="0.32em" textAnchor="end" className="fill-gray-500 text-[10px]">
              {unit(v)}
            </text>
          </g>
        ))}
        {xTicks.map((ms) => (
          <text key={ms} x={x(ms)} y={height - 6} textAnchor="middle" className="fill-gray-500 text-[10px]">
            {xFmt(ms)}
          </text>
        ))}
        {bands.map((b, i) => {
          const bx = x(new Date(b.start).getTime());
          const bw = Math.max(2, x(new Date(b.end).getTime()) - bx);
          return (
            <rect
              key={i}
              x={bx}
              y={PAD.top}
              width={bw}
              height={ih}
              fill={BAND_FILL[b.kind] ?? BAND_FILL.price}
              stroke={activeBand === i ? "#c8763a" : "none"}
              strokeWidth={activeBand === i ? 1.5 : 0}
            />
          );
        })}
        {paths.map((d, i) => (
          <path
            key={series[i].label}
            d={d}
            fill="none"
            stroke={series[i].color}
            strokeWidth={2}
            strokeDasharray={series[i].dashed ? "4 3" : undefined}
            strokeLinejoin="round"
          />
        ))}
        {hover != null && (
          <g pointerEvents="none">
            <line x1={hx} x2={hx} y1={PAD.top} y2={PAD.top + ih} stroke="#9c9585" strokeDasharray="2 2" />
            {series.map((s) =>
              s.values[hover] != null ? (
                <circle key={s.label} cx={hx} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />
              ) : null,
            )}
          </g>
        )}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onClick={() => {
            if (!onBandClick || hover == null) return;
            const ms = t[hover];
            const i = bands.findIndex((b) => new Date(b.start).getTime() <= ms && ms < new Date(b.end).getTime() + 3600000);
            if (i >= 0) onBandClick(i);
          }}
          style={{ cursor: onBandClick ? "pointer" : "crosshair" }}
        />
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute top-8 z-10 rounded-lg border border-ink/10 bg-white px-3 py-2 text-xs shadow-lg"
          style={tipLeft ? { right: width - hx + 12 } : { left: hx + 12 }}
        >
          <div className="mb-1 font-medium text-ink">{new Date(t[hover]).toLocaleString()}</div>
          {series.map((s) => (
            <div key={s.label} className="flex items-center gap-2 text-gray-700">
              <span className="inline-block h-0.5 w-3" style={{ background: s.color }} />
              <span className="flex-1">{s.label}</span>
              <span className="font-mono tabular-nums">{s.values[hover] == null ? "—" : unit(s.values[hover]!)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
