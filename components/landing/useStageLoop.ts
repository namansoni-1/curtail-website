"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Steps through a fixed list of stage durations and loops. Pass a module
 * constant for `durations` so the timer is not rebuilt on every render.
 * Reduced motion holds the last stage, which is always the resolved one.
 */
export function useStageLoop(durations: readonly number[], active: boolean) {
  const reducedMotion = useReducedMotion();
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!active || reducedMotion) return;
    const id = setTimeout(
      () => setStage((s) => (s + 1) % durations.length),
      durations[stage],
    );
    return () => clearTimeout(id);
  }, [stage, active, durations, reducedMotion]);

  return reducedMotion ? durations.length - 1 : stage;
}
