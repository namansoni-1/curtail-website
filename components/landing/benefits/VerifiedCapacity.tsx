"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useInView } from "../useInView";
import { useStageLoop } from "../useStageLoop";
import { Ticker } from "../console/parts";

const EASE = [0.16, 1, 0.3, 1] as const;

const CANDIDATES = [
  { id: "ATL-01", name: "Northwind AI", mw: 8.2, clears: true, reason: "Cooling headroom" },
  { id: "ATL-02", name: "Meridian Cloud", mw: 5.4, clears: true, reason: "Thermal storage" },
  { id: "ATL-03", name: "Halcyon Systems", mw: 5.8, clears: true, reason: "Deferrable jobs" },
  { id: "ATL-05", name: "Kestrel Data", mw: 0, clears: false, reason: "Maintenance window" },
];

// stage 0 request · 1 verification opens · 2-5 tenants resolve · 6 total · 7 commit
const STAGES = [1300, 800, 700, 700, 700, 800, 900, 2400] as const;
const REQUESTED = 22.0;

export function VerifiedCapacity() {
  const { ref, inView } = useInView<HTMLDivElement>("-40px");
  const stage = useStageLoop(STAGES, inView);

  const resolved = Math.max(0, Math.min(CANDIDATES.length, stage - 1));
  const verified = CANDIDATES.slice(0, resolved).reduce((sum, c) => sum + c.mw, 0);
  const committed = stage >= 7;

  return (
    <div ref={ref} className="flex flex-col items-center gap-0 px-4 py-6 sm:px-8">
      {/* request */}
      <Card
        label="Grid request"
        active={stage >= 0}
        className="w-full max-w-[22rem]"
      >
        <p className="text-2xl font-semibold text-ink">
          {REQUESTED.toFixed(1)}
          <span className="ml-1.5 text-sm font-medium text-gray-400">MW requested</span>
        </p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.12em] text-gray-400 uppercase">
          DR-4471 / PJM RTO
        </p>
      </Card>

      <Connector active={stage >= 1} />

      {/* verification */}
      <div
        className={`w-full max-w-[22rem] rounded-lg border transition-colors duration-500 ${
          stage >= 1 && stage < 6
            ? "border-signal/30 bg-signal/[0.03]"
            : "border-ink/[0.08] bg-paper"
        }`}
      >
        <div className="flex items-center justify-between border-b border-ink/[0.06] px-3.5 py-2">
          <span className="font-mono text-[10px] tracking-[0.16em] text-gray-400 uppercase">
            Verification
          </span>
          <span className="font-mono text-[10px] tabular-nums text-gray-400">
            {resolved} / {CANDIDATES.length}
          </span>
        </div>

        <div className="divide-y divide-ink/[0.05]">
          {CANDIDATES.map((c, i) => {
            const done = i < resolved;
            const working = stage >= 1 && i === resolved && stage < 6;
            return (
              <div
                key={c.id}
                className="flex items-center justify-between gap-3 px-3.5 py-2 transition-opacity duration-300"
                style={{ opacity: done || working ? 1 : 0.4 }}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-ink">{c.name}</p>
                  <p className="font-mono text-[10px] text-gray-400">{c.reason}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`font-mono text-[11px] tabular-nums ${
                      done && c.clears ? "text-signal-dim" : "text-gray-400"
                    }`}
                  >
                    {c.mw > 0 ? `+${c.mw.toFixed(1)}` : "0.0"}
                  </span>
                  <Verdict done={done} working={working} clears={c.clears} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Connector active={stage >= 6} />

      {/* verified total */}
      <Card label="Verified capacity" active={stage >= 6} className="w-full max-w-[22rem]">
        <p className="text-2xl font-semibold text-signal-dim">
          <Ticker value={verified} decimals={1} />
          <span className="ml-1.5 text-sm font-medium text-gray-400">MW verified</span>
        </p>
        <div className="mt-2.5 flex h-1.5 w-full gap-[2px] overflow-hidden rounded-full bg-ink/[0.06]">
          {CANDIDATES.filter((c) => c.mw > 0).map((c, i) => (
            <motion.span
              key={c.id}
              className="h-full rounded-full bg-signal"
              initial={false}
              animate={{ width: i < resolved ? `${(c.mw / REQUESTED) * 100}%` : "0%" }}
              transition={{ duration: 0.5, ease: EASE }}
            />
          ))}
        </div>
      </Card>

      <div className="mt-4 h-8">
        <AnimatePresence>
          {committed && (
            <motion.div
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="relative flex items-center gap-2 rounded-full border border-signal/30 bg-signal/[0.08] px-3.5 py-1.5"
            >
              <motion.span
                className="absolute inset-0 rounded-full border border-signal"
                initial={{ opacity: 0.6, scale: 1 }}
                animate={{ opacity: 0, scale: 1.15 }}
                transition={{ duration: 1.1, ease: "easeOut" }}
              />
              <Check />
              <span className="font-mono text-[10px] tracking-[0.16em] text-signal-dim uppercase">
                Commit confirmed
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Card({
  label,
  active,
  children,
  className = "",
}: {
  label: string;
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border bg-paper px-3.5 py-3 transition-colors duration-500 ${
        active ? "border-ink/15" : "border-ink/[0.07]"
      } ${className}`}
    >
      <p className="mb-1.5 font-mono text-[10px] tracking-[0.16em] text-gray-400 uppercase">
        {label}
      </p>
      {children}
    </div>
  );
}

/** Vertical link between stages, with a pulse that runs once it opens. */
function Connector({ active }: { active: boolean }) {
  return (
    <div className="relative h-7 w-px overflow-hidden bg-ink/10">
      <motion.span
        className="absolute inset-x-0 top-0 h-3 bg-signal"
        initial={false}
        animate={active ? { y: [-12, 28] } : { y: -12 }}
        transition={{ duration: 1.1, repeat: active ? Infinity : 0, ease: "easeInOut" }}
      />
    </div>
  );
}

function Verdict({
  done,
  working,
  clears,
}: {
  done: boolean;
  working: boolean;
  clears: boolean;
}) {
  if (working) {
    return (
      <motion.span
        className="h-3.5 w-3.5 rounded-full border-2 border-signal/30 border-t-signal"
        animate={{ rotate: 360 }}
        transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }}
      />
    );
  }
  if (!done) {
    return <span className="h-3.5 w-3.5 rounded-full border border-dashed border-gray-300" />;
  }
  return clears ? (
    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-signal">
      <Check light />
    </span>
  ) : (
    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-gray-300">
      <svg viewBox="0 0 10 10" className="h-2 w-2 stroke-gray-400" strokeWidth={1.6}>
        <path d="M2 2 L8 8 M8 2 L2 8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function Check({ light = false }: { light?: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={`h-2.5 w-2.5 ${light ? "stroke-paper" : "stroke-signal"}`}
      fill="none"
      strokeWidth={2}
    >
      <path d="M2 6.5 L4.8 9 L10 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
