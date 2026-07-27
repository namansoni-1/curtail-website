"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useTransform } from "framer-motion";
import { useInView } from "../useInView";
import { formatClock, PHASES, TIMELINE } from "./engine";
import { useConsoleEngine, type ConsoleEngine } from "./useConsoleEngine";
import { LoadChart } from "./LoadChart";
import {
  EventStream,
  HistoryStrip,
  MetricTiles,
  RequestPanel,
  StatusStrip,
  TenantPanel,
} from "./panels";
import { Dot, EASE } from "./parts";

export function OperatorConsole() {
  const { ref, inView } = useInView<HTMLDivElement>("120px");
  const engine = useConsoleEngine(inView);
  const [hovered, setHovered] = useState<string | null>(null);
  const { world } = engine;

  return (
    <div
      ref={ref}
      className="mx-auto w-full overflow-hidden rounded-xl border border-ink/12 bg-paper shadow-[0_40px_80px_-40px_rgba(12,11,10,0.3)]"
    >
      <Chrome getSimSeconds={engine.getSimSeconds} live={engine.playing} />
      <StatusStrip world={world} />
      <MetricTiles world={world} />

      <div className="grid gap-3 p-3 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-3">
          <RequestPanel world={world} hovered={hovered} setHovered={setHovered} />
          <div className="flex-1 rounded-lg border border-ink/[0.08] transition-colors duration-300 hover:border-ink/[0.16]">
            <LoadChart gridLoad={world.gridLoad} shed={world.shed} live={inView} />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <TenantPanel world={world} hovered={hovered} setHovered={setHovered} />
          <EventStream world={world} />
        </div>
      </div>

      <HistoryStrip world={world} />
      <PlaybackRail engine={engine} />
    </div>
  );
}

/* --------------------------------------------------------------- window chrome */

function Chrome({
  getSimSeconds,
  live,
}: {
  getSimSeconds: () => number;
  live: boolean;
}) {
  return (
    <div className="flex h-11 items-center gap-3 border-b border-ink/[0.07] bg-gray-50 px-4">
      <div className="hidden gap-1.5 sm:flex" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-ink/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink/10" />
      </div>
      <span className="font-mono text-[11px] tracking-wide text-gray-400">
        app.curtail.io<span className="text-gray-300">/dispatch</span>
      </span>
      <span className="ml-auto flex items-center gap-3">
        <span className="hidden rounded border border-ink/[0.08] px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] text-gray-400 uppercase sm:inline">
          PJM RTO
        </span>
        <Clock getSimSeconds={getSimSeconds} />
        <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.14em] text-gray-400 uppercase">
          <Dot pulse={live} tone={live ? "signal" : "muted"} />
          Live
        </span>
      </span>
    </div>
  );
}

function Clock({ getSimSeconds }: { getSimSeconds: () => number }) {
  const [now, setNow] = useState(() => formatClock(getSimSeconds()));

  useEffect(() => {
    const id = setInterval(() => setNow(formatClock(getSimSeconds())), 400);
    return () => clearInterval(id);
  }, [getSimSeconds]);

  return (
    <span className="font-mono text-[11px] tabular-nums text-gray-500">{now}</span>
  );
}

/* -------------------------------------------------------------- playback rail */

function PlaybackRail({ engine }: { engine: ConsoleEngine }) {
  const { phase, index, progress, paused, toggle, seekPhase, caption } = engine;

  // Progress across the whole phase, not the current step, so the pill fills
  // once and evenly however many steps the phase is cut into.
  const phaseSteps = TIMELINE.filter((s) => s.phase === phase);
  const phaseTotal = phaseSteps.reduce((sum, s) => sum + s.ms, 0);
  const phaseStart = TIMELINE.findIndex((s) => s.phase === phase);
  const elapsedBefore = TIMELINE.slice(phaseStart, index).reduce(
    (sum, s) => sum + s.ms,
    0,
  );
  const stepMs = TIMELINE[index].ms;
  const fill = useTransform(progress, (p) => (elapsedBefore + p * stepMs) / phaseTotal);

  return (
    <div className="border-t border-ink/[0.07] bg-gray-50/80 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          aria-label={paused ? "Play simulation" : "Pause simulation"}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-ink/12 bg-paper text-ink transition-all duration-200 hover:border-ink/30 hover:bg-ink hover:text-paper active:scale-95"
        >
          {paused ? (
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 translate-x-[1px] fill-current">
              <path d="M0 0 L10 5 L0 10 Z" />
            </svg>
          ) : (
            <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 fill-current">
              <rect x="1" y="0" width="3" height="10" rx="1" />
              <rect x="6" y="0" width="3" height="10" rx="1" />
            </svg>
          )}
        </button>

        <div className="scrollbar-none -mx-1 flex flex-1 gap-1 overflow-x-auto px-1">
          {PHASES.map((p, i) => {
            const active = i === phase;
            const done = i < phase;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => seekPhase(i)}
                className={`group relative flex shrink-0 items-center gap-1.5 overflow-hidden rounded-md px-2.5 py-1.5 font-mono text-[10px] tracking-[0.1em] whitespace-nowrap uppercase transition-colors duration-200 ${
                  active
                    ? "bg-paper text-ink shadow-[0_1px_2px_rgba(12,11,10,0.06)]"
                    : "text-gray-400 hover:bg-paper/70 hover:text-gray-600"
                }`}
              >
                <span
                  className={`h-1 w-1 rounded-full transition-colors duration-300 ${
                    active || done ? "bg-signal" : "bg-gray-300"
                  }`}
                />
                {p.label}
                {active && (
                  <motion.span
                    className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-signal"
                    style={{ scaleX: fill }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 h-4 px-1">
        <AnimatePresence mode="wait">
          <motion.p
            key={caption}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="text-[11px] text-gray-400"
          >
            {caption}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}
