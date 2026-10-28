"use client";

import { motion, type Transition, type Variants } from "framer-motion";
import { type ReactNode } from "react";
import { useScrollEngine } from "./ScrollProvider";
import { blur, duration, ease, stagger, travel, viewport } from "./tokens";

/**
 * The reveal system.
 *
 * Two rules hold the whole page together:
 *
 * 1. Nothing animates alone. A section's headline, lead, supporting copy and
 *    details are children of one `<Stagger>` and arrive in sequence. Only the
 *    parent watches the viewport; children inherit its timing, so a section
 *    reads as one orchestrated gesture instead of N independent fades.
 *
 * 2. Nothing makes you wait. Every duration is resolved *at the moment the
 *    animation starts* against current scroll velocity — scroll fast and
 *    reveals compress toward half-length, scroll slowly and they play in
 *    full. This is why the variants below are functions: Framer calls them
 *    when the variant is applied, not when the component renders.
 */

export type RevealKind = "fade" | "blur" | "lift" | "scale";

type Distance = keyof typeof travel;

function hiddenFor(kind: RevealKind, distance: Distance) {
  const y = travel[distance];
  switch (kind) {
    case "blur":
      return { opacity: 0, y: y * 0.5, filter: `blur(${blur.md}px)` };
    case "lift":
      return { opacity: 0, y };
    case "scale":
      return { opacity: 0, y: y * 0.4, scale: 0.985 };
    case "fade":
    default:
      return { opacity: 0, y: y * 0.6 };
  }
}

function visibleFor(kind: RevealKind) {
  switch (kind) {
    case "blur":
      return { opacity: 1, y: 0, filter: "blur(0px)" };
    case "scale":
      return { opacity: 1, y: 0, scale: 1 };
    case "lift":
    case "fade":
    default:
      return { opacity: 1, y: 0 };
  }
}

type BuildArgs = {
  kind: RevealKind;
  distance: Distance;
  dur: number;
  delay: number;
  getScale: () => number;
};

function buildVariants({
  kind,
  distance,
  dur,
  delay,
  getScale,
}: BuildArgs): Variants {
  return {
    hidden: hiddenFor(kind, distance),
    // Resolved when the reveal fires, so `getScale()` sees the velocity the
    // user is actually scrolling at right now.
    visible: () => {
      const scale = getScale();
      return {
        ...visibleFor(kind),
        transition: {
          duration: dur * scale,
          delay: delay * scale,
          ease: ease.out,
        } satisfies Transition,
      };
    },
  };
}

/* ------------------------------------------------------------------ single */

type RevealProps = {
  children: ReactNode;
  className?: string;
  /** Seconds to hold before starting. Scaled by scroll velocity like duration. */
  delay?: number;
  /** Base duration in seconds, before velocity scaling. */
  duration?: number;
  kind?: RevealKind;
  distance?: Distance;
  /** How early the reveal triggers relative to entering the viewport. */
  trigger?: keyof typeof viewport;
};

/**
 * A single self-triggering reveal. Reach for `<Stagger>` when more than one
 * element in a section needs to arrive — a page full of independent `Reveal`s
 * is exactly the "everything appears at once" problem.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  duration: dur = duration.base,
  kind = "fade",
  distance = "sm",
  trigger = "early",
}: RevealProps) {
  const { getDurationScale } = useScrollEngine();

  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={viewport[trigger]}
      variants={buildVariants({
        kind,
        distance,
        dur,
        delay,
        getScale: getDurationScale,
      })}
    >
      {children}
    </motion.div>
  );
}

/* -------------------------------------------------------------- orchestrated */

type StaggerProps = {
  children: ReactNode;
  className?: string;
  /** Gap between children, in seconds. */
  step?: number;
  /** Hold before the first child starts. */
  delay?: number;
  trigger?: keyof typeof viewport;
  /**
   * `"view"` cascades when the group scrolls into view (default).
   * `"mount"` cascades immediately — for the initial page entrance, where
   * there is no scroll position to react to yet.
   */
  on?: "view" | "mount";
};

/**
 * Orchestrating parent. Watches the viewport once and cascades `visible` down
 * to every `<StaggerItem>` beneath it, in DOM order.
 */
export function Stagger({
  children,
  className,
  step = stagger.step,
  delay = 0,
  trigger = "early",
  on = "view",
}: StaggerProps) {
  const { getDurationScale } = useScrollEngine();

  const variants: Variants = {
    hidden: {},
    visible: () => {
      // A mount cascade always plays in full: velocity is zero on load, and
      // the entrance is what establishes the page's rhythm.
      const scale = on === "mount" ? 1 : getDurationScale();
      return {
        transition: {
          staggerChildren: step * scale,
          delayChildren: delay * scale,
        },
      };
    },
  };

  const trigate =
    on === "mount"
      ? { animate: "visible" as const }
      : { whileInView: "visible" as const, viewport: viewport[trigger] };

  return (
    <motion.div
      className={className}
      initial="hidden"
      variants={variants}
      {...trigate}
    >
      {children}
    </motion.div>
  );
}

type StaggerGroupProps = {
  children: ReactNode;
  className?: string;
  step?: number;
  as?: "div" | "ul";
};

/**
 * A layout wrapper inside a `<Stagger>` that does not animate itself but
 * keeps the cascade flowing to its own children, re-staggering them.
 *
 * This exists so orchestration doesn't dictate markup: a section can keep its
 * flex/grid structure and still have label → headline → copy → detail arrive
 * in sequence rather than as one block.
 */
export function StaggerGroup({
  children,
  className,
  step = stagger.step,
  as = "div",
}: StaggerGroupProps) {
  const Component = motion[as];

  return (
    <Component
      className={className}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: step } } }}
    >
      {children}
    </Component>
  );
}

type StaggerItemProps = {
  children: ReactNode;
  className?: string;
  kind?: RevealKind;
  distance?: Distance;
  duration?: number;
  /** Extra hold on top of this item's position in the cascade. */
  delay?: number;
  as?: "div" | "li" | "span" | "p" | "h1" | "h2" | "h3" | "ul" | "article";
  /**
   * Tactile hover response. Must go through the motion system rather than a
   * CSS `hover:` class: this element's transform is owned by Framer, and an
   * inline transform always beats a class-based one.
   */
  hover?: "lift" | "none";
};

/** A child of `<Stagger>`. Inherits the cascade; never watches the viewport itself. */
export function StaggerItem({
  children,
  className,
  kind = "fade",
  distance = "sm",
  duration: dur = duration.base,
  delay = 0,
  as = "div",
  hover = "none",
}: StaggerItemProps) {
  const { getDurationScale } = useScrollEngine();
  const Component = motion[as];

  return (
    <Component
      className={className}
      variants={buildVariants({
        kind,
        distance,
        dur,
        delay,
        getScale: getDurationScale,
      })}
      whileHover={hover === "lift" ? { y: -3 } : undefined}
      transition={
        hover === "lift"
          ? { duration: duration.hover, ease: ease.tactile }
          : undefined
      }
    >
      {children}
    </Component>
  );
}
