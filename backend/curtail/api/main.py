from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from curtail.config import settings
from curtail.db import Dataset, Run, RunDecision, SessionLocal, Site, init_db
from curtail.engine.replay import run_replay
from curtail.ingest import service
from curtail.params import ModelParams


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    init_db()
    yield


app = FastAPI(title="Curtail Replay API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins.split(","),
                   allow_methods=["*"], allow_headers=["*"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class SiteIn(BaseModel):
    id: str
    name: str
    timezone: str = "America/New_York"
    iso: str = "PJM"
    price_node: str | None = None


class MappingIn(BaseModel):
    mapping: dict[str, str]
    options: dict = {}


class GridFetchIn(BaseModel):
    iso: str = "PJM"
    node: str | None = None
    start: datetime
    end: datetime
    include_events: bool = True


def _bad(e: Exception):
    raise HTTPException(status_code=400, detail=str(e)) from e


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/params/defaults")
def default_params():
    return ModelParams().model_dump()


@app.get("/api/sites")
def list_sites(db: Session = Depends(get_db)):
    return [{"id": s.id, "name": s.name, "timezone": s.timezone, "iso": s.iso,
             "price_node": s.price_node} for s in db.scalars(select(Site))]


@app.post("/api/sites")
def create_site(body: SiteIn, db: Session = Depends(get_db)):
    site = db.get(Site, body.id) or Site(id=body.id)
    for k, v in body.model_dump().items():
        setattr(site, k, v)
    db.add(site)
    db.commit()
    return {"id": site.id}


@app.get("/api/sites/{site_id}/status")
def site_status(site_id: str, db: Session = Depends(get_db)):
    if db.get(Site, site_id) is None:
        raise HTTPException(404, "site not found")
    return service.site_status(db, site_id)


@app.post("/api/sites/{site_id}/uploads")
async def upload(site_id: str, kind: str = Form(...), file: UploadFile = File(...),
                 db: Session = Depends(get_db)):
    try:
        ds = service.save_upload(db, site_id, kind, file.filename or "upload.csv",
                                 await file.read())
        return service.preview(ds)
    except ValueError as e:
        _bad(e)


@app.post("/api/datasets/{dataset_id}/apply")
def apply_mapping(dataset_id: str, body: MappingIn, db: Session = Depends(get_db)):
    ds = db.get(Dataset, dataset_id)
    if ds is None:
        raise HTTPException(404, "dataset not found")
    try:
        return service.apply(db, ds, body.mapping, body.options)
    except (ValueError, KeyError) as e:
        ds.status = "failed"
        db.commit()
        _bad(e)


@app.post("/api/sites/{site_id}/grid/fetch")
def fetch_grid(site_id: str, body: GridFetchIn, db: Session = Depends(get_db)):
    from curtail.grid.service import fetch_into_site

    try:
        return fetch_into_site(db, site_id, body.iso, body.node, body.start, body.end,
                               body.include_events)
    except (ValueError, RuntimeError) as e:
        _bad(e)


def execute_run(db: Session, site_id: str, params: ModelParams) -> Run:
    run = Run(id=str(uuid.uuid4()), site_id=site_id, params=params.model_dump())
    db.add(run)
    db.commit()
    try:
        inputs = service.load_inputs(db, site_id)
        forecaster = None
        if params.mode == "forecast":
            from curtail.engine.forecast import JobPowerForecaster

            forecaster = JobPowerForecaster.fit(inputs, params)
        result = run_replay(inputs, params, forecaster)
        run.result = result
        run.summary = result["summary"]
        run.status = "done"
        db.add_all(
            RunDecision(run_id=run.id, event_id=e["event_id"], job_id=d["job_id"],
                        tenant_id=d["tenant_id"], action=d["action"],
                        cap_power_frac=d["cap_power_frac"],
                        avg_reduction_kw=d["avg_reduction_kw"],
                        delay_minutes=d["delay_minutes"], reason=d["reason"], flags=d["flags"])
            for e in result["events"] for d in e["decisions"])
    except Exception as e:  # noqa: BLE001 - surfaced to the caller and stored
        run.status, run.error = "failed", str(e)[:2000]
    run.finished_at = datetime.now(UTC)
    db.commit()
    return run


@app.post("/api/sites/{site_id}/runs")
def create_run(site_id: str, params: ModelParams, db: Session = Depends(get_db)):
    if db.get(Site, site_id) is None:
        raise HTTPException(404, "site not found")
    run = execute_run(db, site_id, params)
    if run.status == "failed":
        raise HTTPException(400, run.error)
    return {"id": run.id, "status": run.status, "summary": run.summary}


@app.get("/api/sites/{site_id}/runs")
def list_runs(site_id: str, db: Session = Depends(get_db)):
    runs = db.scalars(select(Run).where(Run.site_id == site_id).order_by(Run.created_at.desc()))
    return [{"id": r.id, "status": r.status, "created_at": r.created_at.isoformat(),
             "summary": r.summary, "error": r.error} for r in runs]


@app.get("/api/runs/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "run not found")
    return {"id": run.id, "site_id": run.site_id, "status": run.status, "error": run.error,
            **(run.result or {})}


@app.get("/api/runs/{run_id}/report.pdf")
def run_pdf(run_id: str, db: Session = Depends(get_db)):
    from curtail.report.pdf import build_pdf

    run = db.get(Run, run_id)
    if run is None or run.result is None:
        raise HTTPException(404, "run not found")
    site = db.get(Site, run.site_id)
    pdf = build_pdf(run.result, site.name, run.id)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="curtail-replay-{run.id[:8]}.pdf"'})
