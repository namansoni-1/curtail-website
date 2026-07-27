"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Chip, Dot, EASE, Meter, Panel, Ticker } from "./parts";
import {
  REQUESTED_MW,
  type Tenant,
  type TenantStatus,
  type World,
} from "./engine";

type Hover = {
  hovered: string | null;
  setHovered: (id: string | null) => void;
};

const STATUS_COPY: Record<TenantStatus, string> = {
  idle: "Standby",
  checking: "Checking",
  verifying: "Verifying",
  verified: "Verified",
  delivering: "Delivering",
  settled: "Paid",
  excluded: "Excluded",
  "opted-out": "Opted out",
};

const ACTIVE: TenantStatus[] = ["verified", "delivering", "settled"];

/* -------------------------------------------------------------- status strip */

export function StatusStrip({ world }: { world: World }) {
  const live = world.gridSignal !== "Nominal";

  return (
    <div className="grid grid-cols-2 divide-ink/[0.06] border-b border-ink/[0.06] sm:grid-cols-4 sm:divide-x">
      <Readout label="Grid signal">
        <span className="flex items-center gap-2">
          <Dot tone={live ? "signal" : "muted"} pulse={live} />
          <span className={live ? "text-ink" : "text-gray-500"}>{world.gridSignal}</span>
        </span>
        <div className="mt-2.5 w-24">
          <Meter value={world.gridLoad} tone={live ? "signal" : "ink"} />
        </div>
      </Readout>

      <Readout label="Dispatch queue">
        <span className="tabular-nums text-ink">{world.queue}</span>
        <span className="ml-1.5 text-xs text-gray-400">
          {world.queue === 1 ? "open request" : "open requests"}
        </span>
      </Readout>

      <Readout label="Response window">
        <span className="text-ink">{world.request ? world.request.window : "None"}</span>
      </Readout>

      <Readout label="Verification">
        <span className="tabular-nums text-ink">
          {world.tenants.filter((t) => ACTIVE.includes(t.status)).length}
        </span>
        <span className="ml-1.5 text-xs text-gray-400">
          of {world.tenants.filter((t) => t.enrolled).length} tenants cleared
        </span>
      </Readout>
    </div>
  );
}

