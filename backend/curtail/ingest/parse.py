"""Read an uploaded file, apply a column mapping, coerce types, and resample."""

from __future__ import annotations

import ast
import re
from pathlib import Path

import numpy as np
import pandas as pd

from curtail.ingest.schemas import DATASETS

POWER_UNITS = {"W": 0.001, "kW": 1.0, "MW": 1000.0}
DEFAULT_UNITS = {"power_w": "W"}  # everything else defaults to kW


def read_table(path: Path, nrows: int | None = None) -> pd.DataFrame:
    suffix = path.suffix.lower()
    if suffix in (".parquet", ".pq"):
        df = pd.read_parquet(path)
        return df.head(nrows) if nrows else df
    if suffix in (".csv", ".txt", ".gz"):
        sep = "|" if _sniff_pipe(path) else ","
        return pd.read_csv(path, nrows=nrows, sep=sep, low_memory=False)
    raise ValueError(f"Unsupported file type {suffix!r}; upload CSV or Parquet")


def _sniff_pipe(path: Path) -> bool:
    # `sacct --parsable2` output is pipe-delimited.
    opener = __import__("gzip").open if path.suffix == ".gz" else open
    with opener(path, "rt", errors="ignore") as f:
        head = f.readline()
    return head.count("|") > head.count(",")


def parse_time(s: pd.Series, tz: str) -> pd.Series:
    if pd.api.types.is_numeric_dtype(s):
        v = s.astype(float)
        unit = "ms" if v.dropna().abs().median() > 1e11 else "s"
        return pd.to_datetime(v, unit=unit, utc=True, errors="coerce")
    s = s.astype("string").str.strip().replace(
        {"Unknown": pd.NA, "None": pd.NA, "": pd.NA, "nan": pd.NA, "NaT": pd.NA})
    out = pd.to_datetime(s, errors="coerce", format="mixed", utc=False)
    if getattr(out.dt, "tz", None) is None:
        out = out.dt.tz_localize(tz, ambiguous="NaT", nonexistent="NaT")
    return out.dt.tz_convert("UTC")


_DUR = re.compile(r"^(?:(\d+)-)?(?:(\d+):)?(\d+)(?::(\d+))?$")


def parse_duration_minutes(s: pd.Series) -> pd.Series:
    """Slurm Timelimit ('1-02:00:00', '02:00:00', '30:00', '90') to minutes."""
    if pd.api.types.is_numeric_dtype(s):
        v = s.astype(float)
        return v.where(v < 1e9)  # 4294967295 / INFINITE sentinels

    def one(x):
        if x is None or (isinstance(x, float) and np.isnan(x)):
            return np.nan
        x = str(x).strip()
        m = _DUR.match(x)
        if not m:
            return np.nan
        d, a, b, c = m.groups()
        days = int(d or 0)
        if c is not None:  # [D-]HH:MM:SS
            h, mi, sec = int(a or 0), int(b), int(c)
        elif a is not None:  # MM:SS, or HH:MM:SS when a day part is given
            h, mi, sec = (int(a), int(b), 0) if d else (0, int(a), int(b))
        else:
            h, mi, sec = 0, int(b), 0
        return days * 1440 + h * 60 + mi + sec / 60

    return s.map(one).astype(float)


def parse_bool(s: pd.Series) -> pd.Series:
    if pd.api.types.is_bool_dtype(s):
        return s.astype("boolean")
    m = s.astype("string").str.strip().str.lower()
    out = pd.Series(pd.NA, index=s.index, dtype="boolean")
    out[m.isin(["true", "t", "yes", "y", "1", "1.0"])] = True
    out[m.isin(["false", "f", "no", "n", "0", "0.0"])] = False
    return out


_BRACKET = re.compile(r"^(.*?)\[([^\]]+)\](.*)$")


def expand_nodelist(x) -> list[str]:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return []
    x = str(x).strip()
    if x.startswith("["):
        try:
            return [str(v) for v in ast.literal_eval(x)]
        except (ValueError, SyntaxError):
            pass
    out: list[str] = []
    for part in re.split(r",(?![^\[]*\])", x):
        m = _BRACKET.match(part)
        if not m:
            if part:
                out.append(part)
            continue
        pre, body, post = m.groups()
        for rng in body.split(","):
            if "-" in rng:
                a, b = rng.split("-", 1)
                out += [f"{pre}{str(i).zfill(len(a))}{post}" for i in range(int(a), int(b) + 1)]
            else:
                out.append(f"{pre}{rng}{post}")
    return out


_GPU = re.compile(r"(?:gres/gpu|gpu)[^=,]*=(\d+)|(?:100[12])=(\d+)")


