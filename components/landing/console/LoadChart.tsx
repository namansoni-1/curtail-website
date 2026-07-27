"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

// Site load, rolling. The forecast line is what the site would draw with no
// flexibility; the actual line is what Curtail delivers. The band between
// them is the committed capacity, and it is the whole point of the chart:
// the forecast crosses the interconnect cap, the actual never does.

const N = 84;
const W = 640;
const H = 190;
const TOP = 14;
const BOTTOM = H - 16;

const Y_MIN = 106;
const Y_MAX = 138;
const CAP = 130;

const BASE_LOAD = 112;
const LOAD_SWING = 26;
const MAX_SHED = 19.4;

const SAMPLE_MS = 340;

function y(mw: number) {
  const t = (mw - Y_MIN) / (Y_MAX - Y_MIN);
  return BOTTOM - Math.max(0, Math.min(1, t)) * (BOTTOM - TOP);
}

function x(i: number) {
  return (i / (N - 1)) * W;
}

/** Deterministic wobble so the line breathes without Math.random. */
function noise(i: number) {
  return (
    Math.sin(i * 0.7) * 0.55 +
    Math.sin(i * 0.23 + 1.7) * 0.9 +
    Math.sin(i * 1.9 + 0.4) * 0.25
  );
}

function linePath(values: number[]) {
  let d = `M0,${y(values[0]).toFixed(2)}`;
  for (let i = 1; i < values.length; i++) {
    d += ` L${x(i).toFixed(2)},${y(values[i]).toFixed(2)}`;
  }
  return d;
}

function bandPath(top: number[], bottom: number[]) {
  let d = `M0,${y(top[0]).toFixed(2)}`;
  for (let i = 1; i < top.length; i++) {
    d += ` L${x(i).toFixed(2)},${y(top[i]).toFixed(2)}`;
  }
  for (let i = bottom.length - 1; i >= 0; i--) {
    d += ` L${x(i).toFixed(2)},${y(bottom[i]).toFixed(2)}`;
  }
  return `${d} Z`;
}

const SEED_FORECAST = Array.from(
  { length: N },
  (_, i) => BASE_LOAD + LOAD_SWING * 0.34 + noise(i),
);
const SEED_ACTUAL = SEED_FORECAST.slice();

export function LoadChart({
  gridLoad,
  shed,
  live,
}: {
  gridLoad: number;
  shed: number;
  live: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const forecastRef = useRef<SVGPathElement>(null);
  const actualRef = useRef<SVGPathElement>(null);
  const bandRef = useRef<SVGPathElement>(null);
  const headRef = useRef<SVGCircleElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  const target = useRef({ gridLoad, shed });
  // The rolling buffer outlives the loop so scrolling away and back resumes
  // the trace instead of snapping it flat.
  const buffer = useRef({
    forecast: SEED_FORECAST.slice(),
    actual: SEED_ACTUAL.slice(),
    smoothLoad: SEED_FORECAST[N - 1],
    smoothShed: 0,
    step: N,
  });

  useEffect(() => {
    target.current = { gridLoad, shed };
  }, [gridLoad, shed]);

  useEffect(() => {
    if (reducedMotion || !live) return;

    const { forecast, actual } = buffer.current;
    let acc = 0;
    let last = performance.now();
    let frame = 0;

    const tick = (now: number) => {
      const dt = Math.min(now - last, 120);
      last = now;
      acc += dt;

      while (acc >= SAMPLE_MS) {
        acc -= SAMPLE_MS;
        const state = buffer.current;
        const wanted = BASE_LOAD + LOAD_SWING * target.current.gridLoad;
        state.smoothLoad += (wanted - state.smoothLoad) * 0.22;
        state.smoothShed += (target.current.shed - state.smoothShed) * 0.26;

        const f = state.smoothLoad + noise(state.step);
        forecast.push(f);
        forecast.shift();
        actual.push(f - MAX_SHED * state.smoothShed);
        actual.shift();
        state.step++;

        forecastRef.current?.setAttribute("d", linePath(forecast));
        actualRef.current?.setAttribute("d", linePath(actual));
        bandRef.current?.setAttribute("d", bandPath(forecast, actual));
        headRef.current?.setAttribute("cy", String(y(actual[N - 1])));
        if (readoutRef.current) {
          readoutRef.current.textContent = actual[N - 1].toFixed(1);
        }
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [live, reducedMotion]);

  const shedding = shed > 0.05;

  return (
    <div className="flex h-full flex-col px-3.5 pt-3 pb-2">
      <div className="mb-2 flex items-baseline justify-between">
        <p className="font-mono text-[10px] tracking-[0.14em] text-gray-400 uppercase">
          Site load
        </p>
        <p className="font-mono text-[11px] text-gray-500">
          <span ref={readoutRef} className="tabular-nums text-ink">
            {SEED_ACTUAL[N - 1].toFixed(1)}
          </span>{" "}
          MW
        </p>
      </div>

      <div className="relative min-h-[150px] flex-1">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          aria-hidden="true"
        >
          {[110, 118, 126, 134].map((mw) => (
            <line
              key={mw}
              x1={0}
              x2={W}
              y1={y(mw)}
              y2={y(mw)}
              stroke="var(--ink)"
              strokeOpacity={0.05}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          <line
            x1={0}
            x2={W}
            y1={y(CAP)}
            y2={y(CAP)}
            stroke="var(--gray-400)"
            strokeWidth={1}
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />

          <path
            ref={bandRef}
            d={bandPath(SEED_FORECAST, SEED_ACTUAL)}
            fill="var(--signal)"
            fillOpacity={0.14}
          />
          <path
            ref={forecastRef}
            d={linePath(SEED_FORECAST)}
            fill="none"
            stroke="var(--gray-400)"
            strokeWidth={1.5}
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />
          <path
            ref={actualRef}
            d={linePath(SEED_ACTUAL)}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{
              stroke: shedding ? "var(--signal)" : "var(--ink)",
              transition: "stroke 600ms ease",
            }}
          />
          <circle
            ref={headRef}
            cx={W - 1}
            cy={y(SEED_ACTUAL[N - 1])}
            r={3.5}
            fill={shedding ? "var(--signal)" : "var(--ink)"}
            stroke="var(--paper)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ transition: "fill 600ms ease" }}
          />
        </svg>

        <span
          className="pointer-events-none absolute right-1 font-mono text-[9px] tracking-[0.12em] text-gray-400 uppercase"
          style={{ top: `${(y(CAP) / H) * 100}%`, transform: "translateY(-130%)" }}
        >
          Interconnect cap
        </span>
      </div>

      <div className="mt-1 flex items-center gap-4 font-mono text-[9px] tracking-[0.12em] text-gray-400 uppercase">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-px w-3 border-t border-dashed border-gray-400" />
          Forecast
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-3 rounded-full bg-ink" />
          Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-[2px] bg-signal/25" />
          Delivered
        </span>
      </div>
    </div>
  );
}
