"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Params, type RunResult, type Site } from "@/lib/replay/api";
import { EventDrilldown } from "./EventDrilldown";
import { LineChart } from "./LineChart";
import { Badge, Btn, Card, ErrorNote, Stat, Table, fmt } from "./ui";

const ACTUAL = "#57524a";
const REDUCED = "#c8763a";

type Knobs = Pick<Params, "safety_margin" | "price_threshold_per_mwh" | "opt_in_rate" | "mode" | "objective">;

export function ResultsTab({ site }: { site: Site }) {
  const [knobs, setKnobs] = useState<Knobs>({
    safety_margin: 0.1,
    price_threshold_per_mwh: 200,
    opt_in_rate: 1,
    mode: "hindsight",
    objective: "mwh",
  });
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventIdx, setEventIdx] = useState<number | null>(null);
  const seq = useRef(0);

  const run = useCallback(
    async (k: Knobs) => {
      const mine = ++seq.current;
      setBusy(true);
      setError(null);
      try {
        const r = await api.createRun(site.id, k);
        const full = await api.run(r.id);
        if (mine === seq.current) {
          setResult(full);
          setEventIdx(null);
        }
      } catch (e) {
        if (mine === seq.current) setError((e as Error).message);
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [site.id],
  );

  // Load the latest run if there is one; otherwise run with defaults.
  useEffect(() => {
    api.runs(site.id).then(async (runs) => {
      const last = runs.find((r) => r.status === "done");
      if (last) {
        const full = await api.run(last.id);
        setResult(full);
        const p = full.params;
        setKnobs({
          safety_margin: p.safety_margin,
          price_threshold_per_mwh: p.price_threshold_per_mwh,
          opt_in_rate: p.opt_in_rate,
          mode: p.mode,
          objective: p.objective,
        });
      } else {
        run(knobs);
      }
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  const commit = (next: Partial<Knobs>) => {
    const k = { ...knobs, ...next };
    setKnobs(k);
    run(k);
  };

  const s = result?.summary;
  return (
    <div className="space-y-5">
      <Controls knobs={knobs} setKnobs={setKnobs} commit={commit} busy={busy} />
      <ErrorNote error={error} />
      {result && s && (
        <div className={`space-y-5 transition-opacity ${busy ? "opacity-60" : ""}`}>
          <Card>
            <p className="text-lg leading-relaxed text-ink">
              Over <b>{s.period_months.toFixed(1)} months</b> you could have safely reduced{" "}
              <b className="text-signal-dim">{fmt.mwh(s.firm_mwh)}</b> during{" "}
              <b>{s.events_with_reduction} of {s.events} events</b>, affecting <b>{s.jobs_affected} jobs</b>, earning{" "}
              <b>{fmt.usd(s.operator_net)}</b> net, with <b>zero SLA violations</b>.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <Badge tone={s.mode === "hindsight" ? "neutral" : "signal"}>
                {s.mode === "hindsight" ? "hindsight: decided with actual job power" : "forecast: decided without hindsight"}
              </Badge>
              {s.decisions_dropped_by_verifier > 0 && (
                <Badge tone="warn">{s.decisions_dropped_by_verifier} decisions dropped by the verifier</Badge>
              )}
              <span>
                {fmt.date(s.period_start!)} – {fmt.date(s.period_end!)}
              </span>
              <a href={api.pdfUrl(result.id)} className="ml-auto">
                <Btn variant="secondary">Download PDF report</Btn>
              </a>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Firm energy reduced" value={fmt.mwh(s.firm_mwh)} sub={`${s.event_hours.toFixed(1)} event hours`} />
            <Stat label="Avg reduction during events" value={fmt.mw(s.avg_firm_mw_during_events)} sub={`best event ${fmt.mw(s.peak_firm_mw)}`} />
            <Stat
              label="Jobs affected"
              value={s.jobs_affected.toLocaleString()}
              sub={`${s.actions.cap ?? 0} capped · ${s.actions.pause ?? 0} paused · ${s.actions.defer ?? 0} deferred`}
            />
            <Stat
              label="Operator net"
              value={fmt.usd(s.operator_net)}
              sub={`${fmt.usd(s.gross_value)} gross − ${fmt.usd(s.rebound_cost)} rebound − ${fmt.usd(s.tenant_compensation)} tenants`}
            />
          </div>

          <Card title="Facility load: actual vs. with Curtail" aside="Hourly averages. Click a shaded event to drill in.">
            <LineChart
              ts={result.timeline.ts}
              series={[
                { label: "Actual", values: result.timeline.actual_kw.map((v) => (v == null ? null : v / 1000)), color: ACTUAL },
                {
                  label: "With Curtail (firm)",
                  // Only where it differs, so the actual line stays visible.
                  values: result.timeline.reduced_kw.map((v, i) => {
                    const a = result.timeline.actual_kw[i];
                    const prev = result.timeline.reduced_kw[i - 1];
                    const next = result.timeline.reduced_kw[i + 1];
                    const differs = (j: number) => {
                      const r = result.timeline.reduced_kw[j];
                      const x = result.timeline.actual_kw[j];
                      return r != null && x != null && Math.abs(r - x) > 0.01;
                    };
                    if (v == null || a == null) return null;
                    // Keep one neighbour on each side so a dip draws as a dip.
                    return differs(i) || (prev != null && differs(i - 1)) || (next != null && differs(i + 1)) ? v / 1000 : null;
                  }),
                  color: REDUCED,
                },
              ]}
              bands={result.timeline.windows}
              unit={(v) => (v < 1 ? `${Math.round(v * 1000)} kW` : `${v.toFixed(1)} MW`)}
              onBandClick={setEventIdx}
              activeBand={eventIdx}
            />
          </Card>

          {eventIdx != null && result.events[eventIdx] && (
            <EventDrilldown event={result.events[eventIdx]} onClose={() => setEventIdx(null)} />
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="By tenant">
              <Table
                head={["Tenant", "Events", "Jobs", "Modeled MWh", "Compensation", "Usually excluded because"]}
                rows={result.tenants.map((t) => {
                  const top = Object.entries(t.exclusions).sort((a, b) => b[1] - a[1])[0];
                  return [
                    <span key="t" className="font-medium">{t.tenant_id}</span>,
                    t.events_participated,
                    t.jobs_affected,
                    t.modeled_mwh.toFixed(2),
                    fmt.usd(t.compensation),
                    top ? `${fmt.label(top[0])} (${top[1]})` : "",
                  ];
                })}
              />
            </Card>
            <Card title="Events" aside={`${result.events.length} windows`}>
              <div className="max-h-96 overflow-auto">
                <Table
                  head={["Start", "Type", "Avg $/MWh", "Firm", "MWh", "Net", ""]}
                  rows={result.events.map((e, i) => [
                    fmt.dt(e.start),
                    <Badge key="k" tone={e.kind === "price" ? "signal" : "warn"}>{e.kind}</Badge>,
                    Math.round(e.avg_price).toLocaleString(),
                    fmt.mw(e.firm_avg_mw),
                    e.firm_mwh.toFixed(2),
                    fmt.usd(e.operator_net),
                    <button key="b" onClick={() => setEventIdx(i)} className="text-xs text-signal-dim underline-offset-2 hover:underline">
                      details
                    </button>,
                  ])}
                />
              </div>
            </Card>
          </div>

          {Object.keys(result.flags).length > 0 && (
            <Card title="Data gaps, handled strictly" aside="Counts are job-events or tenant-events.">
              <ul className="grid gap-1 text-sm text-gray-700 sm:grid-cols-2">
                {Object.entries(result.flags)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <li key={k}>
                      <span className="font-mono tabular-nums">{v.toLocaleString()}</span> · {fmt.label(k)}
                    </li>
                  ))}
              </ul>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Controls({
  knobs,
  setKnobs,
  commit,
  busy,
}: {
  knobs: Knobs;
  setKnobs: (k: Knobs) => void;
  commit: (k: Partial<Knobs>) => void;
  busy: boolean;
}) {
  const slider = (
    key: "safety_margin" | "price_threshold_per_mwh" | "opt_in_rate",
    label: string,
    min: number,
    max: number,
    step: number,
    show: (v: number) => string,
  ) => (
    <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-sm">
      <span className="flex justify-between text-xs text-gray-500">
        {label} <span className="font-mono text-ink tabular-nums">{show(knobs[key])}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={knobs[key]}
        onChange={(e) => setKnobs({ ...knobs, [key]: Number(e.target.value) })}
        onPointerUp={(e) => commit({ [key]: Number((e.target as HTMLInputElement).value) })}
        onKeyUp={(e) => commit({ [key]: Number((e.target as HTMLInputElement).value) })}
        className="accent-[#c8763a]"
      />
    </label>
  );
  return (
    <Card title="Scenario" aside={busy ? "Recomputing…" : "Changes recompute the replay"}>
      <div className="flex flex-wrap items-end gap-6">
        {slider("safety_margin", "Safety margin", 0, 0.5, 0.05, fmt.pct)}
        {slider("price_threshold_per_mwh", "Price threshold", 50, 1000, 25, (v) => `$${v}/MWh`)}
        {slider("opt_in_rate", "Opt-in rate", 0, 1, 0.05, fmt.pct)}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-gray-500">Decisions</span>
          <select
            value={knobs.mode}
            onChange={(e) => commit({ mode: e.target.value as Knobs["mode"] })}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5"
          >
            <option value="hindsight">Hindsight</option>
            <option value="forecast">Forecast (no hindsight)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-gray-500">Maximize</span>
          <select
            value={knobs.objective}
            onChange={(e) => commit({ objective: e.target.value as Knobs["objective"] })}
            className="rounded-md border border-ink/15 bg-white px-2 py-1.5"
          >
            <option value="mwh">MWh reduced</option>
            <option value="net_revenue">Net revenue</option>
          </select>
        </label>
      </div>
    </Card>
  );
}
