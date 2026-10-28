"""Find event windows in a resampled grid-signal series."""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from curtail.params import ModelParams


@dataclass
class Window:
    start: pd.Timestamp
    end: pd.Timestamp  # exclusive
    kind: str  # "emergency", "dr" or "price"


def detect_windows(grid: pd.DataFrame, params: ModelParams) -> list[Window]:
    """`grid` is indexed by UTC interval start with columns price (float, may be
    NaN), dr_flag and emergency_flag (bool). Grid events take precedence over
    price spikes; long runs are split into chunks of max_event_minutes."""
    step = pd.Timedelta(minutes=params.interval_minutes)
    emergency = grid.get("emergency_flag", pd.Series(False, index=grid.index)).fillna(False)
    dr = grid.get("dr_flag", pd.Series(False, index=grid.index)).fillna(False)
    price = grid.get("price", pd.Series(float("nan"), index=grid.index))
    hot = price >= params.price_threshold_per_mwh

    kind = pd.Series("", index=grid.index, dtype=object)
    kind[hot.fillna(False)] = "price"
    if params.include_grid_events:
        kind[dr.astype(bool)] = "dr"
        kind[emergency.astype(bool)] = "emergency"

    windows: list[Window] = []
    run_start = None
    run_kind = ""
    prev_ts = None
    for ts, k in kind.items():
        contiguous = prev_ts is not None and ts - prev_ts == step
        if run_start is not None and (k != run_kind or not contiguous):
            windows.extend(_split(run_start, prev_ts + step, run_kind, params))
            run_start = None
        if k and run_start is None:
            run_start, run_kind = ts, k
        prev_ts = ts
    if run_start is not None:
        windows.extend(_split(run_start, prev_ts + step, run_kind, params))
    return windows


def _split(start: pd.Timestamp, end: pd.Timestamp, kind: str, params: ModelParams) -> list[Window]:
    if (end - start) < pd.Timedelta(minutes=params.min_event_minutes):
        return []
    chunk = pd.Timedelta(minutes=params.max_event_minutes)
    out = []
    cur = start
    while cur < end:
        nxt = min(cur + chunk, end)
        if nxt - cur >= pd.Timedelta(minutes=params.min_event_minutes):
            out.append(Window(cur, nxt, kind))
        cur = nxt
    return out
