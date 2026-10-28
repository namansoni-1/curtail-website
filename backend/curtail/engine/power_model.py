"""What each action does to one job's power trace and finish time.

Every action is expressed as a modified power trace m[t] over the event
window; the reduction is r[t] = p[t] - m[t] and can be negative (for example
a paused job keeps drawing idle power after the time it would have finished).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

import numpy as np

from curtail.engine.types import ActionKind, Job, JobType
from curtail.params import ModelParams

PAUSABLE = {JobType.TRAINING, JobType.BATCH}
DEFERRABLE = {JobType.TRAINING, JobType.BATCH}


@dataclass
class Option:
    kind: ActionKind
    reduction: np.ndarray  # IT kW per interval
    delay_minutes: float
    cap_power_frac: float | None = None


def _active_minutes(p: np.ndarray, interval: float) -> float:
    """Minutes from the window start until the job's last nonzero interval."""
    nz = np.nonzero(p > 0)[0]
    return 0.0 if len(nz) == 0 else (nz[-1] + 1) * interval


def cap_option(p: np.ndarray, power_frac: float, throughput_frac: float, params: ModelParams,
               job_ends_in_window: bool) -> Option:
    interval = params.interval_minutes
    n = len(p)
    window = n * interval
    keep = 1.0 - params.gpu_power_share * (1.0 - power_frac)
    # A capped job progresses through its own baseline trace more slowly.
    # A job that would have ended inside the window runs longer, so its tail
    # shows up as extra load later in the window.
    idx = np.floor(np.arange(n) * throughput_frac).astype(int)
    m = keep * p[idx]
    active = _active_minutes(p, interval)
    if job_ends_in_window and throughput_frac * window >= active:
        delay = active / throughput_frac - active
    else:
        delay = window * (1.0 - throughput_frac)
    return Option(ActionKind.CAP, p - m, delay, cap_power_frac=power_frac)


def pause_option(p: np.ndarray, params: ModelParams) -> Option:
    interval = params.interval_minutes
    n = len(p)
    k0 = min(n, math.ceil(params.checkpoint_minutes / interval))
    p_ref = float(p[0]) if n else 0.0
    m = p.astype(float).copy()
    m[k0:] = params.paused_power_frac * p_ref
    delay = n * interval + params.restart_minutes
    return Option(ActionKind.PAUSE, p - m, delay)


def defer_option(p: np.ndarray, job: Job, we: datetime) -> Option:
    delay = (we - job.start).total_seconds() / 60.0
    return Option(ActionKind.DEFER, p.astype(float).copy(), delay)


def job_options(job: Job, p: np.ndarray, ws: datetime, we: datetime,
                params: ModelParams) -> list[Option]:
    """All actions physically available to a job, before deadline or tenant checks."""
    if job.job_type == JobType.UNKNOWN or not np.any(p > 0):
        return []
    ends_in_window = job.end < we
    opts: list[Option] = []
    floor = params.inference_floor_frac if job.job_type == JobType.INFERENCE else 0.0
    for pt in params.cap_curve[1:]:
        # The floor applies to the job's total power, not just its GPU share.
        keep = 1.0 - params.gpu_power_share * (1.0 - pt.power_frac)
        if keep + 1e-9 < floor:
            continue
        opts.append(cap_option(p, pt.power_frac, pt.throughput_frac, params, ends_in_window))
    if job.job_type in PAUSABLE and job.checkpointable is not False and job.start < ws:
        opts.append(pause_option(p, params))
    if job.job_type in DEFERRABLE and ws <= job.start < we:
        opts.append(defer_option(p, job, we))
    return opts
