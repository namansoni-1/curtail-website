"""Replay-level guarantees that only show up across several events."""

from datetime import timedelta

import numpy as np
import pandas as pd

from curtail.engine.replay import ReplayInputs, run_replay
from curtail.engine.types import Job, JobType
from curtail.params import ModelParams
from tests.helpers import T0, TZ, policy


def test_delay_accumulates_across_events():
    # One long training job with 30 minutes of slack, and an 8-hour price
    # spike that is split into two 4-hour chunks. Each chunk alone could
    # spend most of the slack; together they must not exceed it.
    idx = pd.date_range(pd.Timestamp(T0) - pd.Timedelta(hours=2), periods=12 * 14, freq="5min")
    end = T0 + timedelta(hours=20)
    job = Job("j1", "A", JobType.TRAINING, T0 - timedelta(hours=10), end,
              deadline=end + timedelta(minutes=30))
    price = np.where((idx >= pd.Timestamp(T0)) & (idx < pd.Timestamp(T0) + pd.Timedelta(hours=8)),
                     900.0, 40.0)
    inp = ReplayInputs(
        facility=pd.DataFrame({"total_kw": 200.0, "it_kw": 150.0}, index=idx),
        jobs=[job],
        job_power=pd.DataFrame({"ts": idx, "job_id": "j1", "kw": 100.0}),
        grid=pd.DataFrame({"price": price, "dr_flag": False, "emergency_flag": False}, index=idx),
        policies={"A": policy()},
        tz=TZ,
    )
    params = ModelParams(safety_margin=0.1)
    out = run_replay(inp, params)
    assert out["summary"]["events"] == 2
    total = sum(d["delay_minutes"] for e in out["events"] for d in e["decisions"]
                if d["action"] != "none")
    assert total > 0
    assert total <= 30 * 0.9 + 1e-6
