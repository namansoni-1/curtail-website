"use client";

import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { useRef, type ReactNode, type RefObject } from "react";
import { spring } from "./tokens";
import { useSettledReducedMotion } from "./useSettledReducedMotion";

/**
 * Depth primitives.
 *
 * Parallax here is deliberately shallow — tens of pixels across a full
 * viewport of travel. The goal is that layers feel like they sit at different
 * depths, not that anything visibly slides. If you can point at the parallax,
 * it is too strong.
 */

/** Progress 0→1 as an element travels from entering the viewport to leaving it. */
export function useSectionProgress(
  ref: RefObject<HTMLElement | null>,
  config = spring.drift,
) {
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"],
  });
  return useSpring(scrollYProgress, config);
}

/**
 * Vertical offset for a layer, in px, as it crosses the viewport.
 * Positive `distance` means the layer lags behind the scroll (reads as
 * further away); negative means it leads (reads as closer).
 */
export function useParallax(
  ref: RefObject<HTMLElement | null>,
  distance = 40,
  config = spring.drift,
): MotionValue<number> {
  // Settled: these ranges determine the transform Framer writes into `style`,
  // which must match the server-rendered HTML on first paint.
  const reducedMotion = useSettledReducedMotion();
  const progress = useSectionProgress(ref, config);
  return useTransform(progress, [0, 1], reducedMotion ? [0, 0] : [distance, -distance]);
}

type ParallaxProps = {
  children: ReactNode;
  className?: string;
  /** Peak offset in px at the extremes of travel. Keep this small. */
  distance?: number;
  /** Scale at the midpoint of travel — a barely-there "breathe". 1 disables it. */
  scale?: number;
};

/**
 * Wraps content in a layer that drifts against the scroll. Uses `transform`
 * only, so it composites on the GPU and never triggers layout.
 */
export function Parallax({
  children,
  className,
  distance = 40,
  scale = 1,
}: ParallaxProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Settled: these ranges determine the transform Framer writes into `style`,
  // which must match the server-rendered HTML on first paint.
  const reducedMotion = useSettledReducedMotion();
  const progress = useSectionProgress(ref);

  const y = useTransform(progress, [0, 1], reducedMotion ? [0, 0] : [distance, -distance]);
  const s = useTransform(
    progress,
    [0, 0.5, 1],
    reducedMotion || scale === 1 ? [1, 1, 1] : [1, scale, 1],
  );

  return (
    <div ref={ref} className={className}>
      <motion.div style={{ y, scale: s, willChange: "transform" }}>
        {children}
      </motion.div>
    </div>
  );
}
