"""Grid price and event fetchers, cached on disk.

PJM: real-time LMPs from Data Miner 2 (needs a free API key in
CURTAIL_PJM_API_KEY). PJM emergency/DR history has no API; load the CSV export
from emergencyprocedures.pjm.com as a `grid_events` dataset instead.

ERCOT: the yearly "Historical RTM Load Zone and Hub Prices" archive (report
13061) is public and needs no key.
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import datetime
from pathlib import Path

import httpx
import pandas as pd

from curtail.config import settings

PJM_BASE = "https://api.pjm.com/api/v1"
ERCOT_LIST = "https://www.ercot.com/misapp/servlets/IceDocListJsonWS?reportTypeId=13061"
ERCOT_DOC = "https://www.ercot.com/misdownload/servlets/mirDownload?doclookupId={}"


def _cache_path(source: str, key: dict) -> Path:
    digest = hashlib.sha1(json.dumps(key, sort_keys=True, default=str).encode()).hexdigest()[:16]
    p = settings.cache_dir / source / f"{digest}.parquet"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _cached(source: str, key: dict, fetch) -> pd.DataFrame:
    path = _cache_path(source, key)
    if path.exists():
        return pd.read_parquet(path)
    df = fetch()
    df.to_parquet(path)
    return df


# --- PJM ---------------------------------------------------------------------

def pjm_rt_lmp(pnode_id: str, start: datetime, end: datetime, five_minute: bool = False,
               api_key: str | None = None) -> pd.DataFrame:
    """Return ts (UTC interval start) and price ($/MWh) for one pricing node.

    Hourly LMPs go back years; PJM keeps five-minute LMPs only for recent
    months."""
    api_key = api_key or settings.pjm_api_key
    feed = "rt_fivemin_hrl_lmps" if five_minute else "rt_hrl_lmps"
    key = {"feed": feed, "node": pnode_id, "start": start, "end": end}

    def fetch() -> pd.DataFrame:
        if not api_key:
            raise RuntimeError(
                "No cached PJM prices for this range and CURTAIL_PJM_API_KEY is not set. "
                "Register for a free key at https://apiportal.pjm.com/ (see README).")
        rows: list[dict] = []
        # Data Miner limits each query's date span; walk it month by month.
        for a, b in _months(start, end):
            page = 1
            while True:
                params = {
                    "startRow": (page - 1) * 50000 + 1, "rowCount": 50000,
                    "datetime_beginning_utc": f"{a:%m/%d/%Y %H:%M}to{b:%m/%d/%Y %H:%M}",
                    "pnode_id": pnode_id, "format": "json", "download": "true",
                    "fields": "datetime_beginning_utc,pnode_id,total_lmp_rt",
                }
                r = httpx.get(f"{PJM_BASE}/{feed}", params=params, timeout=120,
                              headers={"Ocp-Apim-Subscription-Key": api_key})
                r.raise_for_status()
                batch = r.json()
                batch = batch.get("items", batch) if isinstance(batch, dict) else batch
                rows += batch
                if len(batch) < 50000:
                    break
                page += 1
        df = pd.DataFrame(rows)
        if df.empty:
            return pd.DataFrame({"ts": pd.Series(dtype="datetime64[ns, UTC]"), "price": []})
        return pd.DataFrame({"ts": pd.to_datetime(df["datetime_beginning_utc"], utc=True),
                             "price": df["total_lmp_rt"].astype(float)})

    return _cached("pjm", key, fetch)


def _months(start: datetime, end: datetime):
    cur = pd.Timestamp(start)
    end = pd.Timestamp(end)
    while cur < end:
        nxt = min(cur + pd.offsets.MonthBegin(1), end)
        yield cur, nxt - pd.Timedelta(minutes=1)
        cur = nxt


# --- ERCOT -------------------------------------------------------------------

def ercot_rt_spp(settlement_point: str, start: datetime, end: datetime) -> pd.DataFrame:
    """15-minute real-time settlement point prices (hub or load zone)."""
    frames = []
    for year in range(pd.Timestamp(start).year, pd.Timestamp(end).year + 1):
        frames.append(_cached("ercot", {"year": year, "point": settlement_point, "v": 1},
                              lambda y=year: _ercot_year(y, settlement_point)))
    df = pd.concat(frames, ignore_index=True)
    s, e = pd.Timestamp(start), pd.Timestamp(end)
    s = s.tz_localize("UTC") if s.tzinfo is None else s
    e = e.tz_localize("UTC") if e.tzinfo is None else e
    return df[(df["ts"] >= s) & (df["ts"] < e)].reset_index(drop=True)


def _ercot_year(year: int, point: str) -> pd.DataFrame:
    raw = settings.cache_dir / "ercot" / f"RTMLZHBSPP_{year}.zip"
    if not raw.exists():
        docs = httpx.get(ERCOT_LIST, timeout=60).json()["ListDocsByRptTypeRes"]["DocumentList"]
        match = [d["Document"]["DocID"] for d in docs
                 if d["Document"]["FriendlyName"].endswith(str(year))]
        if not match:
            raise RuntimeError(f"ERCOT has no historical RTM price archive for {year}")
        r = httpx.get(ERCOT_DOC.format(match[0]), timeout=300, follow_redirects=True)
        r.raise_for_status()
        raw.parent.mkdir(parents=True, exist_ok=True)
        raw.write_bytes(r.content)
    z = zipfile.ZipFile(raw)
    sheets = pd.read_excel(io.BytesIO(z.read(z.namelist()[0])), sheet_name=None)
    df = pd.concat(sheets.values(), ignore_index=True)
    df = df[df["Settlement Point Name"] == point]
    if df.empty:
        raise RuntimeError(f"Settlement point {point!r} not in ERCOT archive")
    local = (pd.to_datetime(df["Delivery Date"], format="%m/%d/%Y")
             + pd.to_timedelta(df["Delivery Hour"].astype(int) - 1, unit="h")
             + pd.to_timedelta((df["Delivery Interval"].astype(int) - 1) * 15, unit="min"))
    # The repeated hour at the fall DST change is flagged "Y" for its second (CST) pass.
    first_pass = (df["Repeated Hour Flag"].astype(str).str.upper() != "Y").to_numpy()
    ts = local.dt.tz_localize("America/Chicago", ambiguous=first_pass,
                              nonexistent="shift_forward").dt.tz_convert("UTC")
    return pd.DataFrame({"ts": ts.to_numpy(), "price": df["Settlement Point Price"].astype(float)
                         .to_numpy()}).drop_duplicates("ts").sort_values("ts")


# --- event exports -------------------------------------------------------------

EMERGENCY_WORDS = ("maximum generation", "max gen", "voltage reduction", "load shed",
                   "manual load dump", "performance assessment", "energy emergency", "eea")
DR_WORDS = ("load management", "demand response", "pre-emergency", "curtailment",
            "emergency demand", "lmr")


def classify_event(text: str) -> str | None:
    """Map an event posting's type/message to 'emergency', 'dr' or None
    (alerts and warnings are not events)."""
    t = (text or "").lower()
    if any(w in t for w in ("alert", "warning", "watch")) and "action" not in t:
        return None
    if any(w in t for w in DR_WORDS):
        return "dr"
    if any(w in t for w in EMERGENCY_WORDS) or "emergency" in t:
        return "emergency"
    return None
