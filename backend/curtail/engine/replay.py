"""Run the counterfactual over a whole history and aggregate the results."""

from __future__ import annotations

import math
from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import timedelta
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from curtail.engine.event import EventResult, EventSpec, energy_value, solve_event
from curtail.engine.events import detect_windows
from curtail.engine.power_model import cap_option, defer_option, pause_option
from curtail.engine.types import ActionKind, Decision, Job, TenantPolicy
from curtail.engine.verifier import Violation, verify_event
from curtail.params import ModelParams


@dataclass
class ReplayInputs:
    facility: pd.DataFrame  # index: UTC interval start; total_kw, optional it_kw
    jobs: list[Job]
    job_power: pd.DataFrame  # columns ts (UTC), job_id, kw; IT kW per job per interval
    grid: pd.DataFrame  # index: UTC interval start; price, dr_flag, emergency_flag
    policies: dict[str, TenantPolicy]
    tz: ZoneInfo = field(default_factory=lambda: ZoneInfo("America/New_York"))
    data_flags: list[str] = field(default_factory=list)


@dataclass
class EventOutcome:
    result: EventResult
    violations_dropped: list[Violation]
    facility_kw: np.ndarray
    it_kw: np.ndarray


def scenario_excluded_tenants(policies: dict[str, TenantPolicy], rate: float) -> set[str]:
    opted = sorted(t for t, p in policies.items() if p.opted_in)
    keep = math.ceil(rate * len(opted) - 1e-9)
    return set(opted[keep:])


