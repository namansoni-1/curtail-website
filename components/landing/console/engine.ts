// The dispatch simulation that the operator console plays back.
//
// The whole cycle is precomputed at module load as an array of immutable
// world snapshots. Nothing here reads the clock or Math.random, so server
// and client render byte-identical output, and seeking to any step is a
// plain array index instead of a replay.

export type TenantStatus =
  | "idle"
  | "checking"
  | "verifying"
  | "verified"
  | "delivering"
  | "settled"
  | "excluded"
  | "opted-out";

export type Tenant = {
  id: string;
  name: string;
  cap: number;
  enrolled: boolean;
  status: TenantStatus;
  offered: number;
  note: string;
  paid: number;
};

export type EventKind = "info" | "signal" | "ok" | "muted";

export type LogEvent = {
  key: string;
  at: string;
  text: string;
  kind: EventKind;
};

export type Dispatch = {
  id: string;
  at: string;
  requested: number;
  verified: number;
  payout: number;
  status: "Settled" | "Declined" | "Live";
};

export type RequestStatus =
  | "Awaiting signal"
  | "Received"
  | "Checking permissions"
  | "Verifying"
  | "Committed"
  | "Delivering"
  | "Settled";

export type GridSignal = "Nominal" | "Elevated" | "Dispatch" | "Clearing";

export type World = {
  gridSignal: GridSignal;
  /** 0..1 stress on the grid signal meter. */
  gridLoad: number;
  queue: number;
  requestStatus: RequestStatus;
  request: {
    id: string;
    source: string;
    requested: number;
    window: string;
  } | null;
  /** MW cleared by verification so far. */
  verified: number;
  committed: number;
  /** 0..1 of the site load curve currently being shed. */
  shed: number;
  availableFlex: number;
  committedToday: number;
  eventsToday: number;
  participation: number;
  payments: number;
  tenants: Tenant[];
  events: LogEvent[];
  history: Dispatch[];
};

export type Step = {
  /** Index into PHASES. */
  phase: number;
  ms: number;
  /** Line shown under the phase rail while this step runs. */
  caption: string;
  world: World;
  /** Sim seconds elapsed at the start of this step. */
  at: number;
};

export const PHASES = [
  { id: "standby", label: "Standby" },
  { id: "signal", label: "Grid signal" },
  { id: "request", label: "Request" },
  { id: "permissions", label: "Permissions" },
  { id: "verify", label: "Verification" },
  { id: "commit", label: "Commit" },
  { id: "dispatch", label: "Dispatch" },
  { id: "settle", label: "Settlement" },
] as const;

export const REQUESTED_MW = 22.0;
export const VERIFIED_MW = 19.4;
export const EVENT_PAYOUT = 2910;

const BASE_SECONDS = 14 * 3600 + 31 * 60 + 48; // 14:31:48

