"""Every number-affecting modeling assumption lives here.

Each field is documented in ASSUMPTIONS.md. A replay run stores the exact
ModelParams it used, so results are always reproducible from the run record.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class CapPoint(BaseModel):
    """One point on the power-cap curve: drawing `power_frac` of the job's
    uncapped GPU power yields `throughput_frac` of its uncapped throughput."""

    power_frac: float = Field(ge=0, le=1)
    throughput_frac: float = Field(ge=0, le=1)


DEFAULT_CAP_CURVE = [
    CapPoint(power_frac=1.0, throughput_frac=1.0),
    CapPoint(power_frac=0.9, throughput_frac=0.97),
    CapPoint(power_frac=0.8, throughput_frac=0.92),
    CapPoint(power_frac=0.7, throughput_frac=0.85),
    CapPoint(power_frac=0.6, throughput_frac=0.76),
]


class ModelParams(BaseModel):
    # --- event detection -------------------------------------------------
    price_threshold_per_mwh: float = 200.0
    include_grid_events: bool = True
    min_event_minutes: int = 15
    max_event_minutes: int = 240
    interval_minutes: int = 5

    # --- safety ------------------------------------------------------------
    # Tightens every constraint (deadline slack used, tenant allowance used,
    # tenant minimum kept) and derates the reported reduction by this fraction.
    safety_margin: float = Field(default=0.10, ge=0, lt=1)

    # --- power capping -----------------------------------------------------
    cap_curve: list[CapPoint] = Field(default_factory=lambda: list(DEFAULT_CAP_CURVE))
    # Share of a job's measured power that is GPU power and responds to a cap.
    # CPU, memory, NIC and storage power stay unchanged.
    gpu_power_share: float = Field(default=0.75, ge=0, le=1)
    # Inference jobs may never be capped below this fraction of their power.
    inference_floor_frac: float = Field(default=0.8, ge=0, le=1)

    # --- pause with checkpoint --------------------------------------------
    checkpoint_minutes: float = 10.0  # power stays at baseline while checkpointing
    restart_minutes: float = 10.0  # lost work after resume, added to delay
    # Power a paused job keeps drawing (idle GPUs, host) as a fraction of baseline.
    paused_power_frac: float = Field(default=0.25, ge=0, le=1)

    # --- facility ----------------------------------------------------------
    # Facility-meter kW saved per IT kW saved. 1.0 credits no cooling savings.
    facility_kw_per_it_kw: float = 1.0
    # Used only when IT kW is missing: it_kw = total_kw / assumed_pue.
    assumed_pue: float = 1.4

    # --- economics ---------------------------------------------------------
    # "rt_price": the operator buys energy at the real-time price, so a kWh
    # avoided is worth that price. "fixed": worth `fixed_energy_price_per_mwh`.
    energy_value_basis: Literal["rt_price", "fixed"] = "rt_price"
    fixed_energy_price_per_mwh: float = 80.0
    # Extra $/MWh paid for reductions during a flagged DR or emergency event.
    dr_payment_per_mwh: float = 0.0
    # Used when a tenant's compensation rate is missing (flagged).
    default_compensation_per_mwh: float = 150.0

    # --- objective ---------------------------------------------------------
    objective: Literal["mwh", "net_revenue"] = "mwh"

    # --- missing-data policies (strict by default) --------------------------
    missing_deadline_policy: Literal["strict", "timelimit"] = "strict"
    missing_min_guaranteed_policy: Literal["strict", "zero"] = "strict"
    # Opt-in rate scenario: keep this fraction of opted-in tenants (by kW,
    # largest first excluded deterministically). 1.0 = as configured.
    opt_in_rate: float = Field(default=1.0, ge=0, le=1)

    # --- decision mode ------------------------------------------------------
    # "hindsight" decides with actual job power. "forecast" decides with
    # LightGBM-predicted power, then scores against actuals.
    mode: Literal["hindsight", "forecast"] = "hindsight"
    forecast_train_samples: int = 200_000

    solver_time_limit_s: float = 5.0

    @field_validator("cap_curve")
    @classmethod
    def _curve_sorted(cls, v: list[CapPoint]) -> list[CapPoint]:
        v = sorted(v, key=lambda p: -p.power_frac)
        if not v or v[0].power_frac != 1.0 or v[0].throughput_frac != 1.0:
            raise ValueError("cap_curve must include the point (1.0, 1.0)")
        return v

    @property
    def dt_hours(self) -> float:
        return self.interval_minutes / 60.0
