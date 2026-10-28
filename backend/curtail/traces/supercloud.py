"""MIT Supercloud Dataset adapter (datacenter-challenge/202201, public S3).

License: CC BY-NC-ND 4.0. Nothing from the dataset is committed to this
repository; this module downloads it into CURTAIL_DATA_DIR/traces.

What it builds, in Curtail's upload shapes so the normal ingestion path is
exercised:
- jobs.csv: GPU jobs from slurm-log.csv, with synthesized tenants and deadlines
- job_power.parquet: measured per-job power from the nvidia-smi traces (a
  sampled subset of jobs, under a download budget)
- facility.csv: synthesized facility load
- tenants.csv: synthesized tenant contracts

Every synthesized quantity is listed in ASSUMPTIONS.md (section "Public trace
validation").
"""

from __future__ import annotations

import concurrent.futures as cf
import hashlib
import io
import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

from curtail.config import settings

BUCKET = "https://mit-supercloud-dataset.s3.amazonaws.com"
PREFIX = "datacenter-challenge/202201"
NS = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
UNLIMITED = 4294967295


@dataclass
class SupercloudConfig:
    # Full coverage of a focused window beats a thin sample of the whole trace
    # (2.4 TB): February 2021 is ~20 GB and includes Winter Storm Uri.
    download_budget_gb: float = 30.0
    start: str = "2021-02-01"
    end: str = "2021-03-01"
    n_tenants: int = 8
    seed: int = 11
    interval_minutes: int = 5
    # Measured power is GPU only (nvidia-smi); whole-job power = GPU / share.
    gpu_power_share: float = 0.75
    # Non-GPU and idle-node load is unknown in the trace. Default 0: the
    # "facility" is the GPU jobs' own IT load times PUE, so results are not
    # diluted by an invented constant.
    baseline_it_kw: float = 0.0
    pue: float = 1.3
    max_slack_hours: float = 24.0

    @property
    def root(self) -> Path:
        return settings.data_dir / "traces" / "supercloud"


def _get(client: httpx.Client, url: str, **kw) -> httpx.Response:
    for attempt in range(4):
        try:
            r = client.get(url, timeout=300, **kw)
            r.raise_for_status()
            return r
        except httpx.HTTPError:
            if attempt == 3:
                raise
    raise AssertionError


def download_slurm(cfg: SupercloudConfig) -> Path:
    raw = cfg.root / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    with httpx.Client() as c:
        for name in ("slurm-log.csv", "labelled_jobids.csv"):
            p = raw / name
            if not p.exists():
                p.write_bytes(_get(c, f"{BUCKET}/{PREFIX}/{name}").content)
    return raw


def list_gpu_files(cfg: SupercloudConfig) -> pd.DataFrame:
    """All GPU trace keys with sizes (cached). File names are {jobid}-{node}.csv."""
    cache = cfg.root / "raw" / "gpu_index.parquet"
    if cache.exists():
        return pd.read_parquet(cache)

    def folder(i: int) -> list[tuple[str, int]]:
        out, token = [], None
        with httpx.Client() as c:
            while True:
                params = {"list-type": "2", "prefix": f"{PREFIX}/gpu/{i:04d}/"}
                if token:
                    params["continuation-token"] = token
                root = ET.fromstring(_get(c, f"{BUCKET}/", params=params).content)
                for el in root.findall("s3:Contents", NS):
                    out.append((el.find("s3:Key", NS).text, int(el.find("s3:Size", NS).text)))
                nxt = root.find("s3:NextContinuationToken", NS)
                if nxt is None:
                    return out
                token = nxt.text

    with cf.ThreadPoolExecutor(16) as ex:
        rows = [r for part in ex.map(folder, range(100)) for r in part]
    df = pd.DataFrame(rows, columns=["key", "size"])
    m = df["key"].str.extract(r"/(\d+)-([^/]+)\.csv$")
    df["id_job"], df["node"] = m[0].astype("int64"), m[1]
    df.to_parquet(cache)
    return df


def load_gpu_jobs(cfg: SupercloudConfig) -> pd.DataFrame:
    raw = download_slurm(cfg)
    df = pd.read_csv(raw / "slurm-log.csv", low_memory=False)
    df = df[df["tres_req"].astype(str).str.contains(r"100[12]=")].copy()
    for c in ("time_submit", "time_start", "time_end"):
        df[c] = pd.to_datetime(df[c], unit="s", utc=True)
    df = df[(df["time_start"] >= cfg.start) & (df["time_start"] < cfg.end)]
    df = df[df["time_end"] > df["time_start"]]
    df["gpus"] = df["tres_req"].astype(str).str.findall(r"100[12]=(\d+)").map(
        lambda xs: sum(int(x) for x in xs))
    return df


def sample_jobs(jobs: pd.DataFrame, index: pd.DataFrame, cfg: SupercloudConfig) -> pd.DataFrame:
    """Uniform random sample of GPU jobs whose trace files fit the budget."""
    files = index[index["id_job"].isin(jobs["id_job"])]
    per_job = files.groupby("id_job")["size"].sum().sample(frac=1.0, random_state=cfg.seed)
    budget = cfg.download_budget_gb * 1e9
    chosen = per_job[per_job.cumsum() <= budget].index
    return files[files["id_job"].isin(chosen)]


