"use client";

import { motion } from "framer-motion";

const EASE = [0.16, 1, 0.3, 1] as const;

// Fixed, deterministic offsets — not Math.random() — so server and client
// render the same scattered starting positions.
const DOTS = [
  { dx: -6, dy: -26 },
  { dx: 8, dy: 20 },
  { dx: -4, dy: -14 },
  { dx: 10, dy: 30 },
  { dx: -9, dy: -22 },
  { dx: 5, dy: 16 },
  { dx: -11, dy: -32 },
  { dx: 7, dy: 12 },
  { dx: -7, dy: -18 },
  { dx: 9, dy: 24 },
  { dx: -5, dy: -10 },
  { dx: 6, dy: 18 },
  { dx: -10, dy: -28 },
  { dx: 4, dy: 14 },
];

const COORDINATED = new Set([2, 5, 8, 11]);
const COUNT = DOTS.length;
const X0 = 24;
const X1 = 296;
const Y = 45;

export function CoordinationVisual() {
  return (
    <motion.svg
      viewBox="0 0 320 90"
      className="mx-auto w-full max-w-xs"
      aria-hidden="true"
      initial="scattered"
      whileInView="aligned"
      viewport={{ once: true, margin: "-100px" }}
    >
      {DOTS.map((d, i) => {
        const x = X0 + ((X1 - X0) / (COUNT - 1)) * i;
        const claimed = COORDINATED.has(i);
        return (
          <motion.circle
            key={i}
            r={claimed ? 4 : 3}
            variants={{
              scattered: { cx: x + d.dx, cy: Y + d.dy, opacity: 0.4 },
              aligned: { cx: x, cy: Y, opacity: 1 },
            }}
            transition={{ duration: 0.9, delay: 0.15 + i * 0.035, ease: EASE }}
            fill={claimed ? "var(--signal)" : "rgba(250,249,246,0.3)"}
          />
        );
      })}
    </motion.svg>
  );
}
