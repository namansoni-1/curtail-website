"use client";

import { useRef } from "react";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { HeroField } from "./HeroField";
import { Button } from "./Button";
import {
  Stagger,
  StaggerItem,
  duration,
  ease,
  spring,
  useSettledReducedMotion,
} from "@/components/motion";

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const reducedMotion = useSettledReducedMotion();

  // 0 → 1 as the hero scrolls out of frame. Drives the handoff into the
  // section below: copy lifts and dissolves slightly ahead of the scroll, the
  // canvas drifts slower than both. Three depths, one gesture.
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ["start start", "end start"],
  });
  const exit = useSpring(scrollYProgress, spring.scrub);

  const copyY = useTransform(exit, [0, 1], [0, -72]);
  const copyOpacity = useTransform(exit, [0, 0.55], [1, 0], { clamp: true });
  const fieldY = useTransform(exit, [0, 1], [0, 96]);
  const fieldScale = useTransform(exit, [0, 1], [1, 1.06]);
  const cueOpacity = useTransform(exit, [0, 0.12], [1, 0], { clamp: true });

  const still = reducedMotion;

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-16"
    >
      <motion.div
        className="absolute inset-0"
        style={still ? undefined : { y: fieldY, scale: fieldScale }}
      >
        <HeroField />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_55%,var(--paper)_92%)]" />
      </motion.div>

      <motion.div
        className="relative z-10 mx-auto max-w-4xl text-center"
        style={still ? undefined : { y: copyY, opacity: copyOpacity }}
      >
        <Stagger on="mount" step={0.11} delay={0.15}>
          <StaggerItem
            as="p"
            kind="blur"
            distance="xs"
            duration={duration.slow}
            className="mb-7 font-mono text-[11px] font-medium tracking-[0.2em] text-gray-500 uppercase"
          >
            For multi-tenant data centers
          </StaggerItem>

          <StaggerItem
            as="h1"
            kind="blur"
            distance="md"
            duration={duration.cinematic}
            className="text-5xl font-semibold tracking-tight text-ink sm:text-6xl md:text-7xl md:leading-[1.05]"
          >
            Turn tenant load into
            <br />
            dispatchable grid capacity.
          </StaggerItem>

          <StaggerItem
            as="p"
            distance="sm"
            duration={duration.slow}
            className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-gray-500 md:text-lg"
          >
            Curtail turns opted-in tenant load into verified capacity you can
            commit to the grid. No new hardware. No contract changes.
          </StaggerItem>

          <StaggerItem
            distance="sm"
            duration={duration.slow}
            className="mt-11 flex items-center justify-center"
          >
            <Button href="mailto:founders@curtail.ai">Request access</Button>
          </StaggerItem>
        </Stagger>
      </motion.div>

      {/* Two layers, because a MotionValue in `style` wins over `animate` for
          the same property: the outer element owns the one-time entrance, the
          inner owns the scroll-linked dismissal. */}
      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.6, duration: 1, ease: ease.out }}
      >
        <motion.div
          className="flex flex-col items-center gap-2.5"
          style={still ? undefined : { opacity: cueOpacity }}
        >
          <span className="font-mono text-[10px] tracking-[0.25em] text-gray-400 uppercase">
            Scroll
          </span>
          <motion.div
            className="h-7 w-px bg-gradient-to-b from-gray-300 to-transparent"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </motion.div>
      </motion.div>
    </section>
  );
}