def _aggregate_file(content: bytes, interval: int) -> pd.Series:
    df = pd.read_csv(io.BytesIO(content), usecols=["timestamp", "gpu_index", "power_draw_W"])
    df["bin"] = pd.to_datetime(df["timestamp"], unit="s", utc=True).dt.floor(f"{interval}min")
    df["power_draw_W"] = pd.to_numeric(df["power_draw_W"], errors="coerce")
    per_gpu = df.groupby(["bin", "gpu_index"])["power_draw_W"].mean()
    return per_gpu.groupby("bin").sum() / 1000.0  # kW across the node's GPUs


def download_power(files: pd.DataFrame, cfg: SupercloudConfig, workers: int = 12) -> pd.DataFrame:
    """Download and aggregate traces; each file's result is cached so the
    download can resume."""
    out_dir = cfg.root / "power"
    out_dir.mkdir(parents=True, exist_ok=True)

    def one(row) -> pd.DataFrame | None:
        key = row.key
        p = out_dir / (hashlib.sha1(key.encode()).hexdigest()[:20] + ".parquet")
        if p.exists():
            return pd.read_parquet(p)
        with httpx.Client() as c:
            content = _get(c, f"{BUCKET}/{key}").content
        try:
            s = _aggregate_file(content, cfg.interval_minutes)
        except (ValueError, KeyError):
            return None
        df = pd.DataFrame({"ts": s.index, "id_job": row.id_job, "gpu_kw": s.to_numpy()})
        df.to_parquet(p)
        return df

    parts = []
    with cf.ThreadPoolExecutor(workers) as ex:
        for i, df in enumerate(ex.map(one, files.itertuples())):
            if df is not None:
                parts.append(df)
            if i % 200 == 0:
                print(f"  traces {i}/{len(files)}", flush=True)
    power = pd.concat(parts, ignore_index=True)
    # Multi-node jobs have one file per node: sum them.
    return power.groupby(["ts", "id_job"])["gpu_kw"].sum().reset_index()


def align_clock(power: pd.DataFrame, jobs: pd.DataFrame) -> tuple[pd.DataFrame, float]:
    """The nvidia-smi timestamps are not on the same clock as Slurm's: traces
    start a whole number of hours before their job does (Eastern wall-clock
    time written as if it were UTC). Detect the offset as the median gap
    between each job's first sample and its Slurm start, rounded to the hour,
    and shift the traces by it."""
    first = power.groupby("id_job")["ts"].min()
    start = jobs.set_index("id_job")["time_start"].reindex(first.index)
    gap_h = ((start - first).dt.total_seconds() / 3600).median()
    shift = float(round(gap_h)) if np.isfinite(gap_h) else 0.0
    return power.assign(ts=power["ts"] + pd.Timedelta(hours=shift)), shift


