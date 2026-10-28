"use client";

import { useMemo, useState } from "react";
import type { DecisionOut, EventOut } from "@/lib/replay/api";
import { LineChart } from "./LineChart";
import { Badge, Btn, Card, Table, fmt } from "./ui";

const GROUPS = [
  { key: "cap", label: "Capped" },
  { key: "pause", label: "Paused" },
  { key: "defer", label: "Deferred" },
  { key: "protected", label: "Protected" },
] as const;

const REASON_TEXT: Record<string, string> = {
  selected: "selected",
  not_selected: "allowed, but tenant limits or value made other jobs better",
  tenant_not_opted_in: "tenant not opted in",
  opt_in_unknown: "tenant opt-in unknown (strict)",
  tenant_blackout: "tenant blackout window",
  tenant_limit_missing: "tenant has no reduction limit configured (strict)",
  tenant_min_missing: "tenant guaranteed minimum unknown (strict)",
  tenant_config_missing: "no tenant contract (strict)",
  excluded_by_opt_in_scenario: "excluded by opt-in rate scenario",
  job_type_unknown: "unknown job type (strict)",
  no_power_data: "no power data",
  no_tenant: "job has no tenant (strict)",
  no_action_available: "no action available for this job type",
  deadline_slack_insufficient: "not enough deadline slack",
  dropped_by_verifier: "dropped: would have broken a rule given actual power",
  solver_failed: "solver failed (protected)",
};

function action(d: DecisionOut) {
  if (d.action === "cap") return `cap to ${fmt.pct(d.cap_power_frac ?? 1)} GPU power`;
  if (d.action === "pause") return "checkpoint + pause";
  if (d.action === "defer") return "defer start";
  return "—";
}

export function EventDrilldown({ event, onClose }: { event: EventOut; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof GROUPS)[number]["key"]>("cap");
  const groups = useMemo(() => {
    const g: Record<string, DecisionOut[]> = { cap: [], pause: [], defer: [], protected: [] };
    for (const d of event.decisions) g[d.action === "none" ? "protected" : d.action].push(d);
    g.cap.sort((a, b) => b.avg_reduction_kw - a.avg_reduction_kw);
    return g;
  }, [event]);
  const reduced = event.series.facility_kw.map((v, i) =>
    v == null ? null : v - (event.series.firm_reduction_kw[i] ?? 0),
  );
  const rows = groups[tab];
  const protectedReasons = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of groups.protected) c[d.reason] = (c[d.reason] ?? 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]);
  }, [groups]);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Event {fmt.dt(event.start)} – {new Date(event.end).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
          <Badge tone={event.kind === "price" ? "signal" : "warn"}>{event.kind}</Badge>
        </span>
      }
      aside={<Btn variant="ghost" onClick={onClose}>Close</Btn>}
    >
      <div className="mb-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
        <div><div className="text-xs text-gray-500">Avg price</div><div className="font-mono">${Math.round(event.avg_price)}/MWh</div></div>
        <div><div className="text-xs text-gray-500">Firm reduction</div><div className="font-mono">{fmt.mw(event.firm_avg_mw)} avg · {fmt.mw(Math.max(0, event.firm_min_mw))} min</div></div>
        <div><div className="text-xs text-gray-500">Energy</div><div className="font-mono">{fmt.mwh(event.firm_mwh)}</div></div>
        <div><div className="text-xs text-gray-500">Tenant compensation</div><div className="font-mono">{fmt.usd(event.tenant_compensation)}</div></div>
        <div><div className="text-xs text-gray-500">Operator net</div><div className="font-mono">{fmt.usd(event.operator_net)}</div></div>
      </div>
      <LineChart
        ts={event.series.ts}
        height={180}
        series={[
          { label: "Actual facility", values: event.series.facility_kw, color: "#57524a" },
          { label: "With Curtail (firm)", values: reduced, color: "#c8763a" },
        ]}
        unit={(v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} MW` : `${Math.round(v)} kW`)}
      />
      <div className="mt-5 flex flex-wrap gap-1">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => setTab(g.key)}
            className={`rounded-full px-3 py-1 text-sm ${tab === g.key ? "bg-ink text-paper" : "text-gray-600 hover:bg-ink/[0.04]"}`}
          >
            {g.label} <span className="font-mono text-xs opacity-70">{groups[g.key].length}</span>
          </button>
        ))}
      </div>
      {tab === "protected" && protectedReasons.length > 0 && (
        <p className="mt-3 text-sm text-gray-600">
          {protectedReasons.map(([r, n]) => `${n} ${REASON_TEXT[r] ?? fmt.label(r)}`).join(" · ")}
        </p>
      )}
      <div className="mt-3 max-h-80 overflow-auto">
        <Table
          head={["Job", "Tenant", "Action", "Avg kW", "Delay", "Slack", "Deadline risk", "Why"]}
          rows={rows.slice(0, 300).map((d) => [
            <span key="j" className="font-mono text-xs">{d.job_id}</span>,
            d.tenant_id ?? "—",
            action(d),
            d.avg_reduction_kw ? d.avg_reduction_kw.toFixed(1) : "—",
            d.delay_minutes ? `${d.delay_minutes.toFixed(1)} min` : "—",
            d.slack_minutes == null ? "—" : `${Math.round(d.slack_minutes)} min`,
            d.deadline_risk ? (
              <Badge key="r" tone={d.deadline_risk === "high" ? "warn" : d.deadline_risk === "medium" ? "signal" : "good"}>
                {d.deadline_risk}
              </Badge>
            ) : (
              "—"
            ),
            <span key="w" className="text-gray-600">
              {REASON_TEXT[d.reason] ?? fmt.label(d.reason)}
              {d.flags.length > 0 && <span className="text-gray-400"> · {d.flags.map(fmt.label).join(", ")}</span>}
            </span>,
          ])}
        />
        {rows.length > 300 && <p className="mt-2 text-xs text-gray-500">Showing 300 of {rows.length}.</p>}
      </div>
    </Card>
  );
}
