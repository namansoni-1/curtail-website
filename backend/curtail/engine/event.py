"""Optimize one event window: pick at most one action per job so that the
total reduction (or net revenue) is maximal while every tenant and job rule
holds in every interval."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
from ortools.sat.python import cp_model

from curtail.engine.power_model import Option, job_options
from curtail.engine.types import ActionKind, Decision, Job, JobType, TenantPolicy
from curtail.params import ModelParams


@dataclass
class EventSpec:
    event_id: str
    ws: datetime
    we: datetime
    kind: str  # "dr", "emergency" or "price"
    price: np.ndarray  # $/MWh per interval
    rebound_price: float  # $/MWh the shifted energy is assumed to be bought back at

    @property
    def is_grid_event(self) -> bool:
        return self.kind in ("dr", "emergency")

    @property
    def n(self) -> int:
        return len(self.price)


@dataclass
class TenantRule:
    """A tenant policy resolved for one event: None limits mean excluded."""

    tenant_id: str
    excluded_reason: str | None
    allowance_kw: np.ndarray | None = None  # max IT kW reducible per interval
    headroom_kw: np.ndarray | None = None  # baseline minus protected minimum
    compensation_per_mwh: float = 0.0
    flags: list[str] = field(default_factory=list)


@dataclass
class EventResult:
    spec: EventSpec
    decisions: list[Decision]
    tenant_baseline_kw: dict[str, np.ndarray]
    rules: dict[str, TenantRule]
    solver_status: str
    flags: list[str] = field(default_factory=list)

    @property
    def it_reduction_kw(self) -> np.ndarray:
        total = np.zeros(self.spec.n)
        for d in self.decisions:
            if d.action != ActionKind.NONE:
                total += np.asarray(d.reduction_kw)
        return total


def energy_value(spec: EventSpec, params: ModelParams) -> np.ndarray:
    base = spec.price if params.energy_value_basis == "rt_price" else np.full(
        spec.n, params.fixed_energy_price_per_mwh)
    return base + (params.dr_payment_per_mwh if spec.is_grid_event else 0.0)


def resolve_tenant(policy: TenantPolicy | None, tenant_id: str, baseline: np.ndarray,
                   spec: EventSpec, params: ModelParams, tz: ZoneInfo,
                   scenario_excluded: set[str]) -> TenantRule:
    m = params.safety_margin
    if policy is None:
        return TenantRule(tenant_id, "tenant_config_missing", flags=["tenant_config_missing"])
    if policy.opted_in is None:
        return TenantRule(tenant_id, "opt_in_unknown", flags=["opt_in_unknown"])
    if not policy.opted_in:
        return TenantRule(tenant_id, "tenant_not_opted_in")
    if tenant_id in scenario_excluded:
        return TenantRule(tenant_id, "excluded_by_opt_in_scenario")
    if any(b.overlaps(spec.ws, spec.we, tz) for b in policy.blackouts):
        return TenantRule(tenant_id, "tenant_blackout")
    if policy.max_reduction_pct is None and policy.max_reduction_kw is None:
        return TenantRule(tenant_id, "tenant_limit_missing", flags=["tenant_limit_missing"])
    flags: list[str] = []
    min_kw = policy.min_guaranteed_kw
    if min_kw is None:
        if params.missing_min_guaranteed_policy == "strict":
            return TenantRule(tenant_id, "tenant_min_missing", flags=["tenant_min_missing"])
        min_kw, flags = 0.0, ["tenant_min_assumed_zero"]

    allowance = np.full(spec.n, np.inf)
    if policy.max_reduction_pct is not None:
        allowance = np.minimum(allowance, baseline * policy.max_reduction_pct / 100.0)
    if policy.max_reduction_kw is not None:
        allowance = np.minimum(allowance, np.full(spec.n, policy.max_reduction_kw))
    allowance = allowance * (1.0 - m)
    headroom = np.maximum(0.0, baseline - min_kw * (1.0 + m))
    comp = policy.compensation_per_mwh
    if comp is None:
        comp = params.default_compensation_per_mwh
        flags.append("compensation_assumed_default")
    return TenantRule(tenant_id, None, allowance, headroom, comp, flags)


def job_slack_minutes(job: Job, params: ModelParams, end_estimate: datetime) -> tuple[float, list[str]]:
    deadline = job.deadline
    flags: list[str] = []
    if deadline is None and params.missing_deadline_policy == "timelimit" and job.timelimit_end:
        deadline = job.timelimit_end
        flags.append("deadline_from_timelimit")
    if deadline is None:
        return 0.0, ["deadline_missing_assumed_zero_slack"]
    return max(0.0, (deadline - end_estimate).total_seconds() / 60.0), flags


def solve_event(spec: EventSpec, jobs: list[Job], power: dict[str, np.ndarray],
                policies: dict[str, TenantPolicy], params: ModelParams, tz: ZoneInfo,
                scenario_excluded: set[str] | None = None,
                end_estimates: dict[str, datetime] | None = None) -> EventResult:
    """`power` maps job_id to its IT kW in each interval of the window (actual
    or forecast). `end_estimates` overrides job.end when computing slack."""
    scenario_excluded = scenario_excluded or set()
    end_estimates = end_estimates or {}
    zeros = np.zeros(spec.n)

    baselines: dict[str, np.ndarray] = {}
    for j in jobs:
        if j.tenant_id is not None:
            baselines[j.tenant_id] = baselines.get(j.tenant_id, zeros) + power.get(j.job_id, zeros)
    rules = {t: resolve_tenant(policies.get(t), t, b, spec, params, tz, scenario_excluded)
             for t, b in baselines.items()}

    decisions: dict[str, Decision] = {}
    candidates: dict[str, list[Option]] = {}
    for j in jobs:
        p = power.get(j.job_id)
        d = Decision(j.job_id, j.tenant_id, ActionKind.NONE)
        decisions[j.job_id] = d
        if p is None:
            d.reason, d.flags = "no_power_data", ["no_power_data"]
            continue
        if j.tenant_id is None:
            d.reason, d.flags = "no_tenant", ["job_tenant_missing"]
            continue
        rule = rules[j.tenant_id]
        if rule.excluded_reason:
            d.reason = rule.excluded_reason
            continue
        if j.job_type == JobType.UNKNOWN:
            d.reason, d.flags = "job_type_unknown", ["job_type_unknown"]
            continue
        slack, sflags = job_slack_minutes(j, params, end_estimates.get(j.job_id, j.end))
        d.slack_minutes, d.flags = slack, sflags
        opts = job_options(j, p, spec.ws, spec.we, params)
        if not opts:
            d.reason = "no_action_available"
            continue
        usable = slack * (1.0 - params.safety_margin)
        opts = [o for o in opts if o.delay_minutes <= usable + 1e-9 and o.reduction.sum() > 0]
        if not opts:
            d.reason = "deadline_slack_insufficient"
            continue
        candidates[j.job_id] = opts

    status = "no_candidates"
    if candidates:
        status = _optimize(spec, candidates, decisions, rules, params)

    return EventResult(spec, list(decisions.values()), baselines, rules, status)


def _optimize(spec: EventSpec, candidates: dict[str, list[Option]],
              decisions: dict[str, Decision], rules: dict[str, TenantRule],
              params: ModelParams) -> str:
    model = cp_model.CpModel()
    value = energy_value(spec, params)
    dt = params.dt_hours
    x: dict[tuple[str, int], cp_model.IntVar] = {}
    objective = []

    for jid, opts in candidates.items():
        tenant = decisions[jid].tenant_id
        comp = rules[tenant].compensation_per_mwh
        for i, o in enumerate(opts):
            var = model.NewBoolVar(f"x_{jid}_{i}")
            x[jid, i] = var
            if params.objective == "mwh":
                score = math.floor(o.reduction.sum() * 1000) * 10 - round(o.delay_minutes)
            else:
                mwh = o.reduction * dt / 1000.0
                dollars = float((mwh * (value - comp)).sum())
                dollars -= max(0.0, float(mwh.sum())) * spec.rebound_price
                score = round(dollars * 100)
            objective.append(score * var)
        model.AddAtMostOne(x[jid, i] for i in range(len(opts)))

    # Tenant rules hold in every interval. Reductions are rounded up to whole
    # watts and limits down, so integer rounding can only make it stricter.
    by_tenant: dict[str, list[str]] = {}
    for jid in candidates:
        by_tenant.setdefault(decisions[jid].tenant_id, []).append(jid)
    for tenant, jids in by_tenant.items():
        rule = rules[tenant]
        limit = np.minimum(rule.allowance_kw, rule.headroom_kw)
        for t in range(spec.n):
            terms = []
            for jid in jids:
                for i, o in enumerate(candidates[jid]):
                    w = math.ceil(o.reduction[t] * 1000)
                    if w:
                        terms.append(w * x[jid, i])
            if terms:
                model.Add(sum(terms) <= math.floor(limit[t] * 1000))

    model.Maximize(sum(objective))
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = params.solver_time_limit_s
    solver.parameters.num_workers = 4
    code = solver.Solve(model)
    if code not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for jid in candidates:
            decisions[jid].reason = "solver_failed"
        return solver.StatusName(code)

    for jid, opts in candidates.items():
        d = decisions[jid]
        chosen = next((i for i in range(len(opts)) if solver.Value(x[jid, i])), None)
        if chosen is None:
            d.reason = "not_selected"
            continue
        o = opts[chosen]
        d.action = o.kind
        d.cap_power_frac = o.cap_power_frac
        d.reduction_kw = o.reduction.tolist()
        d.delay_minutes = o.delay_minutes
        d.reason = "selected"
    return solver.StatusName(code)
