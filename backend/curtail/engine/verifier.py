"""Independent re-check of an event's decisions against actual data.

Deliberately does not reuse the optimizer's resolved tenant rules: it reads
the raw policies and job records again, so a bug in the optimizer's
constraint building cannot hide itself. A replay never reports a decision
that fails here.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np

from curtail.engine.types import ActionKind, Decision, Job, JobType, TenantPolicy
from curtail.params import ModelParams

TOL_KW = 1e-6


@dataclass
class Violation:
    rule: str
    tenant_id: str | None
    job_id: str | None
    detail: str


def verify_event(decisions: list[Decision], jobs: dict[str, Job],
                 actual_power: dict[str, np.ndarray], policies: dict[str, TenantPolicy],
                 params: ModelParams, ws: datetime, we: datetime, tz: ZoneInfo,
                 n: int) -> list[Violation]:
    m = params.safety_margin
    out: list[Violation] = []
    acting = [d for d in decisions if d.action != ActionKind.NONE]

    for d in acting:
        job = jobs[d.job_id]
        pol = policies.get(d.tenant_id) if d.tenant_id else None
        if pol is None or pol.opted_in is not True:
            out.append(Violation("opt_in", d.tenant_id, d.job_id, "tenant not opted in"))
        elif any(b.overlaps(ws, we, tz) for b in pol.blackouts):
            out.append(Violation("blackout", d.tenant_id, d.job_id, "event overlaps blackout"))
        if job.job_type == JobType.UNKNOWN:
            out.append(Violation("job_type", d.tenant_id, d.job_id, "unknown job type acted on"))
        if job.job_type == JobType.INFERENCE:
            if d.action in (ActionKind.PAUSE, ActionKind.DEFER):
                out.append(Violation("inference_floor", d.tenant_id, d.job_id, "inference paused"))
            elif d.cap_power_frac is not None:
                keep = 1 - params.gpu_power_share * (1 - d.cap_power_frac)
                if keep + 1e-9 < params.inference_floor_frac:
                    out.append(Violation("inference_floor", d.tenant_id, d.job_id,
                                         f"capped to {keep:.2f} of power"))
        deadline = job.deadline
        if deadline is None and params.missing_deadline_policy == "timelimit":
            deadline = job.timelimit_end
        slack = 0.0 if deadline is None else max(0.0, (deadline - job.end).total_seconds() / 60)
        if d.delay_minutes > slack * (1 - m) + 1e-6:
            out.append(Violation("deadline", d.tenant_id, d.job_id,
                                 f"delay {d.delay_minutes:.1f} min > usable slack "
                                 f"{slack * (1 - m):.1f} min"))

    tenants = {d.tenant_id for d in acting if d.tenant_id}
    for tid in tenants:
        pol = policies.get(tid)
        if pol is None:
            continue
        baseline = np.zeros(n)
        for j in jobs.values():
            if j.tenant_id == tid and j.job_id in actual_power:
                baseline = baseline + actual_power[j.job_id]
        red = np.zeros(n)
        for d in acting:
            if d.tenant_id == tid:
                red = red + np.asarray(d.reduction_kw)
        if pol.max_reduction_pct is not None:
            lim = baseline * pol.max_reduction_pct / 100 * (1 - m)
            if np.any(red > lim + TOL_KW):
                out.append(Violation("max_reduction_pct", tid, None,
                                     f"peak excess {float((red - lim).max()):.3f} kW"))
        if pol.max_reduction_kw is not None:
            lim = pol.max_reduction_kw * (1 - m)
            if np.any(red > lim + TOL_KW):
                out.append(Violation("max_reduction_kw", tid, None,
                                     f"peak {float(red.max()):.3f} kW > {lim:.3f}"))
        min_kw = pol.min_guaranteed_kw
        if min_kw is None and params.missing_min_guaranteed_policy == "strict":
            out.append(Violation("min_guaranteed", tid, None, "minimum unknown, strict policy"))
        else:
            floor = (min_kw or 0.0) * (1 + m)
            # Only reductions that push a tenant below its floor count; a
            # tenant already below it with no reduction is not our doing.
            bad = (red > TOL_KW) & (baseline - red < floor - TOL_KW)
            if np.any(bad):
                out.append(Violation("min_guaranteed", tid, None,
                                     f"{int(bad.sum())} intervals below {floor:.1f} kW"))
    return out