function Readout({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-3">
      <p className="font-mono text-[9px] tracking-[0.16em] text-gray-400 uppercase">
        {label}
      </p>
      <div className="mt-1.5 text-sm font-medium text-gray-600">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- metric tiles */

export function MetricTiles({ world }: { world: World }) {
  const tiles = [
    {
      label: "Available flexibility",
      value: <Ticker value={world.availableFlex} decimals={1} />,
      unit: "MW",
      sub: `${world.tenants.filter((t) => t.enrolled).length} enrolled tenants`,
    },
    {
      label: "Committed today",
      value: <Ticker value={world.committedToday} decimals={1} />,
      unit: "MW",
      sub: `${world.eventsToday} dispatch events`,
      accent: true,
    },
    {
      label: "Participation rate",
      value: <Ticker value={world.participation} />,
      unit: "%",
      sub: "Verified of requested",
    },
    {
      label: "Flexibility payments",
      value: <Ticker value={world.payments} prefix="$" />,
      unit: "",
      sub: "This cycle",
    },
  ];

  return (
    <div className="grid grid-cols-2 divide-ink/[0.06] border-b border-ink/[0.06] sm:grid-cols-4 sm:divide-x">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="group px-3.5 py-3.5 transition-colors duration-300 hover:bg-gray-50/70"
        >
          <p className="font-mono text-[9px] tracking-[0.16em] text-gray-400 uppercase">
            {tile.label}
          </p>
          <p
            className={`mt-1.5 text-2xl font-semibold ${tile.accent ? "text-signal-dim" : "text-ink"}`}
          >
            {tile.value}
            {tile.unit && (
              <span className="ml-1 text-sm font-medium text-gray-400">{tile.unit}</span>
            )}
          </p>
          <p className="mt-1 text-[11px] text-gray-400">{tile.sub}</p>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------- request panel */

const SEGMENT_TONE = "bg-signal";

export function RequestPanel({ world, hovered, setHovered }: { world: World } & Hover) {
  const request = world.request;
  const contributors = world.tenants.filter((t) => t.offered > 0);
  const pct = world.verified / REQUESTED_MW;

  return (
    <Panel
      title="Active dispatch request"
      right={
        <Chip tone={request ? "signal" : "muted"}>
          {request && world.requestStatus !== "Settled" && <Dot pulse />}
          {world.requestStatus}
        </Chip>
      }
      bodyClassName="p-3.5 min-h-[206px]"
    >
      <AnimatePresence mode="wait" initial={false}>
        {!request ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex h-[178px] flex-col items-center justify-center gap-3"
          >
            <div className="relative h-px w-40 overflow-hidden bg-ink/[0.08]">
              <motion.div
                className="absolute inset-y-0 w-10 bg-signal"
                animate={{ x: [-40, 160] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
            <p className="text-sm text-gray-400">Listening for grid signals</p>
          </motion.div>
        ) : (
          <motion.div
            key="request"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: EASE }}
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] tracking-[0.1em] text-gray-400">
                  {request.id} <span className="text-gray-300">/</span> {request.source}
                </p>
                <p className="mt-1 text-[28px] leading-none font-semibold text-ink">
                  {request.requested.toFixed(1)}
                  <span className="ml-1.5 text-sm font-medium text-gray-400">MW requested</span>
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-[9px] tracking-[0.16em] text-gray-400 uppercase">
                  Verified
                </p>
                <p className="mt-1 text-[28px] leading-none font-semibold text-signal-dim">
                  <Ticker value={world.verified} decimals={1} />
                  <span className="ml-1.5 text-sm font-medium text-gray-400">MW</span>
                </p>
              </div>
            </div>

            <div className="mt-5 flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-ink/[0.06]">
              {contributors.map((t) => (
                <motion.div
                  key={t.id}
                  className={`h-full rounded-full ${SEGMENT_TONE}`}
                  initial={{ width: 0, opacity: 0 }}
                  animate={{
                    width: `${(t.offered / REQUESTED_MW) * 100}%`,
                    opacity: hovered && hovered !== t.id ? 0.35 : 1,
                  }}
                  transition={{ duration: 0.6, ease: EASE }}
                  onMouseEnter={() => setHovered(t.id)}
                  onMouseLeave={() => setHovered(null)}
                />
              ))}
            </div>

            <div className="mt-2 flex items-center justify-between font-mono text-[10px] tracking-[0.12em] text-gray-400 uppercase">
              <span>
                <span className="text-signal-dim">{Math.round(pct * 100)}%</span> of request
                covered
              </span>
              <span>{contributors.length} tenants</span>
            </div>

            <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-ink/[0.06] pt-3.5">
              <Field label="Window" value={request.window} />
              <Field label="Response due" value="14:34:00" />
              <Field
                label="Shortfall"
                value={`${(REQUESTED_MW - world.verified).toFixed(1)} MW`}
              />
            </dl>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[9px] tracking-[0.16em] text-gray-400 uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-xs text-gray-600">{value}</dd>
    </div>
  );
}

/* --------------------------------------------------------------- tenant panel */

export function TenantPanel({ world, hovered, setHovered }: { world: World } & Hover) {
  return (
    <Panel
      title="Tenant permissions"
      right={
        <span className="font-mono text-[10px] text-gray-400">
          {world.tenants.length} contracts
        </span>
      }
      bodyClassName="divide-y divide-ink/[0.05]"
    >
      {world.tenants.map((t) => (
        <TenantRow
          key={t.id}
          tenant={t}
          dimmed={hovered !== null && hovered !== t.id}
          onHover={setHovered}
        />
      ))}
    </Panel>
  );
}

function TenantRow({
  tenant,
  dimmed,
  onHover,
}: {
  tenant: Tenant;
  dimmed: boolean;
  onHover: (id: string | null) => void;
}) {
  const inactive = tenant.status === "opted-out" || tenant.status === "excluded";
  const cleared = ACTIVE.includes(tenant.status);
  const working = tenant.status === "checking" || tenant.status === "verifying";

  return (
    <div
      className="relative px-3.5 py-2.5 transition-colors duration-300 hover:bg-gray-50/80"
      style={{ opacity: dimmed ? 0.45 : inactive ? 0.55 : 1, transition: "opacity 300ms" }}
      onMouseEnter={() => onHover(tenant.id)}
      onMouseLeave={() => onHover(null)}
    >
      {/* One pulse of signal wash the moment a tenant clears. */}
      <AnimatePresence>
        {cleared && (
          <motion.span
            key={tenant.status}
            className="pointer-events-none absolute inset-0 bg-signal"
            initial={{ opacity: 0.14 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.1, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{tenant.name}</p>
          <p className="mt-0.5 font-mono text-[10px] tracking-[0.06em] text-gray-400">
            {tenant.id} <span className="text-gray-300">/</span> {tenant.note}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p
            className={`font-mono text-[11px] tabular-nums ${cleared ? "text-signal-dim" : "text-gray-400"}`}
          >
            {tenant.offered > 0 ? tenant.offered.toFixed(1) : "0.0"}
            <span className="text-gray-300"> / {tenant.cap.toFixed(1)}</span>
          </p>
          <p className="mt-1 flex items-center justify-end gap-1.5 font-mono text-[9px] tracking-[0.1em] uppercase">
            {working && (
              <motion.span
                className="h-1.5 w-1.5 rounded-full bg-signal"
                animate={{ opacity: [1, 0.25, 1] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              />
            )}
            {cleared && <Dot />}
            <span className={cleared ? "text-signal-dim" : "text-gray-400"}>
              {STATUS_COPY[tenant.status]}
            </span>
          </p>
        </div>
      </div>

      <div className="relative mt-2">
        <Meter
          value={tenant.cap > 0 ? tenant.offered / tenant.cap : 0}
          tone={cleared ? "signal" : "ink"}
          height="h-[3px]"
        />
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- event stream */

export function EventStream({ world }: { world: World }) {
  return (
    <Panel
      title="Event stream"
      right={
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-gray-400">
          <Dot pulse />
          Live
        </span>
      }
      bodyClassName="relative h-[188px] overflow-hidden"
    >
      <div className="flex flex-col">
        <AnimatePresence initial={false}>
          {world.events.slice(0, 6).map((event) => (
            <motion.div
              key={event.key}
              layout
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="flex items-start gap-2.5 border-b border-ink/[0.04] px-3.5 py-2 last:border-b-0"
            >
              <span className="mt-[3px] font-mono text-[10px] tabular-nums text-gray-300">
                {event.at}
              </span>
              <span
                className={`text-[12px] leading-snug ${
                  event.kind === "ok"
                    ? "text-signal-dim"
                    : event.kind === "muted"
                      ? "text-gray-400"
                      : "text-gray-600"
                }`}
              >
                {event.text}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-paper to-transparent" />
    </Panel>
  );
}

/* ------------------------------------------------------------- recent history */

export function HistoryStrip({ world }: { world: World }) {
  return (
    <div className="border-t border-ink/[0.06]">
      <div className="flex items-center justify-between px-3.5 pt-3">
        <p className="font-mono text-[10px] tracking-[0.16em] text-gray-400 uppercase">
          Recent dispatches
        </p>
        <span className="font-mono text-[10px] text-gray-300">Last 24h</span>
      </div>
      <div className="grid gap-2 p-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <AnimatePresence initial={false}>
          {world.history.slice(0, 4).map((d) => {
            const live = d.status === "Live";
            const declined = d.status === "Declined";
            return (
              <motion.div
                key={d.id}
                layout
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.45, ease: EASE }}
                className={`rounded-lg border p-3 transition-colors duration-300 hover:border-ink/20 ${
                  live ? "border-signal/30 bg-signal/[0.05]" : "border-ink/[0.08]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] text-gray-500">{d.id}</span>
                  <span className="font-mono text-[10px] text-gray-300">{d.at}</span>
                </div>
                <p className="mt-2 text-sm font-medium text-ink tabular-nums">
                  {d.verified.toFixed(1)}
                  <span className="text-gray-300"> / {d.requested.toFixed(1)} MW</span>
                </p>
                <div className="mt-2.5 flex items-center justify-between gap-2">
                  <Chip tone={declined ? "muted" : live ? "signal" : "ink"}>
                    {live && <Dot pulse />}
                    {d.status}
                  </Chip>
                  <span className="font-mono text-[11px] tabular-nums text-gray-500">
                    {d.payout > 0 ? `$${d.payout.toLocaleString()}` : "$0"}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
