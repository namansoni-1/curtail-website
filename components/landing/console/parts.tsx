"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useEffect, type ReactNode } from "react";

export const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * A number that springs to its new value instead of snapping. Updates run
 * inside the motion value, so a counter changing never re-renders its panel.
 */
export function Ticker({
  value,
  decimals = 0,
  prefix = "",
  className = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  className?: string;
}) {
  const raw = useMotionValue(value);
  const spring = useSpring(raw, { stiffness: 90, damping: 18, mass: 0.5 });
  const text = useTransform(spring, (v) => {
    const rounded = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString();
    return `${prefix}${rounded}`;
  });

  useEffect(() => {
    raw.set(value);
  }, [value, raw]);

  return <motion.span className={`tabular-nums ${className}`}>{text}</motion.span>;
}

/** Status light. `pulse` adds the slow expanding ring used for live states. */
export function Dot({
  tone = "signal",
  pulse = false,
  className = "",
}: {
  tone?: "signal" | "ink" | "muted";
  pulse?: boolean;
  className?: string;
}) {
  const fill =
    tone === "signal"
      ? "bg-signal"
      : tone === "ink"
        ? "bg-ink/50"
        : "bg-gray-300";

  return (
    <span className={`relative inline-flex h-1.5 w-1.5 shrink-0 ${className}`}>
      {pulse && (
        <motion.span
          className={`absolute inset-0 rounded-full ${fill}`}
          animate={{ scale: [1, 2.6, 2.6], opacity: [0.55, 0, 0] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
        />
      )}
      <span className={`relative h-1.5 w-1.5 rounded-full ${fill}`} />
    </span>
  );
}

export function Panel({
  title,
  right,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={`group/panel flex flex-col rounded-lg border border-ink/[0.08] bg-paper transition-colors duration-300 hover:border-ink/[0.16] ${className}`}
    >
      <header className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-ink/[0.06] px-3.5">
        <h4 className="font-mono text-[10px] tracking-[0.16em] text-gray-400 uppercase">
          {title}
        </h4>
        {right}
      </header>
      <div className={`flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

const CHIP_TONES = {
  signal: "border-signal/25 bg-signal/[0.08] text-signal-dim",
  ink: "border-ink/12 bg-ink/[0.04] text-gray-600",
  muted: "border-dashed border-ink/12 bg-transparent text-gray-400",
} as const;

export function Chip({
  tone = "ink",
  children,
  className = "",
}: {
  tone?: keyof typeof CHIP_TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-[0.08em] whitespace-nowrap uppercase transition-colors duration-300 ${CHIP_TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Horizontal meter. Track is a lighter step of the same ink the fill uses. */
export function Meter({
  value,
  tone = "signal",
  className = "",
  height = "h-1",
}: {
  value: number;
  tone?: "signal" | "ink";
  className?: string;
  height?: string;
}) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-ink/[0.07] ${height} ${className}`}>
      <motion.div
        className={`h-full rounded-full ${tone === "signal" ? "bg-signal" : "bg-ink/45"}`}
        animate={{ scaleX: Math.max(0, Math.min(1, value)) }}
        initial={false}
        style={{ transformOrigin: "left" }}
        transition={{ duration: 0.7, ease: EASE }}
      />
    </div>
  );
}
