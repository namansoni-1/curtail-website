"use client";

import Link from "next/link";
import { motion, useSpring, useTransform } from "framer-motion";
import { type MouseEvent } from "react";
import { Mark } from "./Mark";
import {
  spring,
  useScrollEngine,
  useSettledReducedMotion,
} from "@/components/motion";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#architecture", label: "How it works" },
  { href: "#benefits", label: "Benefits" },
];

/** Scroll distance over which the bar fully settles into its scrolled state. */
const SETTLE = 120;

export function Navbar() {
  const { scrollY, scrollTo } = useScrollEngine();
  // Settled, not Framer's render-time hook: this decides whether a `style`
  // attribute is emitted at all, so it must agree with the server's HTML.
  const reducedMotion = useSettledReducedMotion();

  // One spring feeds every property, so height, tint, border and shadow can
  // never drift out of phase with each other — the bar reads as one object
  // responding to scroll rather than four properties animating separately.
  const settle = useSpring(
    useTransform(scrollY, [0, SETTLE], [0, 1], { clamp: true }),
    spring.chrome,
  );

  const height = useTransform(settle, [0, 1], [64, 54]);
  const tint = useTransform(settle, [0, 1], [0.55, 1]);
  const borderOpacity = useTransform(settle, [0, 1], [0, 0.06]);
  const shadowOpacity = useTransform(settle, [0, 1], [0, 0.06]);

  function handleAnchor(event: MouseEvent<HTMLAnchorElement>, href: string) {
    // Route in-page jumps through the scroll engine so they share the page's
    // easing instead of teleporting. Modified clicks keep native behavior.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    const target = document.querySelector(href);
    if (!target) return;
    event.preventDefault();
    scrollTo(href);
    history.replaceState(null, "", href);
  }

  return (
    // `h-16` is the server-rendered height; the motion value takes over on
    // hydration at the same 64px, so there is no jump.
    <motion.header
      className="fixed top-0 z-50 h-16 w-full"
      style={reducedMotion ? undefined : { height }}
    >
      {/* Frosted backdrop as its own layer: cross-fading a fixed-radius blur
          is compositor-only, whereas interpolating the blur radius itself
          forces the backdrop to re-rasterize every frame. */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-paper/80 backdrop-blur-xl"
        style={reducedMotion ? undefined : { opacity: tint }}
      />
      <motion.div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-px bg-ink"
        style={reducedMotion ? { opacity: 0.06 } : { opacity: borderOpacity }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -bottom-6 h-6 bg-[linear-gradient(to_bottom,rgba(12,11,10,0.5),transparent)]"
        style={reducedMotion ? { opacity: 0 } : { opacity: shadowOpacity }}
      />

      <nav className="relative mx-auto flex h-full max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="group flex items-center gap-2.5 transition-opacity duration-[var(--dur-hover)] ease-[var(--ease-tactile)] hover:opacity-70"
        >
          <Mark />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Curtail
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(event) => handleAnchor(event, link.href)}
              className="group relative text-sm text-gray-500 transition-colors duration-[var(--dur-hover)] ease-[var(--ease-tactile)] hover:text-ink"
            >
              {link.label}
              <span
                aria-hidden="true"
                className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-signal transition-transform duration-[280ms] ease-[var(--ease-out)] group-hover:scale-x-100"
              />
            </a>
          ))}
          <Link
            href="/replay"
            className="group relative text-sm text-gray-500 transition-colors duration-[var(--dur-hover)] ease-[var(--ease-tactile)] hover:text-ink"
          >
            Replay
            <span
              aria-hidden="true"
              className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-signal transition-transform duration-[280ms] ease-[var(--ease-out)] group-hover:scale-x-100"
            />
          </Link>
        </div>

        <Link
          href="mailto:founders@curtail.ai"
          className="group flex items-center gap-1.5 text-sm font-medium text-ink transition-opacity duration-[var(--dur-hover)] ease-[var(--ease-tactile)] hover:opacity-70"
        >
          Request access
          <span
            aria-hidden="true"
            className="transition-transform duration-[var(--dur-hover)] ease-[var(--ease-tactile)] group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      </nav>
    </motion.header>
  );
}
