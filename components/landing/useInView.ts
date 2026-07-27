"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Tracks whether an element is on screen. Every self-running animation on
 * the page gates its loop on this, so nothing burns frames off screen.
 */
export function useInView<T extends HTMLElement>(margin = "0px") {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: margin, threshold: 0.01 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [margin]);

  return { ref, inView };
}
