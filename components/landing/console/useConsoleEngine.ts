"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionValue, useReducedMotion } from "framer-motion";
import {
  PHASE_ENTRY,
  SIM_START_SECONDS,
  TIMELINE,
  type World,
} from "./engine";

const LAST = TIMELINE.length - 1;

/**
 * Drives the console timeline. React re-renders once per step, not per
 * frame: the sub-step progress everything scrubs against lives in a motion
 * value, and the clock reads a ref.
 */
export function useConsoleEngine(active: boolean) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const progress = useMotionValue(0);
  const stepElapsed = useRef(0);
  const simSeconds = useRef(SIM_START_SECONDS);
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  const seek = useCallback(
    (next: number) => {
      const clamped = ((next % TIMELINE.length) + TIMELINE.length) % TIMELINE.length;
      stepElapsed.current = 0;
      progress.set(0);
      simSeconds.current = SIM_START_SECONDS + TIMELINE[clamped].at;
      setIndex(clamped);
    },
    [progress],
  );

  const seekPhase = useCallback(
    (phase: number) => {
      const entry = PHASE_ENTRY[phase];
      if (entry >= 0) seek(entry);
    },
    [seek],
  );

  const toggle = useCallback(() => setPaused((p) => !p), []);

  // Reduced motion holds the settled end state and never runs the loop.
  useEffect(() => {
    if (reducedMotion) progress.set(1);
  }, [reducedMotion, progress]);

  const running = active && !paused && !reducedMotion;
  const current = reducedMotion ? LAST : index;

  useEffect(() => {
    if (!running) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - last, 120); // a backgrounded tab must not jump
      last = now;

      const step = TIMELINE[indexRef.current];
      stepElapsed.current += dt;
      simSeconds.current += dt / 1000;

      if (stepElapsed.current >= step.ms) {
        stepElapsed.current = 0;
        const next = indexRef.current === LAST ? 0 : indexRef.current + 1;
        if (next === 0) simSeconds.current = SIM_START_SECONDS;
        indexRef.current = next;
        progress.set(0);
        setIndex(next);
      } else {
        progress.set(stepElapsed.current / step.ms);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, progress]);

  const step = TIMELINE[current];

  return {
    index: current,
    step,
    world: step.world as World,
    phase: step.phase,
    caption: step.caption,
    progress,
    paused: paused || reducedMotion === true,
    playing: running,
    toggle,
    seekPhase,
    getSimSeconds: useCallback(() => simSeconds.current, []),
  };
}

export type ConsoleEngine = ReturnType<typeof useConsoleEngine>;
