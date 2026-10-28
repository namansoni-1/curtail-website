"""Merge fetched prices and event postings into a site's grid signals."""

from __future__ import annotations

from datetime import datetime

import pandas as pd
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from curtail.db import GridSignal, Site
from curtail.grid.sources import classify_event, ercot_rt_spp, pjm_rt_lmp

COLS = ["price", "dr_flag", "emergency_flag"]


def read_grid(db: Session, site_id: str) -> pd.DataFrame:
    df = pd.read_sql(select(GridSignal).where(GridSignal.site_id == site_id), db.get_bind())
    if df.empty:
        return pd.DataFrame(columns=[*COLS, "source"], index=pd.DatetimeIndex([], tz="UTC", name="ts"))
    df["ts"] = pd.to_datetime(df["ts"], utc=True)
    return df.set_index("ts")[[*COLS, "source"]]


def write_grid(db: Session, site_id: str, df: pd.DataFrame) -> int:
    db.execute(delete(GridSignal).where(GridSignal.site_id == site_id))
    db.commit()
    out = df.copy()
    out["dr_flag"] = out["dr_flag"].fillna(False).astype(bool)
    out["emergency_flag"] = out["emergency_flag"].fillna(False).astype(bool)
    out["source"] = out["source"].fillna("upload")
    out = out.rename_axis("ts").reset_index().assign(site_id=site_id)
    out.to_sql("grid_signals", db.get_bind(), if_exists="append", index=False, chunksize=5000,
               method="multi")
    return len(out)


def merge_prices(db: Session, site_id: str, prices: pd.DataFrame, source: str,
                 interval_min: int = 5) -> dict:
    """Forward-fill coarser prices (hourly or 15-minute) onto 5-minute bins."""
    p = prices.set_index("ts")["price"].sort_index()
    step = (p.index.to_series().diff().median() if len(p) > 1 else pd.Timedelta(hours=1))
    idx = pd.date_range(p.index.min(), p.index.max() + step - pd.Timedelta(minutes=interval_min),
                        freq=f"{interval_min}min")
    fine = p.reindex(idx, method="ffill", limit=int(step / pd.Timedelta(minutes=interval_min)) - 1
                     if step > pd.Timedelta(minutes=interval_min) else None)
    grid = read_grid(db, site_id)
    grid = grid.reindex(grid.index.union(fine.index))
    grid.loc[fine.index, "price"] = fine.to_numpy()
    grid.loc[fine.index, "source"] = source
    n = write_grid(db, site_id, grid)
    return {"source": source, "price_intervals": int(fine.notna().sum()),
            "native_interval_minutes": int(step / pd.Timedelta(minutes=1)), "rows": n,
            "start": fine.index.min().isoformat(), "end": fine.index.max().isoformat()}


def merge_events(db: Session, site_id: str, events: pd.DataFrame, interval_min: int = 5) -> dict:
    """`events` has start, end (UTC) and a text column `label` to classify."""
    grid = read_grid(db, site_id)
    counts = {"dr": 0, "emergency": 0, "ignored": 0}
    for _, e in events.iterrows():
        kind = e.get("kind_resolved") or classify_event(str(e.get("label", "")))
        if kind is None or pd.isna(e["start"]) or pd.isna(e["end"]):
            counts["ignored"] += 1
            continue
        counts[kind] += 1
        bins = pd.date_range(e["start"].floor(f"{interval_min}min"), e["end"],
                             freq=f"{interval_min}min", inclusive="left")
        grid = grid.reindex(grid.index.union(bins))
        grid.loc[bins, f"{kind}_flag"] = True
    write_grid(db, site_id, grid)
    return counts


def fetch_into_site(db: Session, site_id: str, iso: str, node: str | None, start: datetime,
                    end: datetime, include_events: bool = True) -> dict:
    site = db.get(Site, site_id)
    if site is None:
        raise ValueError(f"Unknown site {site_id!r}")
    iso = iso.upper()
    if iso == "PJM":
        node = node or site.price_node or "51288"  # 51288 = PJM Western Hub
        prices = pjm_rt_lmp(node, start, end)
        rep = merge_prices(db, site_id, prices, f"pjm:{node}")
    elif iso == "ERCOT":
        node = node or site.price_node or "HB_NORTH"
        prices = ercot_rt_spp(node, start, end)
        rep = merge_prices(db, site_id, prices, f"ercot:{node}")
    else:
        raise ValueError("Supported ISOs: PJM, ERCOT")
    rep["events_note"] = (
        "PJM emergency/DR history has no public API: upload the CSV export from "
        "emergencyprocedures.pjm.com as a 'grid_events' dataset." if iso == "PJM" else
        "ERCOT EEA events are not fetched; upload them as a 'grid_events' dataset.")
    return rep