export function formatClock(seconds: number) {
  const s = Math.floor(seconds) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function tenant(
  id: string,
  name: string,
  cap: number,
  enrolled: boolean,
  note: string,
): Tenant {
  return {
    id,
    name,
    cap,
    enrolled,
    status: enrolled ? "idle" : "opted-out",
    offered: 0,
    note,
    paid: 0,
  };
}

const TENANTS: Tenant[] = [
  tenant("ATL-01", "Northwind AI", 12.0, true, "Cooling + batch"),
  tenant("ATL-02", "Meridian Cloud", 8.5, true, "Thermal storage"),
  tenant("ATL-03", "Halcyon Systems", 15.0, true, "Deferrable jobs"),
  tenant("ATL-05", "Kestrel Data", 6.0, true, "Maintenance window"),
  tenant("ATL-04", "Vector Labs", 9.0, false, "Not enrolled"),
];

const OFFERS: Record<string, number> = {
  "ATL-01": 8.2,
  "ATL-02": 5.4,
  "ATL-03": 5.8,
};

const PAYOUTS: Record<string, number> = {
  "ATL-01": 920,
  "ATL-02": 610,
  "ATL-03": 650,
};

const INITIAL: World = {
  gridSignal: "Nominal",
  gridLoad: 0.34,
  queue: 0,
  requestStatus: "Awaiting signal",
  request: null,
  verified: 0,
  committed: 0,
  shed: 0,
  availableFlex: 41.5,
  committedToday: 27.4,
  eventsToday: 2,
  participation: 91,
  payments: 18240,
  tenants: TENANTS,
  events: [
    { key: "seed-3", at: "14:05:02", text: "Heartbeat OK. 4 tenants reporting.", kind: "muted" },
    { key: "seed-2", at: "13:47:19", text: "DR-4468 settled. $1,180 posted.", kind: "muted" },
    { key: "seed-1", at: "11:05:41", text: "DR-4468 committed at 8.0 MW.", kind: "muted" },
  ],
  history: [
    { id: "DR-4468", at: "11:05", requested: 8.0, verified: 8.0, payout: 1180, status: "Settled" },
    { id: "DR-4462", at: "09:12", requested: 5.0, verified: 0, payout: 0, status: "Declined" },
    { id: "DR-4455", at: "Yest 16:47", requested: 30.0, verified: 24.1, payout: 3620, status: "Settled" },
  ],
};

type Patch = (world: World, at: string) => World;

type StepDef = {
  phase: number;
  ms: number;
  caption: string;
  patch?: Patch;
};

function setTenant(world: World, id: string, next: Partial<Tenant>): World {
  return {
    ...world,
    tenants: world.tenants.map((t) => (t.id === id ? { ...t, ...next } : t)),
  };
}

function log(world: World, at: string, text: string, kind: EventKind): World {
  return {
    ...world,
    events: [{ key: `${at}-${text}`, at, text, kind }, ...world.events].slice(0, 8),
  };
}

/** Verification of one tenant: it clears, and its MW join the verified total. */
function verifyStep(id: string, caption: string): StepDef[] {
  const mw = OFFERS[id];
  return [
    {
      phase: 4,
      ms: 620,
      caption,
      patch: (w) => setTenant(w, id, { status: "verifying" }),
    },
    {
      phase: 4,
      ms: 780,
      caption,
      patch: (w, at) => {
        const next = setTenant(w, id, { status: "verified", offered: mw });
        const verified = Math.round((next.verified + mw) * 10) / 10;
        const name = TENANTS.find((t) => t.id === id)?.name ?? id;
        return log(
          { ...next, verified },
          at,
          `${name} verified at ${mw.toFixed(1)} MW.`,
          "ok",
        );
      },
    },
  ];
}

const STEP_DEFS: StepDef[] = [
  {
    phase: 0,
    ms: 3200,
    caption: "Monitoring the PJM feed. No open requests.",
  },
  {
    phase: 1,
    ms: 1500,
    caption: "Grid frequency drifts. Signal moves to elevated.",
    patch: (w, at) =>
      log(
        { ...w, gridSignal: "Elevated", gridLoad: 0.72 },
        at,
        "PJM signal elevated. Reserve margin 4.1%.",
        "signal",
      ),
  },
  {
    phase: 2,
    ms: 1900,
    caption: "A dispatch request lands in the queue.",
    patch: (w, at) =>
      log(
        {
          ...w,
          queue: 1,
          requestStatus: "Received",
          gridLoad: 0.81,
          request: {
            id: "DR-4471",
            source: "PJM RTO",
            requested: REQUESTED_MW,
            window: "14:35 to 15:20",
          },
        },
        at,
        `DR-4471 received. ${REQUESTED_MW.toFixed(1)} MW requested.`,
        "signal",
      ),
  },
  {
    phase: 3,
    ms: 900,
    caption: "Curtail checks what each tenant has permitted.",
    patch: (w, at) =>
      log(
        {
          ...w,
          requestStatus: "Checking permissions",
          tenants: w.tenants.map((t) =>
            t.enrolled ? { ...t, status: "checking" } : t,
          ),
        },
        at,
        "Checking tenant permissions. 5 contracts scanned.",
        "info",
      ),
  },
  {
    phase: 3,
    ms: 1100,
    caption: "Two tenants are out. Neither is ever touched.",
    patch: (w, at) => {
      const excluded = setTenant(w, "ATL-05", {
        status: "excluded",
        note: "Maintenance window",
      });
      return log(
        excluded,
        at,
        "Kestrel Data excluded. Maintenance window active.",
        "muted",
      );
    },
  },
  {
    phase: 4,
    ms: 700,
    caption: "Three tenants clear verification, one at a time.",
    patch: (w) => ({ ...w, requestStatus: "Verifying" }),
  },
  ...verifyStep("ATL-01", "Three tenants clear verification, one at a time."),
  ...verifyStep("ATL-02", "Three tenants clear verification, one at a time."),
  ...verifyStep("ATL-03", "Halcyon moves from pending to verified."),
  {
    phase: 5,
    ms: 1600,
    caption: "Verified MW get committed back to the grid.",
    patch: (w, at) =>
      log(
        {
          ...w,
          requestStatus: "Committed",
          committed: VERIFIED_MW,
          participation: 88,
          gridSignal: "Dispatch",
          history: [
            {
              id: "DR-4471",
              at: "14:32",
              requested: REQUESTED_MW,
              verified: VERIFIED_MW,
              payout: 0,
              status: "Live",
            },
            ...w.history,
          ],
        },
        at,
        `DR-4471 committed at ${VERIFIED_MW.toFixed(1)} MW.`,
        "ok",
      ),
  },
  {
    phase: 6,
    ms: 1400,
    caption: "Committed load starts flexing down.",
    patch: (w, at) =>
      log(
        {
          ...w,
          requestStatus: "Delivering",
          shed: 0.55,
          queue: 0,
          availableFlex: 22.1,
          tenants: w.tenants.map((t) =>
            t.status === "verified" ? { ...t, status: "delivering" } : t,
          ),
        },
        at,
        "Dispatch live. 3 tenants delivering.",
        "signal",
      ),
  },
  {
    phase: 6,
    ms: 1900,
    caption: "Site load holds under the cap for the full window.",
    patch: (w) => ({ ...w, shed: 1, gridLoad: 0.52 }),
  },
  {
    phase: 7,
    ms: 1500,
    caption: "The window closes. Load returns on its own.",
    patch: (w, at) =>
      log(
        {
          ...w,
          gridSignal: "Clearing",
          shed: 0.35,
          gridLoad: 0.38,
          requestStatus: "Settled",
        },
        at,
        "Window closed. 45 minutes delivered in full.",
        "info",
      ),
  },
  {
    phase: 7,
    ms: 2600,
    caption: "Payment splits out to the tenants who flexed.",
    patch: (w, at) =>
      log(
        {
          ...w,
          shed: 0,
          gridSignal: "Nominal",
          availableFlex: 41.5,
          committedToday: 46.8,
          eventsToday: 3,
          payments: 21150,
          tenants: w.tenants.map((t) =>
            t.status === "delivering"
              ? { ...t, status: "settled", paid: PAYOUTS[t.id] ?? 0 }
              : t,
          ),
          history: w.history.map((h) =>
            h.id === "DR-4471"
              ? { ...h, status: "Settled" as const, payout: EVENT_PAYOUT }
              : h,
          ),
        },
        at,
        `DR-4471 settled. $${EVENT_PAYOUT.toLocaleString()} posted.`,
        "ok",
      ),
  },
];

function buildTimeline(): Step[] {
  const steps: Step[] = [];
  let world = INITIAL;
  let elapsed = 0;

  for (const def of STEP_DEFS) {
    const at = formatClock(BASE_SECONDS + elapsed);
    world = def.patch ? def.patch(world, at) : world;
    steps.push({ phase: def.phase, ms: def.ms, caption: def.caption, world, at: elapsed });
    elapsed += def.ms / 1000;
  }

  return steps;
}

export const TIMELINE = buildTimeline();

/** First step of each phase, so the rail can seek by phase. */
export const PHASE_ENTRY = PHASES.map((_, phase) =>
  TIMELINE.findIndex((s) => s.phase === phase),
);

export const SIM_START_SECONDS = BASE_SECONDS;
