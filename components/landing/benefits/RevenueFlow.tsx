"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useInView } from "../useInView";

// One settled event, split. Money moves left to right along real paths, and
// every recipient's number fills to its share of the same $2,910.

const VB_W = 462;
const VB_H = 232;

const SOURCE = { x: 10, y: 88, w: 96, h: 56 };
const HUB = { x: 168, y: 82, w: 104, h: 68 };
const ROW_X = 300;
const ROW_W = 152;
const ROW_H = 40;

const RECIPIENTS = [
  { id: "ATL-01", label: "Northwind AI", amount: 920, mw: 8.2 },
  { id: "ATL-02", label: "Meridian Cloud", amount: 610, mw: 5.4 },
  { id: "ATL-03", label: "Halcyon Systems", amount: 650, mw: 5.8 },
  { id: "OPS", label: "Operator", amount: 730, mw: 0 },
];

const TOTAL = RECIPIENTS.reduce((sum, r) => sum + r.amount, 0);

const ROWS = RECIPIENTS.map((r, i) => ({
  ...r,
  y: 6 + i * 56,
  cy: 6 + i * 56 + ROW_H / 2,
}));

const HUB_OUT = { x: HUB.x + HUB.w, y: HUB.y + HUB.h / 2 };
const SOURCE_OUT = { x: SOURCE.x + SOURCE.w, y: SOURCE.y + SOURCE.h / 2 };

const FEED_PATH = `M${SOURCE_OUT.x},${SOURCE_OUT.y} L${HUB.x},${HUB.y + HUB.h / 2}`;

function outPath(cy: number) {
  return `M${HUB_OUT.x},${HUB_OUT.y} C${HUB_OUT.x + 22},${HUB_OUT.y} ${ROW_X - 22},${cy} ${ROW_X},${cy}`;
}

const FILL_MS = 5200;
const HOLD_MS = 2200;
const TICK_MS = 90;

