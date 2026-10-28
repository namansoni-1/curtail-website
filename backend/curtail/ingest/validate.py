"""Validation reports shown after each upload."""

from __future__ import annotations

import pandas as pd


def _range(s: pd.Series) -> dict:
    s = s.dropna()
    if s.empty:
        return {"start": None, "end": None}
    return {"start": s.min().isoformat(), "end": s.max().isoformat()}


def series_report(raw: pd.DataFrame, resampled: pd.DataFrame, interval_min: int,
                  value_cols: list[str]) -> dict:
    """Coverage, gaps and outliers for a time series."""
    rep: dict = {"date_range": _range(raw["ts"]), "interval_minutes": interval_min}
    rep["duplicate_timestamps"] = int(raw["ts"].duplicated().sum())
    primary = value_cols[0]
    missing = resampled[primary].isna()
    rep["intervals_total"] = len(resampled)
    rep["intervals_missing"] = int(missing.sum())
    rep["coverage_pct"] = round(100 * (1 - missing.mean()), 2) if len(resampled) else 0.0
    gaps = []
    if missing.any():
        run_id = (missing != missing.shift()).cumsum()
        for _, grp in resampled[missing].groupby(run_id[missing]):
            gaps.append({"start": grp.index[0].isoformat(),
                         "intervals": len(grp),
                         "hours": round(len(grp) * interval_min / 60, 2)})
        gaps.sort(key=lambda g: -g["intervals"])
    rep["largest_gaps"] = gaps[:10]
    outliers = {}
    for c in value_cols:
        if c not in resampled:
            continue
        v = resampled[c].dropna()
        if v.empty:
            continue
        med = v.median()
        mad = (v - med).abs().median() or 1e-9
        z = (v - med).abs() / (1.4826 * mad)
        outliers[c] = {"negative": int((v < 0).sum()), "robust_z_gt_8": int((z > 8).sum()),
                       "min": float(v.min()), "median": float(med), "max": float(v.max())}
    rep["outliers"] = outliers
    if {"it_kw", "total_kw"} <= set(resampled.columns):
        rep["it_exceeds_total"] = int((resampled["it_kw"] > resampled["total_kw"] * 1.001).sum())
    return rep


def jobs_report(jobs: pd.DataFrame) -> dict:
    rep = {"date_range": _range(jobs["start"]), "jobs": len(jobs)}
    rep["end_before_start"] = int((jobs["end"] < jobs["start"]).sum())
    rep["duplicate_job_ids"] = int(jobs["job_id"].duplicated().sum())
    rep["job_types"] = jobs["job_type"].value_counts().to_dict()
    rep["missing_tenant"] = int(jobs["tenant_id"].isna().sum()) if "tenant_id" in jobs else len(jobs)
    rep["missing_deadline"] = int(jobs["deadline"].isna().sum()) if "deadline" in jobs else len(jobs)
    rep["missing_timelimit"] = (int(jobs["timelimit"].isna().sum()) if "timelimit" in jobs
                                else len(jobs))
    return rep


def tenants_report(t: pd.DataFrame, blackout_errors: list[str]) -> dict:
    fields = ["opted_in", "max_reduction_pct", "max_reduction_kw", "min_guaranteed_kw",
              "compensation_per_mwh"]
    return {
        "tenants": int(t["tenant_id"].nunique()),
        "missing_values": {f: int(t[f].isna().sum()) if f in t else len(t) for f in fields},
        "blackout_parse_errors": blackout_errors[:20],
        "note": "Missing fields are treated strictly: the tenant is protected (not reduced).",
    }
