"""Upload -> mapping -> validated rows in the database -> engine inputs."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from curtail.config import settings
from curtail.db import (
    Dataset,
    FacilityPower,
    GridSignal,
    JobPower,
    JobRow,
    Site,
    TenantPolicyRow,
)
from curtail.engine.replay import ReplayInputs
from curtail.engine.types import Blackout, Job, JobType, TenantPolicy
from curtail.ingest.parse import apply_mapping, node_to_job_power, read_table, resample_series
from curtail.ingest.schemas import DATASETS, suggest_mapping
from curtail.ingest.validate import jobs_report, series_report, tenants_report

DAYS = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


def save_upload(db: Session, site_id: str, kind: str, filename: str, content: bytes) -> Dataset:
    if kind not in DATASETS:
        raise ValueError(f"Unknown dataset kind {kind!r}")
    if db.get(Site, site_id) is None:
        raise ValueError(f"Unknown site {site_id!r}")
    ds_id = str(uuid.uuid4())
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)
    path = settings.upload_dir / site_id / f"{ds_id}-{safe}"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)
    ds = Dataset(id=ds_id, site_id=site_id, kind=kind, filename=safe, stored_path=str(path))
    db.add(ds)
    db.commit()
    return ds


def preview(ds: Dataset) -> dict:
    df = read_table(Path(ds.stored_path), nrows=200)
    mapping, preset = suggest_mapping(ds.kind, list(map(str, df.columns)))
    return {
        "dataset_id": ds.id, "kind": ds.kind, "filename": ds.filename,
        "columns": list(map(str, df.columns)),
        "rows": df.head(15).astype(object).where(df.head(15).notna(), None).to_dict("records"),
        "suggested_mapping": mapping, "preset": preset,
        "fields": [f.__dict__ for f in DATASETS[ds.kind]],
    }


def parse_blackouts(text: str | None) -> tuple[list[dict], list[str]]:
    """'Mon-Fri 09:00-17:00; Sat 00:00-24:00; 2024-07-04T00:00/2024-07-05T00:00'."""
    if text is None or (isinstance(text, float) and np.isnan(text)) or not str(text).strip():
        return [], []
    out, errors = [], []
    for part in str(text).split(";"):
        part = part.strip()
        if not part:
            continue
        if "/" in part:
            try:
                a, b = (pd.Timestamp(x.strip()) for x in part.split("/", 1))
                out.append({"starts_at": a.isoformat(), "ends_at": b.isoformat()})
            except ValueError:
                errors.append(part)
            continue
        m = re.match(r"^(?:([A-Za-z,\-]+)\s+)?(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$", part)
        if not m:
            errors.append(part)
            continue
        days_s, a, b = m.groups()
        days: list[int] = []
        try:
            for tok in (days_s or "").lower().split(","):
                if not tok:
                    continue
                if "-" in tok:
                    x, y = (DAYS[t[:3]] for t in tok.split("-"))
                    days += list(range(x, y + 1)) if x <= y else [*range(x, 7), *range(y + 1)]
                else:
                    days.append(DAYS[tok[:3]])
        except KeyError:
            errors.append(part)
            continue
        out.append({"days": sorted(set(days)), "start": a, "end": b})
    return out, errors


def _to_blackout(d: dict, tz: ZoneInfo) -> Blackout:
    if "starts_at" in d:
        a, b = pd.Timestamp(d["starts_at"]), pd.Timestamp(d["ends_at"])
        a = a.tz_localize(tz) if a.tzinfo is None else a
        b = b.tz_localize(tz) if b.tzinfo is None else b
        return Blackout(starts_at=a.to_pydatetime(), ends_at=b.to_pydatetime())

    def t(s: str) -> time:
        h, m = map(int, s.split(":"))
        return time.max if h >= 24 else time(h, m)

    return Blackout(days=tuple(d.get("days", ())), start=t(d["start"]), end=t(d["end"]))


def _write(db: Session, model, site_id: str, frame: pd.DataFrame) -> int:
    db.execute(delete(model).where(model.site_id == site_id))
    db.commit()
    if frame.empty:
        return 0
    frame = frame.assign(site_id=site_id)
    frame.to_sql(model.__tablename__, db.get_bind(), if_exists="append", index=False,
                 chunksize=5000, method="multi")
    return len(frame)


def apply(db: Session, ds: Dataset, mapping: dict[str, str], options: dict) -> dict:
    site = db.get(Site, ds.site_id)
    options = {"timezone": site.timezone, **options}
    interval = int(options.get("interval_minutes", 5))
    raw = read_table(Path(ds.stored_path))
    raw.columns = list(map(str, raw.columns))
    canon, stats = apply_mapping(raw, ds.kind, mapping, options)
    report: dict = {"parse": stats}

    if ds.kind == "facility_power":
        cols = [c for c in ("total_kw", "it_kw", "cooling_kw") if c in canon]
        res = resample_series(canon, interval, {c: "mean" for c in cols})
        report.update(series_report(canon, res, interval, cols))
        frame = res.dropna(subset=["total_kw"]).rename_axis("ts").reset_index()
        n = _write(db, FacilityPower, site.id, frame)
    elif ds.kind == "grid_signals":
        agg = {"price": "mean"} if "price" in canon else {}
        for f in ("dr_flag", "emergency_flag"):
            if f in canon:
                canon[f] = canon[f].fillna(False).astype(bool)
                agg[f] = "max"
        res = resample_series(canon, interval, agg)
        report.update(series_report(canon, res, interval, list(agg)))
        frame = res.rename_axis("ts").reset_index()
        for f in ("dr_flag", "emergency_flag"):
            frame[f] = frame[f].fillna(False).astype(bool) if f in frame else False
        frame["source"] = options.get("source", "upload")
        n = _write(db, GridSignal, site.id, frame)
    elif ds.kind == "jobs":
        report.update(jobs_report(canon))
        frame = canon.drop_duplicates("job_id", keep="last").copy()
        frame = frame[frame["end"] >= frame["start"]]
        if "timelimit" in frame:
            frame["timelimit_end"] = frame["start"] + pd.to_timedelta(frame.pop("timelimit"), "min")
        keep = ["job_id", "tenant_id", "job_type", "submit", "start", "end", "deadline",
                "timelimit_end", "checkpointable", "gpus", "nodes"]
        frame = frame[[c for c in keep if c in frame]]
        if "checkpointable" in frame:
            frame["checkpointable"] = frame["checkpointable"].astype(object).where(
                frame["checkpointable"].notna(), None)
        frame["source"] = options.get("source", "upload")
        n = _write(db, JobRow, site.id, frame)
    elif ds.kind in ("node_power", "job_power"):
        if ds.kind == "node_power":
            jobs = None
            if "job_id" not in canon or canon["job_id"].isna().all():
                jobs = load_jobs_frame(db, site.id)
            frame, nstats = node_to_job_power(canon, jobs, interval)
            report["attribution"] = nstats
        else:
            canon["ts"] = canon["ts"].dt.floor(f"{interval}min")
            frame = canon.groupby(["ts", "job_id"])["kw"].mean().reset_index()
        report["date_range"] = {"start": frame["ts"].min().isoformat() if len(frame) else None,
                                "end": frame["ts"].max().isoformat() if len(frame) else None}
        report["jobs_with_power"] = int(frame["job_id"].nunique())
        report["outliers"] = {"negative_kw": int((frame["kw"] < 0).sum())}
        frame = frame[frame["kw"] >= 0]
        n = _write(db, JobPower, site.id, frame)
    elif ds.kind == "tenants":
        rows, errors = [], []
        for _, r in canon.iterrows():
            blk, errs = parse_blackouts(r.get("blackout_windows"))
            errors += errs

            def val(k):
                v = r.get(k)
                return None if v is None or pd.isna(v) else v

            rows.append({
                "tenant_id": r["tenant_id"],
                "opted_in": None if val("opted_in") is None else bool(val("opted_in")),
                "max_reduction_pct": val("max_reduction_pct"),
                "max_reduction_kw": val("max_reduction_kw"),
                "min_guaranteed_kw": val("min_guaranteed_kw"),
                "compensation_per_mwh": val("compensation_per_mwh"),
                "blackouts": blk, "valid_from": val("valid_from"), "valid_to": val("valid_to"),
                "dataset_id": ds.id,
            })
        report.update(tenants_report(canon, errors))
        db.execute(delete(TenantPolicyRow).where(TenantPolicyRow.site_id == site.id))
        db.add_all(TenantPolicyRow(site_id=site.id, **row) for row in rows)
        db.commit()
        n = len(rows)
    else:  # pragma: no cover
        raise ValueError(ds.kind)

    report["rows_loaded"] = n
    report["cross_checks"] = cross_checks(db, site.id)
    ds.mapping = {"mapping": mapping, "options": options}
    ds.validation = _jsonable(report)
    ds.rows_loaded = n
    ds.status = "loaded"
    db.commit()
    return ds.validation


def _jsonable(x):
    if isinstance(x, dict):
        return {str(k): _jsonable(v) for k, v in x.items()}
    if isinstance(x, list | tuple):
        return [_jsonable(v) for v in x]
    if isinstance(x, np.integer | np.floating):
        return x.item()
    if isinstance(x, pd.Timestamp | datetime):
        return x.isoformat()
    return x


def load_jobs_frame(db: Session, site_id: str) -> pd.DataFrame:
    df = pd.read_sql(select(JobRow).where(JobRow.site_id == site_id), db.get_bind())
    for c in ("submit", "start", "end", "deadline", "timelimit_end"):
        df[c] = pd.to_datetime(df[c], utc=True)
    return df


def cross_checks(db: Session, site_id: str) -> dict:
    bind = db.get_bind()
    jobs = pd.read_sql(select(JobRow.job_id, JobRow.tenant_id).where(JobRow.site_id == site_id), bind)
    power_ids = pd.read_sql(
        select(JobPower.job_id).where(JobPower.site_id == site_id).distinct(), bind)["job_id"]
    tenants = pd.read_sql(
        select(TenantPolicyRow.tenant_id).where(TenantPolicyRow.site_id == site_id), bind)["tenant_id"]
    jset, pset, tset = set(jobs["job_id"]), set(power_ids), set(tenants)
    job_tenants = set(jobs["tenant_id"].dropna())
    return {
        "jobs_without_power": len(jset - pset),
        "power_job_ids_unmatched": len(pset - jset),
        "unmatched_examples": sorted(pset - jset)[:10],
        "tenants_without_config": sorted(job_tenants - tset)[:50],
        "configured_tenants_without_jobs": sorted(tset - job_tenants)[:50],
    }


def site_status(db: Session, site_id: str) -> dict:
    bind = db.get_bind()
    out = {}
    for name, model in (("facility_power", FacilityPower), ("grid_signals", GridSignal),
                        ("job_power", JobPower)):
        q = pd.read_sql(select(model.ts).where(model.site_id == site_id), bind)
        ts = pd.to_datetime(q["ts"], utc=True)
        out[name] = {"rows": len(ts),
                     "start": ts.min().isoformat() if len(ts) else None,
                     "end": ts.max().isoformat() if len(ts) else None}
    out["jobs"] = {"rows": len(load_jobs_frame(db, site_id))}
    out["tenants"] = {"rows": int(db.query(TenantPolicyRow).filter_by(site_id=site_id).count())}
    out["cross_checks"] = cross_checks(db, site_id)
    out["datasets"] = [
        {"id": d.id, "kind": d.kind, "filename": d.filename, "status": d.status,
         "rows_loaded": d.rows_loaded, "created_at": d.created_at.isoformat()}
        for d in db.scalars(select(Dataset).where(Dataset.site_id == site_id)
                            .order_by(Dataset.created_at.desc()))
    ]
    return out


def load_inputs(db: Session, site_id: str) -> ReplayInputs:
    site = db.get(Site, site_id)
    tz = ZoneInfo(site.timezone)
    bind = db.get_bind()
    fac = pd.read_sql(select(FacilityPower).where(FacilityPower.site_id == site_id), bind)
    if fac.empty:
        raise ValueError("Facility power is required; upload it first")
    fac["ts"] = pd.to_datetime(fac["ts"], utc=True)
    fac = fac.set_index("ts").sort_index()[["total_kw", "it_kw", "cooling_kw"]]
    grid = pd.read_sql(select(GridSignal).where(GridSignal.site_id == site_id), bind)
    flags: list[str] = []
    if grid.empty:
        flags.append("no_grid_signals")
        grid = pd.DataFrame(columns=["price", "dr_flag", "emergency_flag"],
                            index=pd.DatetimeIndex([], tz="UTC"))
    else:
        grid["ts"] = pd.to_datetime(grid["ts"], utc=True)
        grid = grid.set_index("ts").sort_index()[["price", "dr_flag", "emergency_flag"]]
        grid[["dr_flag", "emergency_flag"]] = grid[["dr_flag", "emergency_flag"]].astype(bool)
    jp = pd.read_sql(select(JobPower.job_id, JobPower.ts, JobPower.kw)
                     .where(JobPower.site_id == site_id), bind)
    jp["ts"] = pd.to_datetime(jp["ts"], utc=True)

    jdf = load_jobs_frame(db, site_id)

    def opt(v):
        return None if v is None or pd.isna(v) else v.to_pydatetime()

    jobs = [
        Job(job_id=r.job_id, tenant_id=None if pd.isna(r.tenant_id) else r.tenant_id,
            job_type=JobType(r.job_type) if r.job_type in JobType._value2member_map_
            else JobType.UNKNOWN,
            start=r.start.to_pydatetime(), end=r.end.to_pydatetime(), submit=opt(r.submit),
            deadline=opt(r.deadline), timelimit_end=opt(r.timelimit_end),
            checkpointable=None if r.checkpointable is None or pd.isna(r.checkpointable)
            else bool(r.checkpointable))
        for r in jdf.itertuples()
    ]
    policies: dict[str, TenantPolicy] = {}
    for p in db.scalars(select(TenantPolicyRow).where(TenantPolicyRow.site_id == site_id)):
        # Phase 1 replays use the latest policy per tenant; validity windows are
        # stored for Phase 2.
        policies[p.tenant_id] = TenantPolicy(
            p.tenant_id, p.opted_in, p.max_reduction_pct, p.max_reduction_kw,
            p.min_guaranteed_kw, tuple(_to_blackout(b, tz) for b in (p.blackouts or [])),
            p.compensation_per_mwh)
    return ReplayInputs(fac, jobs, jp, grid, policies, tz, flags)