def parse_gpus(s: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(s):
        return s.astype("Int64")

    def one(x):
        if x is None or (isinstance(x, float) and np.isnan(x)):
            return pd.NA
        x = str(x)
        if x.strip().isdigit():
            return int(x)
        hits = _GPU.findall(x)
        return sum(int(a or b) for a, b in hits) if hits else 0

    return s.map(one).astype("Int64")


def classify_job_type(s: pd.Series, value_map: dict[str, str] | None) -> pd.Series:
    """Map a source column to training/inference/batch/unknown. An explicit
    value map wins; otherwise keyword heuristics; anything else is unknown
    (which the engine treats as protected)."""
    raw = s.astype("string").str.strip()
    if value_map:
        lowered = {str(k).lower(): v for k, v in value_map.items()}
        mapped = raw.str.lower().map(lowered)
        return mapped.fillna("unknown")
    low = raw.str.lower().fillna("")
    out = pd.Series("unknown", index=s.index, dtype=object)
    out[low.str.contains(r"batch|cpu|etl|hpc", regex=True)] = "batch"
    out[low.str.contains(r"train|finetune|fine-tune|pretrain", regex=True)] = "training"
    out[low.str.contains(r"infer|serv|predict|online", regex=True)] = "inference"
    out[low.isin(["training", "inference", "batch"])] = low[low.isin(["training", "inference", "batch"])]
    return out


def apply_mapping(df: pd.DataFrame, kind: str, mapping: dict[str, str],
                  options: dict) -> tuple[pd.DataFrame, dict]:
    """Return a canonical frame and parse stats (rows dropped and why)."""
    fields = {f.name: f for f in DATASETS[kind]}
    missing = [f for f, spec in fields.items() if spec.required and f not in mapping]
    if missing:
        raise ValueError(f"Required fields not mapped: {', '.join(missing)}")
    tz = options.get("timezone", "UTC")
    units = {**DEFAULT_UNITS, **options.get("units", {})}
    out = pd.DataFrame(index=df.index)
    for name, col in mapping.items():
        if name not in fields or col not in df.columns:
            continue
        kindf = fields[name].kind
        s = df[col]
        if kindf == "time":
            out[name] = parse_time(s, tz)
        elif kindf == "power":
            out[name] = pd.to_numeric(s, errors="coerce") * POWER_UNITS[units.get(name, "kW")]
        elif kindf == "float":
            out[name] = pd.to_numeric(s, errors="coerce")
        elif kindf == "bool":
            out[name] = parse_bool(s)
        elif kindf == "int":
            out[name] = parse_gpus(s) if name == "gpus" else pd.to_numeric(s, errors="coerce")
        elif kindf == "duration":
            out[name] = parse_duration_minutes(s)
        elif kindf == "list":
            out[name] = s.map(expand_nodelist)
        else:
            out[name] = s.astype("string").str.strip()
    if kind == "jobs":
        src = out["job_type"] if "job_type" in out else pd.Series(pd.NA, index=out.index)
        out["job_type"] = classify_job_type(src, options.get("job_type_map"))
        # Slurm job steps (123.batch, 123.0) duplicate their parent job.
        out = out[~out["job_id"].str.contains(r"\.", regex=True, na=False)]
    required = [f for f, spec in fields.items() if spec.required]
    before = len(out)
    out = out.dropna(subset=required)
    stats = {"rows_in": len(df), "rows_unparseable": int(before - len(out))}
    return out.reset_index(drop=True), stats


def resample_series(df: pd.DataFrame, interval_min: int, agg: dict[str, str]) -> pd.DataFrame:
    """Bin to interval starts. Missing bins stay NaN (they are reported, never
    filled silently)."""
    rule = f"{interval_min}min"
    g = df.set_index("ts").sort_index()
    out = g[list(agg)].resample(rule, label="left", closed="left").agg(agg)
    full = pd.date_range(out.index.min(), out.index.max(), freq=rule)
    return out.reindex(full)


def node_to_job_power(df: pd.DataFrame, jobs: pd.DataFrame | None,
                      interval_min: int) -> tuple[pd.DataFrame, dict]:
    """Aggregate per-GPU samples to per-job kW per interval.

    Uses the sample's own job label when present; otherwise attributes a
    host's power to the job(s) whose node list includes that host at that
    time, split evenly (flagged)."""
    rule = f"{interval_min}min"
    df = df.copy()
    df["bin"] = df["ts"].dt.floor(rule)
    gpu = df["gpu"] if "gpu" in df else pd.Series("0", index=df.index)
    df["gpu"] = gpu.fillna("0")
    stats = {"samples": len(df), "split_attribution_bins": 0, "unattributed_kw_bins": 0}
    keys = ["bin", "host", "gpu"]
    if "job_id" in df and df["job_id"].notna().any():
        per = df.groupby([*keys, "job_id"], dropna=False)["power_w"].mean().reset_index()
        unlabeled = per["job_id"].isna()
        stats["unattributed_kw_bins"] = int(unlabeled.sum())
        per = per[~unlabeled]
        out = per.groupby(["bin", "job_id"])["power_w"].sum().reset_index()
    else:
        if jobs is None or "nodes" not in jobs:
            raise ValueError("Node power has no job label; upload job records with node lists first")
        per = df.groupby(keys)["power_w"].mean().reset_index()
        host_bin = per.groupby(["bin", "host"])["power_w"].sum().reset_index()
        rows = []
        exploded = jobs[["job_id", "start", "end", "nodes"]].explode("nodes").dropna(subset=["nodes"])
        for host, grp in host_bin.groupby("host"):
            js = exploded[exploded["nodes"] == host]
            for b, w in zip(grp["bin"], grp["power_w"]):
                live = js[(js["start"] <= b) & (js["end"] > b)]
                if live.empty:
                    stats["unattributed_kw_bins"] += 1
                    continue
                if len(live) > 1:
                    stats["split_attribution_bins"] += 1
                for jid in live["job_id"]:
                    rows.append((b, jid, w / len(live)))
        out = pd.DataFrame(rows, columns=["bin", "job_id", "power_w"])
    out = out.rename(columns={"bin": "ts"})
    out["kw"] = out.pop("power_w")  # already converted to kW by apply_mapping
    return out[["ts", "job_id", "kw"]], stats
