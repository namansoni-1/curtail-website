/**
 * Motion tokens — the single source of truth for how anything on this site
 * moves. Every easing curve, duration, travel distance and spring config
 * lives here so the whole page shares one motion language.
 *
 * The house curve is `ease.out` ([0.16, 1, 0.3, 1]): a strong exponential
 * out with no overshoot. Things arrive quickly, settle without bouncing,
 * and never draw attention to the fact that they moved.
 */

/* ------------------------------------------------------------------ easing */

export const ease = {
  /** House curve. Fast departure, long quiet settle. Entrances, reveals. */
  out: [0.16, 1, 0.3, 1],
  /** Slightly gentler out — for larger travel where `out` reads as abrupt. */
  outSoft: [0.25, 1, 0.5, 1],
  /** Symmetric. State changes that are neither arriving nor leaving. */
  inOut: [0.65, 0, 0.35, 1],
  /** Exits. Leaves quickly rather than lingering. */
  in: [0.5, 0, 0.75, 0],
  /** Hover / tactile feedback. Short, crisp, linear-ish out. */
  tactile: [0.33, 1, 0.68, 1],
} as const;

/** CSS `cubic-bezier()` strings for the same curves, for Tailwind/CSS use. */
export const easeCss = {
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  outSoft: "cubic-bezier(0.25, 1, 0.5, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  in: "cubic-bezier(0.5, 0, 0.75, 0)",
  tactile: "cubic-bezier(0.33, 1, 0.68, 1)",
} as const;

/* --------------------------------------------------------------- durations */

export const duration = {
  /** Micro-feedback: press states, tiny icon shifts. */
  micro: 0.16,
  /** Hover transitions. The 150–250ms band. */
  hover: 0.22,
  /** Small state changes, captions swapping. */
  fast: 0.36,
  /** Default reveal. */
  base: 0.72,
  /** Large elements, hero-scale copy. */
  slow: 0.96,
  /** Chapter-level moves. Used sparingly. */
  cinematic: 1.3,
} as const;

/* ------------------------------------------------------------------ travel */

/** Vertical travel for entrances. Deliberately small — this is a settle, not a slide. */
export const travel = {
  /** Detail rows, list items, small captions. */
  xs: 8,
  /** Default copy and cards. */
  sm: 14,
  /** Headlines and section leads. */
  md: 22,
  /** Full-bleed visuals. */
  lg: 34,
} as const;

export const blur = {
  sm: 4,
  md: 8,
} as const;

/* --------------------------------------------------------- orchestration */

export const stagger = {
  /** Between siblings in a reveal group (headline → sub → copy → detail). */
  step: 0.075,
  /** Tighter, for dense lists where `step` would feel slow. */
  tight: 0.045,
  /** Between large sibling blocks (benefit cards). */
  loose: 0.11,
} as const;

/* ----------------------------------------------------------------- springs */

/**
 * Spring configs for scroll-linked motion. All are critically-ish damped —
 * `damping` is high enough relative to `stiffness` that nothing oscillates.
 */
export const spring = {
  /** Scroll-scrubbed progress. Tracks the wheel closely, smooths jitter. */
  scrub: { stiffness: 220, damping: 36, mass: 0.6 },
  /** Softer scrub for large parallax layers, where lag reads as depth. */
  drift: { stiffness: 90, damping: 28, mass: 0.9 },
  /** Navbar and other chrome that interpolates against scroll offset. */
  chrome: { stiffness: 260, damping: 40, mass: 0.5 },
  /** Scroll velocity signal — heavily smoothed so it never flickers. */
  velocity: { stiffness: 120, damping: 40, mass: 0.8 },
} as const;

/* ---------------------------------------------------------------- viewport */

/**
 * Reveal trigger points, as IntersectionObserver `rootMargin`.
 *
 * Sign matters and is easy to get backwards: a **positive** bottom margin
 * grows the observed root downward past the fold, firing the reveal *before*
 * the element is on screen. A **negative** bottom margin shrinks the root,
 * making the element travel further up before it fires.
 *
 * The old code used a flat `-100px`, so every block waited until it was
 * already well inside the viewport and then appeared — which is exactly the
 * "arrived at another block" feeling. Starting marginally early instead lets
 * a section be mid-entrance as it comes into view, so it overlaps with the
 * one before it.
 */
export const viewport = {
  /** Default: begins just before the element's top edge crosses the fold. */
  early: { once: true, margin: "0px 0px 6% 0px" },
  /** Deeper content that should already be resolving as its section arrives. */
  earlier: { once: true, margin: "0px 0px 16% 0px" },
  /** Large visuals worth watching arrive — waits until genuinely on screen. */
  late: { once: true, margin: "0px 0px -8% 0px" },
} as const;

/* ---------------------------------------------------------------- velocity */

/**
 * Scroll speed above which reveals are considered "being scrolled past" and
 * compress toward `velocityScale.min`. In px/frame as reported by Lenis.
 */
export const VELOCITY_SATURATION = 55;

/**
 * How far a reveal's duration may compress when the user is scrolling fast.
 * Never reaches 0 — motion stays present, it just stops making anyone wait.
 */
export const velocityScale = {
  min: 0.5,
  max: 1,
} as const;

/** Maps a raw scroll velocity (px/frame) to a duration multiplier. */
export function durationScaleFor(velocity: number) {
  const t = Math.min(1, Math.abs(velocity) / VELOCITY_SATURATION);
  return velocityScale.max - (velocityScale.max - velocityScale.min) * t;
}
