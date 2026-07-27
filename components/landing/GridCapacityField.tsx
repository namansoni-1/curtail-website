"use client";

import { useRef } from "react";
import {
  useScroll,
  useSpring,
  useTransform,
  useReducedMotion,
  motion,
} from "framer-motion";

// Shared geometry for the demand curve. Both the "ghost" (uncurtailed) and
// "actual" (managed) lines use the same horizontal control points — only the
// peak height differs — so the region between them can be built as one
// closed path with zero width at the edges and full width at the center.
const X0 = 40;
const X1 = 760;
const BASELINE = 210;
const CEILING = 118;
const GHOST_PEAK = 34;

function bumpPath(peakY: number, forward: boolean) {
  const fwd = `M${X0},${BASELINE} C240,${BASELINE} 300,${peakY} 400,${peakY} C500,${peakY} 560,${BASELINE} ${X1},${BASELINE}`;
  if (forward) return fwd;
  return `${X1},${BASELINE} C560,${BASELINE} 500,${peakY} 400,${peakY} C300,${peakY} 240,${BASELINE} ${X0},${BASELINE}`;
}

const BAR_X = [300, 400, 500];
const BAR_BOTTOM = 358;
const BAR_STEADY_H = 84;
const BAR_MAX_FLEX_H = 84;

export function GridCapacityField() {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start 0.82", "end 0.4"],
  });

  const smoothed = useSpring(scrollYProgress, {
    stiffness: 260,
    damping: 42,
    mass: 0.6,
  });

  // With reduced motion, skip scroll-scrubbing entirely and render the
  // resolved end-state as a static diagram.
  const progress = useTransform(smoothed, (v) => (reducedMotion ? 1 : v));

  const reveal = useTransform(progress, [0, 0.22], [0, 1], { clamp: true });
  const bump = useTransform(progress, [0.28, 0.68], [0, 1], { clamp: true });
  const settle = useTransform(progress, [0.78, 1], [0, 1], { clamp: true });

  const actualPeak = useTransform(bump, (b) => BASELINE + (CEILING - BASELINE) * b);
  const ghostPeak = useTransform(bump, (b) => BASELINE + (GHOST_PEAK - BASELINE) * b);

  const actualD = useTransform(actualPeak, (peak) => bumpPath(peak, true));
  const ghostD = useTransform(ghostPeak, (peak) => bumpPath(peak, true));
  const overlayD = useTransform([ghostPeak, actualPeak], ([g, a]: number[]) => {
    const top = bumpPath(g, true);
    const bottom = bumpPath(a, false);
    return `${top} L${X1},${BASELINE} ${bottom} Z`;
  });

  const overlayOpacity = useTransform(bump, [0, 0.12, 1], [0, 0.85, 0.85]);
  const ceilingOpacity = useTransform(progress, [0, 0.15], [0, 1], { clamp: true });

  const flexBarHeight = useTransform(bump, (b) => BAR_STEADY_H - BAR_MAX_FLEX_H * 0.62 * b);
  const flexBarY = useTransform(flexBarHeight, (h) => BAR_BOTTOM - h);
  const connectorOpacity = useTransform(bump, [0, 0.15, 1], [0, 1, 1]);
  const connectorLength = useTransform(bump, [0, 1], [0, 1]);
  const dotOpacity = useTransform(bump, [0.3, 0.55, 1], [0, 1, 0.9]);
  const dotY = useTransform(bump, (b) => BAR_BOTTOM - BAR_STEADY_H - (BAR_BOTTOM - BAR_STEADY_H - (CEILING + 10)) * b);

  const labelOpacity = useTransform(settle, [0, 1], [0, 1]);

  return (
    <div ref={containerRef} className="relative mx-auto w-full" style={{ aspectRatio: "800/400" }}>
      <svg
        viewBox={`0 0 ${X1 + 40} 400`}
        className="absolute inset-0 h-full w-full overflow-visible"
        aria-hidden="true"
      >
        <motion.line
          x1={X0 - 10}
          x2={X1 + 10}
          y1={CEILING}
          y2={CEILING}
          stroke="var(--gray-300)"
          strokeWidth={1}
          strokeDasharray="2 5"
          style={{ opacity: ceilingOpacity }}
        />

        <motion.path
          d={overlayD}
          fill="var(--signal)"
          style={{ opacity: overlayOpacity }}
        />

        <motion.path
          d={ghostD}
          fill="none"
          stroke="var(--gray-300)"
          strokeWidth={1.5}
          strokeDasharray="3 5"
          style={{ pathLength: reveal }}
        />

        <motion.path
          d={actualD}
          fill="none"
          stroke="var(--ink)"
          strokeWidth={2}
          strokeLinecap="round"
          style={{ pathLength: reveal, opacity: reveal }}
        />

        {BAR_X.map((x) => (
          <g key={x}>
            {x === 400 ? (
              <motion.rect
                x={x - 26}
                width={52}
                rx={3}
                fill="var(--ink)"
                fillOpacity={0.55}
                y={flexBarY}
                height={flexBarHeight}
              />
            ) : (
              <rect
                x={x - 26}
                width={52}
                y={BAR_BOTTOM - BAR_STEADY_H}
                height={BAR_STEADY_H}
                rx={3}
                fill="var(--ink)"
                fillOpacity={0.12}
              />
            )}
          </g>
        ))}

        <motion.line
          x1={400}
          x2={400}
          y1={BAR_BOTTOM - BAR_STEADY_H}
          y2={CEILING + 4}
          stroke="var(--signal)"
          strokeWidth={1.5}
          strokeDasharray="2 4"
          style={{ opacity: connectorOpacity, pathLength: connectorLength }}
        />
        <motion.circle r={4} cx={400} cy={dotY} fill="var(--signal)" style={{ opacity: dotOpacity }} />
      </svg>

      <motion.span
        style={{ opacity: labelOpacity, top: "0%" }}
        className="pointer-events-none absolute left-[3%] font-mono text-[10px] tracking-[0.16em] text-gray-400 uppercase"
        aria-hidden="true"
      >
        Traditional
      </motion.span>
      <motion.span
        style={{ opacity: labelOpacity, top: "18%" }}
        className="pointer-events-none absolute left-[3%] font-mono text-[10px] tracking-[0.16em] text-signal uppercase"
        aria-hidden="true"
      >
        Curtail
      </motion.span>
      <motion.span
        style={{ opacity: labelOpacity }}
        className="pointer-events-none absolute bottom-[2%] left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.16em] text-gray-400 uppercase"
        aria-hidden="true"
      >
        Tenant capacity
      </motion.span>
    </div>
  );
}
