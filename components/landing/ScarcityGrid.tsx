"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useMotionValueEvent, useScroll, useSpring, useTransform } from "framer-motion";
import { spring, useSettledReducedMotion } from "@/components/motion";
import { SCARCITY_HOURS, SCARCITY_YEAR } from "./scarcityHours";

const DAYS = 365;
const HOURS = 24;
const HIGH = 1000;

// Sequential steps on one hue, checked with the dataviz palette validator
// against the paper surface: quiet hour, $200+ and $1,000+.
const QUIET = "#ece9e2";
const WARM = "#dda27a";
const HOT = "#a85f2a";

const byCell = new Map<number, number>();
for (const [day, hour, price] of SCARCITY_HOURS) byCell.set(day * HOURS + hour, price);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_START = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function cellLabel(day: number, hour: number) {
  const date = new Date(Date.UTC(SCARCITY_YEAR, 0, 1 + day));
  const d = date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const h = hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`;
  return `${d}, ${h}`;
}

type Tip = { x: number; y: number; label: string; price: number | undefined };

/**
 * One square per hour of a real year. The sweep reveals the year left to
 * right against scroll; the scarce hours then light up on top of it.
 */
export function ScarcityGrid() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [tip, setTip] = useState<Tip | null>(null);
  const reducedMotion = useSettledReducedMotion();

  const { scrollYProgress } = useScroll({ target: wrapRef, offset: ["start 0.95", "end 0.6"] });
  const smoothed = useSpring(scrollYProgress, spring.scrub);
  const progress = useTransform(smoothed, (v) => (reducedMotion ? 1 : v));

  const cw = width / DAYS;
  const ch = Math.min(10, Math.max(5, cw * 3));
  const height = ch * HOURS;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function draw(p: number) {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const sweep = Math.min(1, p / 0.55);
    const light = Math.min(1, Math.max(0, (p - 0.45) / 0.4));
    const shown = Math.ceil(sweep * DAYS);
    const gx = cw >= 2.5 ? 1 : 0;

    ctx.fillStyle = QUIET;
    for (let d = 0; d < shown; d++) {
      for (let h = 0; h < HOURS; h++) ctx.fillRect(d * cw, h * ch, cw - gx, ch - 1);
    }
    if (light <= 0) return;
    ctx.globalAlpha = light;
    for (const [d, h, price] of SCARCITY_HOURS) {
      ctx.fillStyle = price >= HIGH ? HOT : WARM;
      // Keep a single hour visible even when a day column is under a pixel.
      const w = Math.max(cw - gx, 2);
      ctx.fillRect(d * cw + (cw - gx - w) / 2, h * ch, w, ch - 1);
    }
    ctx.globalAlpha = 1;
  }

  useMotionValueEvent(progress, "change", draw);
  useEffect(() => draw(progress.get()));

  function onMove(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const day = Math.min(DAYS - 1, Math.max(0, Math.floor(x / cw)));
    const hour = Math.min(HOURS - 1, Math.max(0, Math.floor(y / ch)));
    // Snap to a lit hour within a couple of columns, so a sub-pixel day is
    // still easy to hit.
    let hit = day;
    for (let dd = -2; dd <= 2 && !byCell.has(hit * HOURS + hour); dd++) {
      if (byCell.has((day + dd) * HOURS + hour)) hit = day + dd;
    }
    setTip({ x, y, label: cellLabel(hit, hour), price: byCell.get(hit * HOURS + hour) });
  }

  return (
    <figure className="w-full">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
        <div
          className="flex flex-col justify-between font-mono text-[10px] text-gray-400"
          style={{ height: height || 160 }}
          aria-hidden="true"
        >
          <span>12 AM</span>
          <span>Noon</span>
          <span>11 PM</span>
        </div>
        <div ref={wrapRef} className="relative" style={{ height: height || 160 }}>
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={`Every hour of ${SCARCITY_YEAR} as a grid of days by hour of day. ${SCARCITY_HOURS.length} of 8,760 hours had ERCOT North Hub real-time prices at or above $200 per MWh, clustered on summer afternoons and a few winter cold snaps.`}
            className="block h-full w-full cursor-crosshair touch-pan-y"
            style={{ width, height }}
            onPointerMove={onMove}
            onPointerLeave={() => setTip(null)}
          />
          {tip && (
            <div
              className="pointer-events-none absolute z-10 rounded-lg border border-ink/10 bg-paper px-2.5 py-1.5 text-xs whitespace-nowrap text-ink shadow-sm"
              style={{
                left: Math.min(Math.max(tip.x, 70), width - 70),
                top: tip.y - 12,
                transform: "translate(-50%, -100%)",
              }}
            >
              <div className="text-gray-500">{tip.label}</div>
              <div className="font-mono tabular-nums">
                {tip.price === undefined ? "Under $200/MWh" : `$${tip.price.toLocaleString("en-US")}/MWh`}
              </div>
            </div>
          )}
        </div>
        <span />
        <div className="relative mt-2 h-4 font-mono text-[10px] text-gray-400" aria-hidden="true">
        {MONTHS.map((m, i) =>
          i % 3 === 0 ? (
            <span key={m} className="absolute" style={{ left: `${(MONTH_START[i] / DAYS) * 100}%` }}>
              {m}
            </span>
          ) : null,
        )}
        </div>
      </div>

      <figcaption className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: QUIET }} /> Normal hour
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: WARM }} /> $200–1,000/MWh
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: HOT }} /> Over $1,000/MWh
        </span>
        <span className="text-gray-400">
          ERCOT North Hub real-time prices, {SCARCITY_YEAR}. Each square is one hour.
        </span>
      </figcaption>
    </figure>
  );
}
