"""LightGBM forecast of each running job's power over an event window.

Used by the "forecast" replay mode so decisions are made only with what was
knowable at event start (recent power, elapsed time, requested walltime, job
type, time of day), then scored against what actually happened.

To avoid training on the events being evaluated, the history is split into
contiguous time blocks; each event is predicted by a model trained on the
other blocks.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import lightgbm as lgb
import numpy as np
import pandas as pd

from curtail.engine.replay import ReplayInputs
from curtail.engine.types import Job, JobType
from curtail.params import ModelParams

TYPE_CODE = {t: i for i, t in enumerate(JobType)}
HISTORY = 12  # intervals of recent power used as features


@dataclass
class _Block:
    start: pd.Timestamp
    end: pd.Timestamp
    model: lgb.Booster


def _features(p_hist: np.ndarray, job: Job, t0: pd.Timestamp, h: np.ndarray) -> np.ndarray:
    last = p_hist[-1]
    recent = p_hist[p_hist > 0]
    elapsed = (t0 - pd.Timestamp(job.start)).total_seconds() / 3600
    remaining = (np.nan if job.timelimit_end is None
                 else (pd.Timestamp(job.timelimit_end) - t0).total_seconds() / 3600)
    base = [last, recent.mean() if len(recent) else 0.0, recent.std() if len(recent) else 0.0,
            elapsed, remaining, TYPE_CODE[job.job_type], t0.hour, t0.day_of_week]
    return np.column_stack([np.tile(base, (len(h), 1)), h])


class JobPowerForecaster:
    history_intervals = HISTORY

    def __init__(self, blocks: list[_Block], step: pd.Timedelta, start_kw: dict[str, float]):
        self.blocks = blocks
        self.step = step
        self.start_kw = start_kw  # median first-hour power by job type, for unstarted jobs

    @classmethod
    def fit(cls, inp: ReplayInputs, params: ModelParams, n_blocks: int = 4,
            seed: int = 0) -> JobPowerForecaster:
        step = pd.Timedelta(minutes=params.interval_minutes)
        horizon = params.max_event_minutes // params.interval_minutes
        rng = np.random.default_rng(seed)
        jp = inp.job_power.copy()
        jp["bin"] = ((jp["ts"] - jp["ts"].min()) / step).astype(int)
        t_origin = jp["ts"].min()
        jobs = {j.job_id: j for j in inp.jobs}
        series: dict[str, tuple[int, np.ndarray]] = {}
        for jid, g in jp.groupby("job_id"):
            if jid not in jobs:
                continue
            lo, hi = int(g["bin"].min()), int(g["bin"].max())
            arr = np.zeros(hi - lo + 1)
            np.add.at(arr, g["bin"].to_numpy() - lo, g["kw"].to_numpy())
            series[jid] = (lo, arr)

        start_kw: dict[str, float] = {}
        by_type: dict[JobType, list[float]] = {}
        for jid, (_, arr) in series.items():
            by_type.setdefault(jobs[jid].job_type, []).append(float(arr[:12].mean()))
        for t, v in by_type.items():
            start_kw[t.value] = float(np.median(v))

        # Sample (job, t0) pairs weighted by job length.
        ids = list(series)
        lengths = np.array([len(series[i][1]) for i in ids], dtype=float)
        valid = lengths > HISTORY + 1
        ids = [i for i, v in zip(ids, valid) if v]
        lengths = lengths[valid]
        if not ids:
            raise ValueError("Not enough job power history to train the forecaster")
        n_samples = min(params.forecast_train_samples // max(1, horizon // 4), int(lengths.sum()))
        picks = rng.choice(len(ids), size=n_samples, p=lengths / lengths.sum())
        X, y, t0s = [], [], []
        for k in picks:
            jid = ids[k]
            lo, arr = series[jid]
            i = int(rng.integers(HISTORY, len(arr)))
            t0 = t_origin + (lo + i) * step
            hs = rng.choice(np.arange(1, horizon + 1), size=min(4, horizon), replace=False)
            last = arr[i - 1]
            if last <= 0:
                continue
            fut = np.array([arr[i + h - 1] if i + h - 1 < len(arr) else 0.0 for h in hs])
            X.append(_features(arr[i - HISTORY:i], jobs[jid], t0, hs))
            y.append(fut / last)
            t0s += [t0] * len(hs)
        X = np.vstack(X)
        y = np.concatenate(y)
        t0s = pd.DatetimeIndex(t0s)

        edges = pd.date_range(jp["ts"].min(), jp["ts"].max() + step, periods=n_blocks + 1)
        blocks = []
        for b in range(n_blocks):
            inside = (t0s >= edges[b]) & (t0s < edges[b + 1])
            train = ~inside
            ds = lgb.Dataset(X[train], y[train])
            model = lgb.train({"objective": "l2", "learning_rate": 0.05, "num_leaves": 31,
                               "min_data_in_leaf": 50, "verbosity": -1, "seed": seed}, ds, 200)
            blocks.append(_Block(edges[b], edges[b + 1], model))
        return cls(blocks, step, start_kw)

    def _model_for(self, t0: pd.Timestamp) -> lgb.Booster:
        for b in self.blocks:
            if b.start <= t0 < b.end:
                return b.model
        return self.blocks[-1].model

    def predict(self, jobs: list[Job], hist: dict[str, np.ndarray], ws: datetime,
                n: int) -> dict[str, np.ndarray]:
        t0 = pd.Timestamp(ws)
        model = self._model_for(t0)
        hs = np.arange(1, n + 1)
        out: dict[str, np.ndarray] = {}
        for j in jobs:
            h = hist.get(j.job_id)
            if h is None or h[-1] <= 0:
                if pd.Timestamp(j.start) >= t0:  # queued: known to start, power unknown
                    off = int((pd.Timestamp(j.start) - t0) / self.step)
                    arr = np.zeros(n)
                    arr[max(0, off):] = self.start_kw.get(j.job_type.value, 0.0)
                    out[j.job_id] = arr
                continue
            ratio = np.clip(model.predict(_features(h, j, t0, hs)), 0.0, 2.0)
            out[j.job_id] = ratio * h[-1]
        return out