def synthesize_site(jobs: pd.DataFrame, power: pd.DataFrame, cfg: SupercloudConfig,
                    out: Path) -> dict[str, Path]:
    rng = np.random.default_rng(cfg.seed)
    power, clock_shift_h = align_clock(power, jobs)
    out.mkdir(parents=True, exist_ok=True)
    labelled = set(pd.read_csv(cfg.root / "raw" / "labelled_jobids.csv")["id_job"])

    # Tenants: users hashed into n synthetic tenants (stable across runs).
    tenant_of = {u: f"tenant-{int(hashlib.md5(str(u).encode()).hexdigest(), 16) % cfg.n_tenants + 1:02d}"
                 for u in jobs["id_user"].unique()}
    jobs = jobs.assign(tenant=jobs["id_user"].map(tenant_of))
    # Job type: interactive sessions are latency-sensitive (treated as
    # inference: cap within the floor only). Everything else that asked for
    # GPUs is treated as training. Labelled DNN jobs are training by definition.
    interactive = jobs["job_type"].astype(str).str.contains("INTERACTIVE")
    jobs["curtail_type"] = np.where(interactive & ~jobs["id_job"].isin(labelled), "inference",
                                    "training")

    # Deadlines: Supercloud has no SLAs, and requested walltimes are mostly
    # unlimited. Synthesize deadline = end + min(walltime slack, tenant SLA
    # slack fraction x runtime, max_slack_hours).
    tenants = sorted(set(tenant_of.values()))
    sla_frac = {t: float(rng.choice([0.05, 0.10, 0.25])) for t in tenants}
    runtime = jobs["time_end"] - jobs["time_start"]
    walltime_slack = np.where(jobs["timelimit"] >= UNLIMITED, np.inf,
                              (jobs["time_start"] + pd.to_timedelta(jobs["timelimit"], "min")
                               - jobs["time_end"]).dt.total_seconds())
    sla_slack = runtime.dt.total_seconds() * jobs["tenant"].map(sla_frac)
    slack_s = np.clip(np.minimum(np.minimum(walltime_slack, sla_slack), cfg.max_slack_hours * 3600), 0, None)
    jobs["deadline"] = jobs["time_end"] + pd.to_timedelta(slack_s, "s")
    jobs.loc[jobs["curtail_type"] == "inference", "deadline"] = pd.NaT

    measured = set(power["id_job"])
    jobs_out = pd.DataFrame({
        "JobID": jobs["id_job"].astype(str), "Account": jobs["tenant"],
        "Partition": jobs["curtail_type"],
        "Submit": jobs["time_submit"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Start": jobs["time_start"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "End": jobs["time_end"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Timelimit": jobs["timelimit"].where(jobs["timelimit"] < UNLIMITED).astype("Int64"),
        "AllocTRES": "gres/gpu=" + jobs["gpus"].astype(str),
        "Deadline": jobs["deadline"].dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
    })
    # Only jobs with measured power can be acted on; keep the others in the
    # job table (they show up as protected: no power data).
    jp = power.assign(job_id=power["id_job"].astype(str),
                      kw=power["gpu_kw"] / cfg.gpu_power_share)[["ts", "job_id", "kw"]]

    # Facility load: measured jobs + estimated power of unmeasured GPU jobs
    # (median measured kW per GPU x GPUs) + constant baseline, times PUE.
    step = f"{cfg.interval_minutes}min"
    idx = pd.date_range(pd.Timestamp(cfg.start, tz="UTC"), pd.Timestamp(cfg.end, tz="UTC"),
                        freq=step, inclusive="left")
    measured_kw = jp.groupby("ts")["kw"].sum().reindex(idx, fill_value=0.0)
    gpu_count = jobs.set_index("id_job")["gpus"]
    per_gpu = (power.groupby("id_job")["gpu_kw"].mean() / gpu_count.reindex(
        power["id_job"].unique()).clip(lower=1)).median() / cfg.gpu_power_share
    est = np.zeros(len(idx))
    unmeasured = jobs[~jobs["id_job"].isin(measured)]
    starts = np.searchsorted(idx.values, unmeasured["time_start"].dt.floor(step).values)
    ends = np.searchsorted(idx.values, unmeasured["time_end"].dt.ceil(step).values)
    delta = np.zeros(len(idx) + 1)
    np.add.at(delta, starts, unmeasured["gpus"].to_numpy() * per_gpu)
    np.add.at(delta, ends, -unmeasured["gpus"].to_numpy() * per_gpu)
    est = np.cumsum(delta)[:-1]
    it = measured_kw.to_numpy() + est + cfg.baseline_it_kw
    facility = pd.DataFrame({"timestamp": idx.strftime("%Y-%m-%dT%H:%M:%SZ"),
                             "total_kw": (it * cfg.pue).round(3), "it_kw": it.round(3)})

    # Tenant contracts: 6 of 8 opt in; limits and rates drawn from plausible
    # ranges; minimum guaranteed = 30% of the tenant's median measured load.
    tload = jp.merge(jobs_out[["JobID", "Account"]], left_on="job_id", right_on="JobID")
    med = tload.groupby(["Account", "ts"])["kw"].sum().groupby("Account").median()
    rows = []
    for i, t in enumerate(tenants):
        rows.append({
            "tenant_id": t,
            "opted_in": "no" if i in (2, 5) else "yes",
            "max_reduction_pct": float(rng.choice([20, 30, 50])),
            "max_reduction_kw": "",
            "min_guaranteed_kw": round(0.3 * float(med.get(t, 0.0)), 2),
            "blackout_windows": "Mon-Fri 09:00-17:00" if i == 0 else "",
            "compensation_per_mwh": float(rng.choice([100, 150, 200])),
        })
    paths = {"jobs": out / "jobs.csv", "job_power": out / "job_power.parquet",
             "facility_power": out / "facility.csv", "tenants": out / "tenants.csv"}
    jobs_out.to_csv(paths["jobs"], index=False)
    jp.to_parquet(paths["job_power"])
    facility.to_csv(paths["facility_power"], index=False)
    pd.DataFrame(rows).to_csv(paths["tenants"], index=False)
    meta = {
        "gpu_jobs_in_window": len(jobs), "jobs_with_measured_power": len(measured),
        "measured_energy_share": float(measured_kw.sum() / max(1e-9, (measured_kw.to_numpy() + est).sum())),
        "per_gpu_kw_estimate": float(per_gpu),
        "gpu_trace_clock_shift_hours": clock_shift_h, "tenant_sla_slack_frac": sla_frac,
        "config": {k: v for k, v in cfg.__dict__.items()},
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=2, default=str))
    return paths


def build(cfg: SupercloudConfig | None = None) -> dict[str, Path]:
    cfg = cfg or SupercloudConfig()
    jobs = load_gpu_jobs(cfg)
    print(f"GPU jobs in window: {len(jobs)}")
    index = list_gpu_files(cfg)
    files = sample_jobs(jobs, index, cfg)
    print(f"Sampled {files['id_job'].nunique()} jobs, {files['size'].sum() / 1e9:.2f} GB "
          f"in {len(files)} files")
    power = download_power(files, cfg)
    return synthesize_site(jobs, power, cfg, cfg.root / "site")

