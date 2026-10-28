"use client";

import { useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { CoordinationVisual } from "./CoordinationVisual";
import { SectionLabel } from "./SectionLabel";
import {
  Stagger,
  StaggerItem,
  duration,
  spring,
  useSettledReducedMotion,
} from "@/components/motion";

export function CoreInsight() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useSettledReducedMotion();

  // Runs 0 → 1 across the approach to the section, finishing as its top edge
  // reaches the middle of the viewport. The dark does not switch on; it
  // arrives, having already started well before the boundary is on screen.
  const { scrollYProgress } = useScroll({
    target: wrapRef,
    offset: ["start end", "start center"],
  });
  const approach = useSpring(scrollYProgress, spring.drift);

  const bleedOpacity = useTransform(approach, [0, 1], [0, 1]);
  // The atmosphere inside the section settles slightly after the bleed, so
  // the room feels like it is still resolving as you enter it.
  const atmosphere = useTransform(approach, [0.35, 1], [0, 1], { clamp: true });
  const atmosphereScale = useTransform(approach, [0.35, 1], [1.25, 1], { clamp: true });

  const still = reducedMotion;

  return (
    <div ref={wrapRef} className="relative">
      {/* Bleeds up over the tail of the previous section, so the paper is
          already going dark before the boundary arrives. Sits in the previous
          section's bottom padding, clear of its copy. */}
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-48 z-10 h-48 bg-[linear-gradient(to_bottom,transparent,var(--ink))]"
        style={still ? { opacity: 1 } : { opacity: bleedOpacity }}
      />

      <section className="relative overflow-hidden border-t border-ink bg-ink px-6 py-32 md:py-44">
        {/* Slow, barely-perceptible glow that expands as the chapter opens. */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_40%,rgba(200,118,58,0.10),transparent_70%)]"
          style={
            still
              ? { opacity: 1 }
              : { opacity: atmosphere, scale: atmosphereScale }
          }
        />

        <div className="relative mx-auto max-w-2xl text-center">
          <Stagger step={0.12} trigger="earlier">
            <StaggerItem distance="xs">
              <SectionLabel onDark>The core insight</SectionLabel>
            </StaggerItem>

            <StaggerItem
              as="p"
              kind="blur"
              distance="md"
              duration={duration.cinematic}
              className="mx-auto max-w-lg text-2xl leading-snug font-medium text-paper sm:text-3xl"
            >
              Data centers already have flexible load. Cooling. Batteries.
              Deferrable jobs. Operators just have no layer to see it or use it.
              Curtail is that layer.
            </StaggerItem>

            <StaggerItem className="mt-14" distance="sm" duration={duration.slow}>
              <CoordinationVisual />
            </StaggerItem>
          </Stagger>
        </div>
      </section>
    </div>
  );
}
