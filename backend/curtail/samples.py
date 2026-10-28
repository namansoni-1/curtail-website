"""Deterministic synthetic site for demos and the end-to-end test.

Shapes mirror real exports: jobs use `sacct` column names, node power uses
DCGM exporter names. Nothing here is real data.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd


def make_sample(out_dir: Path, days: int = 14, seed: int = 3) -> dict[str, Path]:
    rng = np.random.default_rng(seed)
    out_dir.mkdir(parents=True, exist_ok=True)
    start = pd.Timestamp("2024-07-08 00:00", tz="America/New_York")
    idx = pd.date_range(start, periods=days * 288, freq="5min")
    tenants = {"acme-ai": ("training", 10), "globex": ("inference", 6), "initech": ("batch", 8)}
    jobs, samples = [], []
    jid = 1000
    for tenant, (kind, streams) in tenants.items():
        for stream in range(streams):
            t = start + pd.Timedelta(minutes=int(rng.integers(0, 600)))
            while t < idx[-1]:
                dur = pd.Timedelta(hours=float(rng.uniform(4, 30) if kind != "inference" else 48))
                gpus = int(rng.choice([64, 128, 256]))
                end = min(t + dur, idx[-1])
                limit = dur * float(rng.uniform(1.2, 2.0))
                jobs.append(
                    {
                        "JobID": str(jid),
                        "Account": tenant,
                        "Partition": {
                            "training": "train-a100",
                            "inference": "serve",
                            "batch": "batch",
                        }[kind],
                        "Submit": (t - pd.Timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M:%S"),
                        "Start": t.strftime("%Y-%m-%dT%H:%M:%S"),
                        "End": end.strftime("%Y-%m-%dT%H:%M:%S"),
                        "Timelimit": _fmt_limit(limit),
                        "AllocTRES": f"cpu=64,gres/gpu={gpus}",
                        "Deadline": (end + pd.Timedelta(hours=float(rng.uniform(1, 12)))).strftime(
                            "%Y-%m-%dT%H:%M:%S"
                        )
                        if kind != "inference"
                        else "",
                    }
                )
                live = idx[(idx >= t) & (idx < end)]
                per_gpu = 0.30 if kind == "inference" else 0.38  # kW
                for ts in live:
                    level = per_gpu * (0.85 + 0.15 * rng.random())
                    if kind == "inference":
                        level *= 0.7 + 0.3 * np.sin((ts.hour - 6) / 24 * 2 * np.pi) ** 2
                    samples.append((ts, str(jid), gpus * level))
                jid += 1
                t = end + pd.Timedelta(minutes=int(rng.integers(5, 120)))

    jp = pd.DataFrame(samples, columns=["timestamp", "job_id", "kw"])
    it = (
        jp.groupby("timestamp")["kw"].sum().reindex(idx, fill_value=0.0) + 400.0
    )  # storage, network
    total = it * (1.25 + 0.15 * np.clip(np.sin((idx.hour - 9) / 24 * 2 * np.pi), 0, None))
    facility = pd.DataFrame(
        {
            "timestamp": idx.strftime("%Y-%m-%d %H:%M:%S"),
            "total_kw": total.round(2).to_numpy(),
            "it_kw": it.round(2).to_numpy(),
        }
    )

    price = (
        30
        + 25 * np.clip(np.sin((idx.hour - 8) / 24 * 2 * np.pi), 0, None)
        + rng.normal(0, 4, len(idx))
    )
    hot = (idx.hour >= 16) & (idx.hour < 19) & np.isin(idx.day, [10, 11, 16, 17])
    price = np.where(hot, price + rng.uniform(180, 600, len(idx)), price)
    dr = (idx.day == 18) & (idx.hour >= 14) & (idx.hour < 17)
    grid = pd.DataFrame(
        {
            "timestamp": idx.strftime("%Y-%m-%d %H:%M:%S"),
            "lmp": price.round(2),
            "dr_event": dr.astype(int),
        }
    )

    tenant_cfg = pd.DataFrame(
        [
            {
                "tenant_id": "acme-ai",
                "opted_in": "yes",
                "max_reduction_pct": 40,
                "max_reduction_kw": "",
                "min_guaranteed_kw": 200,
                "blackout_windows": "",
                "compensation_per_mwh": 120,
            },
            {
                "tenant_id": "globex",
                "opted_in": "yes",
                "max_reduction_pct": 10,
                "max_reduction_kw": 60,
                "min_guaranteed_kw": 100,
                "blackout_windows": "Mon-Fri 08:00-10:00",
                "compensation_per_mwh": 200,
            },
            {
                "tenant_id": "initech",
                "opted_in": "no",
                "max_reduction_pct": 50,
                "max_reduction_kw": "",
                "min_guaranteed_kw": 0,
                "blackout_windows": "",
                "compensation_per_mwh": 90,
            },
        ]
    )
    paths = {
        "facility_power": out_dir / "facility.csv",
        "jobs": out_dir / "sacct_jobs.csv",
        "job_power": out_dir / "job_power.parquet",
        "tenants": out_dir / "tenants.csv",
        "grid_signals": out_dir / "grid.csv",
    }
    facility.to_csv(paths["facility_power"], index=False)
    pd.DataFrame(jobs).to_csv(paths["jobs"], index=False)
    jp.assign(timestamp=jp["timestamp"].dt.tz_convert("UTC")).to_parquet(paths["job_power"])
    tenant_cfg.to_csv(paths["tenants"], index=False)
    grid.to_csv(paths["grid_signals"], index=False)
    return paths


def _fmt_limit(td: pd.Timedelta) -> str:
    mins = int(td.total_seconds() // 60)
    d, rem = divmod(mins, 1440)
    h, m = divmod(rem, 60)
    return f"{d}-{h:02d}:{m:02d}:00" if d else f"{h:02d}:{m:02d}:00"
