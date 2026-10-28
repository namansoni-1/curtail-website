"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

const getSnapshot = () => window.matchMedia(QUERY).matches;

/** The server has no media queries; assume full motion and correct after hydration. */
const getServerSnapshot = () => false;

/**
 * A reduced-motion preference that is safe to branch **rendered output** on.
 *
 * Framer's `useReducedMotion` reads `matchMedia` during render. On the server
 * that is always `false`, but on a reduced-motion visitor's first client
 * render it is `true` — so any component choosing different markup, text or
 * style values from it disagrees with the HTML it is hydrating, and React
 * throws that subtree away and re-renders it.
 *
 * `useSyncExternalStore` is the primitive built for this: React uses
 * `getServerSnapshot` for the hydration render so it matches the server, then
 * immediately re-renders with the real value. Components settle into their
 * reduced-motion state one frame later, which for the self-running visuals on
 * this page means jumping to their resolved end state — the intent anyway.
 *
 * As a bonus over Framer's hook, this one actually responds to the preference
 * changing at runtime.
 *
 * For animation *values* rather than rendered output, prefer Framer's
 * `useReducedMotion`, or let `<MotionConfig reducedMotion="user">` in
 * `ScrollProvider` handle it declaratively.
 */
export function useSettledReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