export function RevenueFlow() {
  const { ref, inView } = useInView<HTMLDivElement>("-40px");
  const reducedMotion = useReducedMotion();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!inView || reducedMotion) return;
    let elapsed = 0;
    const id = setInterval(() => {
      elapsed += TICK_MS;
      if (elapsed > FILL_MS + HOLD_MS) elapsed = 0;
      setProgress(Math.min(1, elapsed / FILL_MS));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [inView, reducedMotion]);

  // Ease-out so the split lands softly instead of stopping dead.
  const eased = reducedMotion ? 1 : 1 - Math.pow(1 - progress, 2.2);

  return (
    <div ref={ref} className="px-4 py-6 sm:px-6">
      <div className="relative w-full" style={{ aspectRatio: `${VB_W}/${VB_H}` }}>
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <defs>
            <path id="feed" d={FEED_PATH} fill="none" />
            {ROWS.map((row) => (
              <path key={row.id} id={`out-${row.id}`} d={outPath(row.cy)} fill="none" />
            ))}
          </defs>

          <use href="#feed" stroke="var(--ink)" strokeOpacity={0.14} strokeWidth={1.5} />
          {ROWS.map((row) => (
            <use
              key={row.id}
              href={`#out-${row.id}`}
              stroke="var(--ink)"
              strokeOpacity={0.14}
              strokeWidth={1.5}
            />
          ))}

          {/* source */}
          <rect
            x={SOURCE.x}
            y={SOURCE.y}
            width={SOURCE.w}
            height={SOURCE.h}
            rx={6}
            fill="none"
            stroke="var(--ink)"
            strokeOpacity={0.14}
          />
          <text
            x={SOURCE.x + SOURCE.w / 2}
            y={SOURCE.y + 22}
            textAnchor="middle"
            className="fill-gray-400 font-mono"
            style={{ fontSize: 9, letterSpacing: "0.14em" }}
          >
            GRID
          </text>
          <text
            x={SOURCE.x + SOURCE.w / 2}
            y={SOURCE.y + 40}
            textAnchor="middle"
            className="fill-ink"
            style={{ fontSize: 15, fontWeight: 600 }}
          >
            ${TOTAL.toLocaleString()}
          </text>

          {/* hub */}
          <rect
            x={HUB.x}
            y={HUB.y}
            width={HUB.w}
            height={HUB.h}
            rx={6}
            fill="var(--signal)"
            fillOpacity={0.05}
            stroke="var(--signal)"
            strokeOpacity={0.3}
          />
          <text
            x={HUB.x + HUB.w / 2}
            y={HUB.y + 26}
            textAnchor="middle"
            className="fill-ink"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            Curtail
          </text>
          <text
            x={HUB.x + HUB.w / 2}
            y={HUB.y + 44}
            textAnchor="middle"
            className="fill-gray-400 font-mono"
            style={{ fontSize: 8.5, letterSpacing: "0.12em" }}
          >
            SETTLEMENT
          </text>
          <text
            x={HUB.x + HUB.w / 2}
            y={HUB.y + 58}
            textAnchor="middle"
            className="fill-signal font-mono"
            style={{ fontSize: 8.5, letterSpacing: "0.12em" }}
          >
            PER VERIFIED MW
          </text>

          {/* recipients */}
          {ROWS.map((row) => {
            const value = Math.round((row.amount * eased) / 10) * 10;
            const share = row.amount / TOTAL;
            return (
              <g key={row.id}>
                <rect
                  x={ROW_X}
                  y={row.y}
                  width={ROW_W}
                  height={ROW_H}
                  rx={6}
                  fill="var(--paper)"
                  stroke="var(--ink)"
                  strokeOpacity={progress > 0.1 ? 0.14 : 0.08}
                />
                <rect
                  x={ROW_X}
                  y={row.y + ROW_H - 3}
                  width={ROW_W * share * eased}
                  height={3}
                  rx={1.5}
                  fill="var(--signal)"
                />
                <text
                  x={ROW_X + 10}
                  y={row.y + 17}
                  className="fill-ink"
                  style={{ fontSize: 10 }}
                >
                  {row.label}
                </text>
                <text
                  x={ROW_X + 10}
                  y={row.y + 30}
                  className="fill-gray-400 font-mono"
                  style={{ fontSize: 8.5, letterSpacing: "0.08em" }}
                >
                  {row.mw > 0 ? `${row.mw.toFixed(1)} MW` : "PLATFORM"}
                </text>
                <text
                  x={ROW_X + ROW_W - 10}
                  y={row.y + 24}
                  textAnchor="end"
                  className="fill-signal-dim font-mono"
                  style={{ fontSize: 12, fontWeight: 600 }}
                >
                  ${value.toLocaleString()}
                </text>
              </g>
            );
          })}

          {/* money in motion */}
          {!reducedMotion && inView && (
            <>
              {[0, 1, 2].map((i) => (
                <circle key={`feed-${i}`} r={3} fill="var(--signal)">
                  <animateMotion dur="1.9s" repeatCount="indefinite" begin={`-${i * 0.63}s`}>
                    <mpath href="#feed" />
                  </animateMotion>
                </circle>
              ))}
              {ROWS.map((row, i) =>
                [0, 1].map((j) => (
                  <circle key={`${row.id}-${j}`} r={2.6} fill="var(--signal)">
                    <animateMotion
                      dur="2.3s"
                      repeatCount="indefinite"
                      begin={`-${(i * 0.29 + j * 1.15).toFixed(2)}s`}
                    >
                      <mpath href={`#out-${row.id}`} />
                    </animateMotion>
                  </circle>
                )),
              )}
            </>
          )}
        </svg>
      </div>

      <div className="mt-2 flex items-center justify-between px-1 font-mono text-[9px] tracking-[0.12em] text-gray-400 uppercase">
        <span>Event DR-4471</span>
        <span>
          <span className="text-signal-dim">
            ${(Math.round((TOTAL * eased) / 10) * 10).toLocaleString()}
          </span>{" "}
          of ${TOTAL.toLocaleString()} distributed
        </span>
      </div>
    </div>
  );
}
