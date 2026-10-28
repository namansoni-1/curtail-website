from __future__ import annotations

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np

from curtail.engine.event import EventSpec
from curtail.engine.types import Job, JobType, TenantPolicy

T0 = datetime(2024, 7, 16, 18, 0, tzinfo=UTC)
TZ = ZoneInfo("America/New_York")


def spec(n: int = 6, price: float = 500.0, kind: str = "price", rebound: float = 50.0) -> EventSpec:
    return EventSpec("e1", T0, T0 + timedelta(minutes=5 * n), kind, np.full(n, price), rebound)


def job(jid: str = "j1", tenant: str = "A", jtype: JobType = JobType.TRAINING,
        start_min: float = -120, end_min: float = 600, slack_min: float | None = 1000,
        **kw) -> Job:
    start = T0 + timedelta(minutes=start_min)
    end = T0 + timedelta(minutes=end_min)
    deadline = None if slack_min is None else end + timedelta(minutes=slack_min)
    return Job(jid, tenant, jtype, start, end, deadline=deadline, **kw)


def policy(tenant: str = "A", **kw) -> TenantPolicy:
    base = {"opted_in": True, "max_reduction_pct": 100.0, "max_reduction_kw": None,
                "min_guaranteed_kw": 0.0, "compensation_per_mwh": 100.0}
    base.update(kw)
    return TenantPolicy(tenant, **base)
