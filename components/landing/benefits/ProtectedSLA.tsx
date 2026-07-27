"use client";

import { useEffect, useState } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { useInView } from "../useInView";

// One lane per tenant, all drawn on the same clock. The dispatch window
// sweeps across every lane, and only the opted-in lanes bend. The flat ones
// are the argument: an SLA that was never in the event never moves.

const W = 300;
const H = 34;
const POINTS = 64;
const WINDOW_START = 0.42;
const WINDOW_END = 0.82;

type Lane = {
  id: string;
  name: string;
  flexes: boolean;
  mw: number;
  state: string;
};

const LANES: Lane[] = [
  { id: "ATL-01", name: "Northwind AI", flexes: true, mw: 8.2, state: "Opted in" },
  { id: "ATL-02", name: "Meridian Cloud", flexes: true, mw: 5.4, state: "Opted in" },
  { id: "ATL-03", name: "Halcyon Systems", flexes: true, mw: 5.8, state: "Opted in" },
  { id: "ATL-05", name: "Kestrel Data", flexes: false, mw: 0, state: "Maintenance" },
  { id: "ATL-04", name: "Vector Labs", flexes: false, mw: 0, state: "Not enrolled" },
];

function noise(i: number, seed: number) {
  return Math.sin(i * 0.9 + seed) * 0.012 + Math.sin(i * 0.31 + seed * 2) * 0.018;
}

/** 0 outside the dispatch window, 1 inside, with short ramps on each edge. */
function windowShape(u: number) {
  if (u < WINDOW_START || u > WINDOW_END) return 0;
  const ramp = 0.07;
  if (u < WINDOW_START + ramp) return (u - WINDOW_START) / ramp;
  if (u > WINDOW_END - ramp) return (WINDOW_END - u) / ramp;
  return 1;
}

function lanePath(lane: Lane, seed: number) {
  let d = "";
  for (let i = 0; i < POINTS; i++) {
    const u = i / (POINTS - 1);
    const dip = lane.flexes ? windowShape(u) * 0.4 : 0;
    const v = 1 - dip + noise(i, seed);
    const x = u * W;
    const y = H - 6 - (v - 0.5) * 40;
    d += `${i === 0 ? "M" : " L"}${x.toFixed(1)},${y.toFixed(2)}`;
  }
  return d;
}

const PATHS = LANES.map((lane, i) => lanePath(lane, i * 1.7));
const BASELINE_Y = H - 6 - 0.5 * 40;

export function ProtectedSLA() {
  const { ref, inView } = useInView<HTMLDivElement>("-40px");
  const reducedMotion = useReducedMotion();
  const sweep = useMotionValue(0);
  const [dispatching, setDispatching] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    if (reducedMotion) sweep.set(1);
  }, [reducedMotion, sweep]);

  useEffect(() => {
    if (!inView || reducedMotion) return;
    const controls = animate(sweep, 1, {
      duration: 5.2,
      ease: "linear",
      repeat: Infinity,
      repeatDelay: 0.9,
      onRepeat: () => setDispatching(false),
    });
    return () => controls.stop();
  }, [inView, reducedMotion, sweep]);

  useMotionValueEvent(sweep, "change", (v) => {
    const open = v > WINDOW_START && v < WINDOW_END;
    setDispatching((prev) => (prev === open ? prev : open));
  });

  const headX = useTransform(sweep, [0, 1], [0, W]);
  const bandOpacity = useTransform(sweep, [WINDOW_START, WINDOW_START + 0.05], [0, 1]);

  return (
    <div ref={ref} className="px-4 py-6 sm:px-6">
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="font-mono text-[10px] tracking-[0.16em] text-gray-400 uppercase">
          Tenant load
        </span>
        <motion.span
          className="font-mono text-[10px] tracking-[0.16em] uppercase"
          animate={{ opacity: dispatching ? 1 : 0.35 }}
          transition={{ duration: 0.3 }}
        >
          <span className={dispatching ? "text-signal" : "text-gray-400"}>
            {dispatching ? "Dispatch window open" : "No dispatch"}
          </span>
        </motion.span>
      </div>

      <div className="divide-y divide-ink/[0.05] border-y border-ink/[0.06]">
        {LANES.map((lane, i) => {
          const dim = hovered !== null && hovered !== lane.id;
          const flexing = dispatching && lane.flexes;
          return (
            <div
              key={lane.id}
              className="group flex items-center gap-3 py-2.5 transition-colors duration-300 hover:bg-gray-50/70"
              style={{ opacity: dim ? 0.4 : 1, transition: "opacity 250ms" }}
              onMouseEnter={() => setHovered(lane.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <div className="w-28 shrink-0 pl-1 sm:w-36">
                <p className="truncate text-[13px] text-ink">{lane.name}</p>
                <p className="font-mono text-[10px] text-gray-400">{lane.id}</p>
              </div>

              <div className="relative min-w-0 flex-1">
                <svg
                  viewBox={`0 0 ${W} ${H}`}
                  preserveAspectRatio="none"
                  className="h-9 w-full"
                  aria-hidden="true"
                >
                  <motion.rect
                    x={WINDOW_START * W}
                    width={(WINDOW_END - WINDOW_START) * W}
                    y={0}
                    height={H}
                    fill="var(--signal)"
                    fillOpacity={0.06}
                    style={{ opacity: bandOpacity }}
                  />
                  <line
                    x1={0}
                    x2={W}
                    y1={BASELINE_Y}
                    y2={BASELINE_Y}
                    stroke="var(--ink)"
                    strokeOpacity={0.12}
                    strokeDasharray="2 4"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                  <motion.path
                    d={PATHS[i]}
                    fill="none"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                    stroke={lane.flexes ? "var(--signal)" : "var(--ink)"}
                    strokeOpacity={lane.flexes ? 1 : 0.35}
                    style={{ pathLength: sweep }}
                  />
                  <motion.line
                    y1={0}
                    y2={H}
                    stroke="var(--ink)"
                    strokeOpacity={0.18}
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                    style={{ x: headX }}
                  />
                </svg>
              </div>

              <div className="w-24 shrink-0 pr-1 text-right sm:w-28">
                <p
                  className={`font-mono text-[10px] tracking-[0.1em] uppercase transition-colors duration-300 ${
                    flexing ? "text-signal-dim" : "text-gray-400"
                  }`}
                >
                  {flexing ? `Flexing ${lane.mw.toFixed(1)} MW` : lane.state}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-gray-300">
                  {lane.flexes ? "SLA respected" : "Untouched"}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 px-1 font-mono text-[9px] tracking-[0.12em] text-gray-400 uppercase">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-3 rounded-full bg-signal" />
          Opted in
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-[2px] w-3 rounded-full bg-ink/35" />
          Everyone else
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-3 rounded-[2px] bg-signal/10" />
          Dispatch window
        </span>
      </div>
    </div>
  );
}
