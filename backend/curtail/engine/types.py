"""Plain data the engine works on. Nothing here touches the database, so the
optimizer and verifier can be tested with hand-built inputs."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, time
from enum import StrEnum
from zoneinfo import ZoneInfo


class JobType(StrEnum):
    TRAINING = "training"
    BATCH = "batch"
    INFERENCE = "inference"
    UNKNOWN = "unknown"


class ActionKind(StrEnum):
    NONE = "none"
    CAP = "cap"
    PAUSE = "pause"
    DEFER = "defer"


@dataclass(frozen=True)
class Blackout:
    """A window in which the tenant forbids any reduction.

    Either recurring (`days` 0=Mon..6=Sun with local `start`/`end` times; an
    end before start wraps past midnight) or absolute (`starts_at`/`ends_at`).
    """

    days: tuple[int, ...] = ()
    start: time | None = None
    end: time | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None

    def overlaps(self, ws: datetime, we: datetime, tz: ZoneInfo) -> bool:
        if self.starts_at is not None and self.ends_at is not None:
            return self.starts_at < we and ws < self.ends_at
        if self.start is None or self.end is None:
            return False
        # Walk the event in local time; events are at most a few hours long.
        cur = ws.astimezone(tz)
        end = we.astimezone(tz)
        step = 5
        from datetime import timedelta

        while cur < end:
            t = cur.time()
            day = cur.weekday()
            if self.start <= self.end:
                hit = (not self.days or day in self.days) and self.start <= t < self.end
            else:  # wraps midnight: the window belongs to the day it starts on
                prev = (day - 1) % 7
                hit = (t >= self.start and (not self.days or day in self.days)) or (
                    t < self.end and (not self.days or prev in self.days)
                )
            if hit:
                return True
            cur += timedelta(minutes=step)
        return False


@dataclass(frozen=True)
class TenantPolicy:
    tenant_id: str
    opted_in: bool | None = None
    max_reduction_pct: float | None = None  # 0..100 of the tenant's live power
    max_reduction_kw: float | None = None
    min_guaranteed_kw: float | None = None
    blackouts: tuple[Blackout, ...] = ()
    compensation_per_mwh: float | None = None


@dataclass(frozen=True)
class Job:
    job_id: str
    tenant_id: str | None
    job_type: JobType
    start: datetime
    end: datetime
    submit: datetime | None = None
    deadline: datetime | None = None
    timelimit_end: datetime | None = None  # start + requested walltime
    checkpointable: bool | None = None


@dataclass
class Decision:
    job_id: str
    tenant_id: str | None
    action: ActionKind
    cap_power_frac: float | None = None
    reduction_kw: list[float] = field(default_factory=list)  # IT kW per interval
    delay_minutes: float = 0.0
    slack_minutes: float | None = None
    reason: str = ""
    flags: list[str] = field(default_factory=list)

    @property
    def avg_reduction_kw(self) -> float:
        return sum(self.reduction_kw) / len(self.reduction_kw) if self.reduction_kw else 0.0
