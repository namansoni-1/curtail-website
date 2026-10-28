"use client";

import Lenis from "lenis";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { MotionConfig, motionValue, type MotionValue } from "framer-motion";
import { durationScaleFor } from "./tokens";

/**
 * The page's scroll engine.
 *
 * One Lenis instance, driven by one requestAnimationFrame loop, which is also
 * the only place per-frame scroll state is published. Everything downstream
 * (reveals, parallax, the navbar) reads a motion value or a ref written here,
 * so scrolling the page causes zero React re-renders.
 *
 * Lenis interpolates toward the real scroll position and commits it with
 * `scrollTo`, so native scroll events still fire — `useScroll`, `position:
 * sticky` and IntersectionObserver all keep working untouched.
 */

type ScrollContextValue = {
  /** Current scroll offset in px, as a motion value. */
  scrollY: MotionValue<number>;
  /** Duration multiplier for an animation starting now, from current scroll speed. */
  getDurationScale: () => number;
  /** Programmatic scroll routed through Lenis so it shares the page's easing. */
  scrollTo: (target: string | number | HTMLElement) => void;
};

const ScrollContext = createContext<ScrollContextValue | null>(null);

export function useScrollEngine() {
  const ctx = useContext(ScrollContext);
  if (!ctx) {
    throw new Error("useScrollEngine must be used inside <ScrollProvider>");
  }
  return ctx;
}

/** Height of the fixed navbar, so anchored sections don't land underneath it. */
const ANCHOR_OFFSET = -72;

export function ScrollProvider({ children }: { children: ReactNode }) {
  const lenisRef = useRef<Lenis | null>(null);
  // Smoothed |velocity| in px/frame. A ref, not state or a motion value:
  // it is sampled at the instant a reveal fires and never rendered.
  const velocityRef = useRef(0);

  const scrollY = useMemo(() => motionValue(0), []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    let raf = 0;
    let lenis: Lenis | null = null;

    function start() {
      lenis = new Lenis({
        // Interpolation strength per frame. 0.1 is the balance point between
        // "connected to the wheel" and "smoothed" — lower feels floaty and
        // laggy, higher stops smoothing at all.
        lerp: 0.1,
        wheelMultiplier: 1,
        // Touch devices already have excellent native inertia; hijacking it
        // makes phones feel worse, not better.
        syncTouch: false,
        touchMultiplier: 1.6,
        // Lenis eases in-page anchor jumps. Native `scroll-behavior: smooth`
        // is deliberately absent from the CSS so the two cannot fight.
        anchors: true,
        // Nested scrollers opt out with `data-lenis-prevent`, which Lenis
        // checks natively while walking the event's composed path.
        autoRaf: false,
      });

      lenisRef.current = lenis;

      const frame = (time: number) => {
        lenis?.raf(time);

        // Raw Lenis velocity is spiky enough that sampling it directly would
        // make two reveals firing a frame apart pick noticeably different
        // durations. Low-pass it so the signal is stable.
        const v = Math.abs(lenis?.velocity ?? 0);
        velocityRef.current += (v - velocityRef.current) * 0.12;

        // Writing an identical value still notifies every subscriber.
        const y = lenis?.scroll ?? 0;
        if (Math.abs(y - scrollY.get()) > 0.05) scrollY.set(y);

        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      lenis?.destroy();
      lenis = null;
      lenisRef.current = null;
      velocityRef.current = 0;
    }

    function sync() {
      // Reduced motion gets no interpolation layer at all: native scrolling
      // is instant and fully usable, which is the point.
      if (media.matches) {
        if (lenis) stop();
      } else if (!lenis) {
        start();
      }
    }

    sync();
    media.addEventListener("change", sync);

    return () => {
      media.removeEventListener("change", sync);
      if (lenis) stop();
    };
  }, [scrollY]);

  const value = useMemo<ScrollContextValue>(
    () => ({
      scrollY,
      getDurationScale: () => durationScaleFor(velocityRef.current),
      scrollTo: (target) => {
        const lenis = lenisRef.current;
        if (lenis) {
          lenis.scrollTo(target, { offset: ANCHOR_OFFSET });
          return;
        }
        // Reduced motion, or a click landing before hydration finishes.
        const node =
          typeof target === "string" ? document.querySelector(target) : target;
        if (node instanceof HTMLElement) {
          window.scrollTo(0, node.getBoundingClientRect().top + window.scrollY + ANCHOR_OFFSET);
        } else if (typeof target === "number") {
          window.scrollTo(0, target);
        }
      },
    }),
    [scrollY],
  );

  return (
    <ScrollContext.Provider value={value}>
      {/*
        `reducedMotion="user"` is what enforces the accessibility contract for
        declarative animation: Framer drops transform and layout animations for
        users who ask for reduced motion, and keeps opacity.

        It is also the only correct option for a server-rendered page. The
        server cannot know a visitor's motion preference, so branching the
        component tree on Framer's `useReducedMotion()` — which reads
        `matchMedia` during render — makes the client's first render
        structurally disagree with the server's HTML. Handling it inside Framer
        keeps one tree for everyone. Where a component genuinely must branch
        its output, `useSettledReducedMotion` does it hydration-safely.
      */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </ScrollContext.Provider>
  );
}