class _PowerIndex:
    """Fast window slicing of the long job-power table."""

    def __init__(self, job_power: pd.DataFrame):
        jp = job_power.sort_values("ts", kind="stable")
        ts = pd.to_datetime(jp["ts"], utc=True).dt.tz_convert(None)
        self.ts = ts.to_numpy(dtype="datetime64[ns]")
        self.job = jp["job_id"].to_numpy()
        self.kw = jp["kw"].to_numpy(dtype=float)

    def window(self, ws: pd.Timestamp, n: int, step: pd.Timedelta) -> dict[str, np.ndarray]:
        lo = np.searchsorted(self.ts, ws.to_datetime64(), "left")
        hi = np.searchsorted(self.ts, (ws + n * step).to_datetime64(), "left")
        out: dict[str, np.ndarray] = {}
        offs = ((self.ts[lo:hi] - ws.to_datetime64()) // step.to_timedelta64()).astype(int)
        for jid, off, kw in zip(self.job[lo:hi], offs, self.kw[lo:hi]):
            arr = out.get(jid)
            if arr is None:
                arr = out[jid] = np.zeros(n)
            arr[off] += kw
        return out

    def history(self, ws: pd.Timestamp, k: int, step: pd.Timedelta) -> dict[str, np.ndarray]:
        return self.window(ws - k * step, k, step)


def _rescore(d: Decision, job: Job, p: np.ndarray, spec: EventSpec, params: ModelParams) -> None:
    """Replace a decision's effect with what the action does to actual power."""
    if d.action == ActionKind.CAP:
        tp = next(c.throughput_frac for c in params.cap_curve if c.power_frac == d.cap_power_frac)
        o = cap_option(p, d.cap_power_frac, tp, params, job.end < spec.we)
    elif d.action == ActionKind.PAUSE:
        o = pause_option(p, params)
    else:
        o = defer_option(p, job, spec.we)
    d.reduction_kw = o.reduction.tolist()
    d.delay_minutes = o.delay_minutes


def run_replay(inp: ReplayInputs, params: ModelParams, forecaster: Any = None) -> dict:
    step = pd.Timedelta(minutes=params.interval_minutes)
    grid = inp.grid.sort_index()
    facility = inp.facility.sort_index()
    windows = detect_windows(grid, params)
    pidx = _PowerIndex(inp.job_power)
    jobs_by_id = {j.job_id: j for j in inp.jobs}
    starts = np.array([pd.Timestamp(j.start).to_datetime64() for j in inp.jobs], dtype="datetime64[ns]")
    ends = np.array([pd.Timestamp(j.end).to_datetime64() for j in inp.jobs], dtype="datetime64[ns]")
    excluded = scenario_excluded_tenants(inp.policies, params.opt_in_rate)
    fallback_price = params.fixed_energy_price_per_mwh

    it_series = facility.get("it_kw", None)
    if it_series is None or it_series.isna().all():
        it_series = facility["total_kw"] / params.assumed_pue
        inp.data_flags.append("it_kw_missing_derived_from_pue")

    outcomes: list[EventOutcome] = []
    delay_so_far: dict[str, float] = {}
    for w in windows:
        n = int((w.end - w.start) / step)
        idx = pd.date_range(w.start, periods=n, freq=step)
        price = grid["price"].reindex(idx).to_numpy(dtype=float)
        price = np.where(np.isnan(price), fallback_price, price)
        after = grid["price"].reindex(pd.date_range(w.end, periods=n, freq=step))
        rebound = float(after.mean()) if after.notna().any() else fallback_price
        spec = EventSpec(f"{w.kind}-{w.start:%Y%m%d%H%M}", w.start.to_pydatetime(),
                         w.end.to_pydatetime(), w.kind, price, max(0.0, rebound))

        ws64, we64 = w.start.to_datetime64(), w.end.to_datetime64()
        mask = (starts < we64) & (ends > ws64)
        # Delay accumulates across events (and across chunks of one long
        # event): a job already delayed earlier finishes later, so it has that
        # much less slack left. Both the optimizer and the verifier see the
        # shifted end time.
        jobs = [
            replace(j, end=j.end + timedelta(minutes=delay_so_far[j.job_id]))
            if delay_so_far.get(j.job_id) else j
            for j in (inp.jobs[i] for i in np.nonzero(mask)[0])
        ]
        actual = pidx.window(w.start, n, step)

        end_est = None
        decide_power = actual
        if params.mode == "forecast" and forecaster is not None:
            hist = pidx.history(w.start, forecaster.history_intervals, step)
            decide_power = forecaster.predict(jobs, hist, spec.ws, n)
            end_est = {j.job_id: (j.timelimit_end + timedelta(minutes=delay_so_far.get(j.job_id, 0.0))
                                  if j.timelimit_end else j.end) for j in jobs}

        result = solve_event(spec, jobs, decide_power, inp.policies, params, inp.tz,
                             excluded, end_est)
        if params.mode == "forecast" and forecaster is not None:
            for d in result.decisions:
                if d.action != ActionKind.NONE:
                    _rescore(d, jobs_by_id[d.job_id], actual.get(d.job_id, np.zeros(n)), spec,
                             params)

        violations = verify_event(result.decisions, {j.job_id: j for j in jobs}, actual,
                                  inp.policies, params, spec.ws, spec.we, inp.tz, n)
        if violations:
            bad_jobs = {v.job_id for v in violations if v.job_id}
            bad_tenants = {v.tenant_id for v in violations if v.job_id is None}
            for d in result.decisions:
                if d.action != ActionKind.NONE and (d.job_id in bad_jobs
                                                    or d.tenant_id in bad_tenants):
                    d.action, d.reduction_kw, d.delay_minutes = ActionKind.NONE, [], 0.0
                    d.cap_power_frac, d.reason = None, "dropped_by_verifier"
            # Dropping actions only loosens tenant limits, so one pass suffices;
            # assert it anyway.
            again = verify_event(result.decisions, {j.job_id: j for j in jobs}, actual,
                                 inp.policies, params, spec.ws, spec.we, inp.tz, n)
            assert not again, again

        for d in result.decisions:
            if d.action != ActionKind.NONE and d.delay_minutes > 0:
                delay_so_far[d.job_id] = delay_so_far.get(d.job_id, 0.0) + d.delay_minutes

        outcomes.append(EventOutcome(
            result, violations,
            facility["total_kw"].reindex(idx).to_numpy(dtype=float),
            it_series.reindex(idx).to_numpy(dtype=float)))

    return summarize(inp, params, outcomes, facility, it_series, grid)


def summarize(inp: ReplayInputs, params: ModelParams, outcomes: list[EventOutcome],
              facility: pd.DataFrame, it_series: pd.Series, grid: pd.DataFrame) -> dict:
    dt = params.dt_hours
    m = params.safety_margin
    f = params.facility_kw_per_it_kw
    events_out = []
    tenants: dict[str, dict] = {}
    actions = Counter()
    affected_jobs: set[str] = set()
    flags = Counter(inp.data_flags)
    reduction_series = pd.Series(0.0, index=facility.index)
    tot = Counter()

    for oc in outcomes:
        r = oc.result
        spec = r.spec
        value = energy_value(spec, params)
        it_red = r.it_reduction_kw
        modeled_fac = it_red * f
        firm_fac = modeled_fac * (1 - m)
        idx = pd.date_range(spec.ws, periods=spec.n, freq=f"{params.interval_minutes}min")
        reduction_series.loc[reduction_series.index.intersection(idx)] = pd.Series(
            firm_fac, index=idx).reindex(reduction_series.index.intersection(idx)).to_numpy()

        firm_mwh = float(firm_fac.sum() * dt / 1000)
        gross = float((firm_fac * dt / 1000 * value).sum())
        rebound = max(0.0, firm_mwh) * spec.rebound_price
        comp_total = 0.0
        per_tenant: dict[str, dict] = {}
        decisions_out = []
        for d in r.decisions:
            for fl in d.flags:
                flags[fl] += 1
            red = np.asarray(d.reduction_kw) if d.reduction_kw else np.zeros(spec.n)
            if d.action != ActionKind.NONE:
                actions[d.action.value] += 1
                affected_jobs.add(d.job_id)
            if d.tenant_id:
                t = per_tenant.setdefault(d.tenant_id, {"modeled_mwh": 0.0, "jobs_affected": 0})
                t["modeled_mwh"] += float(red.sum() * f * dt / 1000)
                t["jobs_affected"] += int(d.action != ActionKind.NONE)
            decisions_out.append({
                "job_id": d.job_id, "tenant_id": d.tenant_id, "action": d.action.value,
                "cap_power_frac": d.cap_power_frac, "avg_reduction_kw": d.avg_reduction_kw,
                "delay_minutes": round(d.delay_minutes, 2),
                "slack_minutes": None if d.slack_minutes is None else round(d.slack_minutes, 1),
                "deadline_risk": _risk(d), "reason": d.reason, "flags": d.flags,
            })
        for tid, t in per_tenant.items():
            rule = r.rules.get(tid)
            # Compensation is paid on the modeled (not derated) reduction so the
            # operator's cost is never understated.
            rate = rule.compensation_per_mwh if rule and not rule.excluded_reason else 0.0
            t["compensation"] = t["modeled_mwh"] * rate
            t["baseline_avg_kw"] = float(r.tenant_baseline_kw[tid].mean())
            t["excluded_reason"] = rule.excluded_reason if rule else "tenant_config_missing"
            for fl in (rule.flags if rule else []):
                flags[fl] += 1
            comp_total += t["compensation"]
            agg = tenants.setdefault(tid, {"tenant_id": tid, "modeled_mwh": 0.0,
                                           "compensation": 0.0, "events_participated": 0,
                                           "jobs_affected": 0, "exclusions": Counter()})
            agg["modeled_mwh"] += t["modeled_mwh"]
            agg["compensation"] += t["compensation"]
            agg["jobs_affected"] += t["jobs_affected"]
            agg["events_participated"] += int(t["modeled_mwh"] > 0)
            if t["excluded_reason"]:
                agg["exclusions"][t["excluded_reason"]] += 1

        net = gross - rebound - comp_total
        tot.update({"firm_mwh": firm_mwh, "gross": gross, "rebound": rebound,
                    "comp": comp_total, "net": net,
                    "event_hours": spec.n * dt, "dropped": len(oc.violations_dropped)})
        events_out.append({
            "event_id": spec.event_id, "kind": spec.kind, "start": spec.ws.isoformat(),
            "end": spec.we.isoformat(), "avg_price": float(spec.price.mean()),
            "rebound_price": spec.rebound_price,
            "firm_avg_mw": float(firm_fac.mean() / 1000), "firm_min_mw": float(firm_fac.min() / 1000),
            "firm_mwh": firm_mwh, "gross_value": gross, "rebound_cost": rebound,
            "tenant_compensation": comp_total, "operator_net": net,
            "solver_status": r.solver_status,
            "violations_dropped": [v.__dict__ for v in oc.violations_dropped],
            "series": {
                "ts": [t.isoformat() for t in idx],
                "facility_kw": _clean(oc.facility_kw), "it_kw": _clean(oc.it_kw),
                "firm_reduction_kw": _clean(firm_fac), "price": _clean(spec.price),
            },
            "tenants": per_tenant, "decisions": decisions_out,
        })

    hourly = pd.DataFrame({"actual_kw": facility["total_kw"],
                           "reduced_kw": facility["total_kw"] - reduction_series}).resample("1h").mean()
    period_days = (facility.index.max() - facility.index.min()).total_seconds() / 86400 if len(facility) else 0
    for t in tenants.values():
        t["exclusions"] = dict(t["exclusions"])
    with_red = [e for e in events_out if e["firm_mwh"] > 1e-9]
    return {
        "params": params.model_dump(),
        "summary": {
            "period_start": facility.index.min().isoformat() if len(facility) else None,
            "period_end": facility.index.max().isoformat() if len(facility) else None,
            "period_months": round(period_days / 30.44, 2),
            "events": len(events_out), "events_with_reduction": len(with_red),
            "event_hours": tot["event_hours"],
            "firm_mwh": tot["firm_mwh"],
            "avg_firm_mw_during_events": (tot["firm_mwh"] / tot["event_hours"]) if tot["event_hours"] else 0.0,
            "peak_firm_mw": max((e["firm_avg_mw"] for e in events_out), default=0.0),
            "jobs_affected": len(affected_jobs), "actions": dict(actions),
            "gross_value": tot["gross"], "rebound_cost": tot["rebound"],
            "tenant_compensation": tot["comp"], "operator_net": tot["net"],
            "sla_violations_reported": 0,
            "decisions_dropped_by_verifier": tot["dropped"],
            "mode": params.mode,
        },
        "flags": dict(flags),
        "tenants": sorted(tenants.values(), key=lambda t: -t["modeled_mwh"]),
        "events": events_out,
        "timeline": {
            "ts": [t.isoformat() for t in hourly.index],
            "actual_kw": _clean(hourly["actual_kw"].to_numpy()),
            "reduced_kw": _clean(hourly["reduced_kw"].to_numpy()),
            "windows": [{"start": e["start"], "end": e["end"], "kind": e["kind"]} for e in events_out],
        },
    }


def _risk(d: Decision) -> str | None:
    if d.action == ActionKind.NONE or d.slack_minutes is None:
        return None
    if d.slack_minutes <= 0:
        return "high"
    used = d.delay_minutes / d.slack_minutes
    return "low" if used < 0.25 else "medium" if used < 0.6 else "high"


def _clean(a) -> list[float | None]:
    return [None if (x is None or (isinstance(x, float) and math.isnan(x))) else round(float(x), 3)
            for x in np.asarray(a, dtype=float)]

