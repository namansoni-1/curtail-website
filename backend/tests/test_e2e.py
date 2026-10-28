"""Upload synthetic exports through the API, map columns, run, get a report."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from curtail.api.main import app
from curtail.samples import make_sample


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def upload(client, site, kind, path: Path, extra_mapping=None, options=None):
    with path.open("rb") as f:
        r = client.post(f"/api/sites/{site}/uploads", data={"kind": kind},
                        files={"file": (path.name, f)})
    assert r.status_code == 200, r.text
    prev = r.json()
    mapping = {**prev["suggested_mapping"], **(extra_mapping or {})}
    r = client.post(f"/api/datasets/{prev['dataset_id']}/apply",
                    json={"mapping": mapping, "options": options or {}})
    assert r.status_code == 200, r.text
    return prev, r.json()


def test_upload_to_report(client, tmp_path):
    paths = make_sample(tmp_path)
    assert client.post("/api/sites", json={"id": "demo", "name": "Demo DC"}).status_code == 200

    prev, rep = upload(client, "demo", "jobs", paths["jobs"], {"deadline": "Deadline"})
    assert prev["preset"] == "sacct"
    assert rep["job_types"]["training"] > 0 and rep["job_types"]["inference"] > 0
    upload(client, "demo", "job_power", paths["job_power"])
    _, rep = upload(client, "demo", "facility_power", paths["facility_power"])
    assert rep["coverage_pct"] == 100.0
    assert rep["cross_checks"]["jobs_without_power"] == 0
    _, rep = upload(client, "demo", "tenants", paths["tenants"])
    assert rep["tenants"] == 3
    prev, rep = upload(client, "demo", "grid_signals", paths["grid_signals"])
    assert prev["suggested_mapping"]["price"] == "lmp"
    _, rep = upload(client, "demo", "grid_events", paths["grid_events"])
    assert rep["events"] == {"dr": 1, "emergency": 0, "ignored": 1}

    r = client.post("/api/sites/demo/runs", json={"price_threshold_per_mwh": 200})
    assert r.status_code == 200, r.text
    s = r.json()["summary"]
    assert s["events"] >= 6
    assert s["firm_mwh"] > 0
    assert s["sla_violations_reported"] == 0
    assert s["decisions_dropped_by_verifier"] == 0

    run = client.get(f"/api/runs/{r.json()['id']}").json()
    tenants = {t["tenant_id"]: t for t in run["tenants"]}
    assert tenants["initech"]["modeled_mwh"] == 0  # not opted in
    assert tenants["acme-ai"]["modeled_mwh"] > 0
    acted = [d for e in run["events"] for d in e["decisions"] if d["action"] != "none"]
    assert all(d["tenant_id"] != "initech" for d in acted)
    assert all(not (d["tenant_id"] == "globex" and d["action"] != "cap") for d in acted)

    # A stricter margin can only reduce the claim.
    r2 = client.post("/api/sites/demo/runs", json={"price_threshold_per_mwh": 200,
                                                   "safety_margin": 0.4}).json()
    assert r2["summary"]["firm_mwh"] <= s["firm_mwh"] + 1e-9

    # Forecast mode decides without hindsight; anything that would have broken a
    # rule given what actually happened is dropped, never reported.
    r3 = client.post("/api/sites/demo/runs", json={"price_threshold_per_mwh": 200,
                                                   "mode": "forecast",
                                                   "forecast_train_samples": 20000})
    assert r3.status_code == 200, r3.text
    s3 = r3.json()["summary"]
    assert s3["mode"] == "forecast" and s3["sla_violations_reported"] == 0
    assert s3["firm_mwh"] > 0

    pdf = client.get(f"/api/runs/{r.json()['id']}/report.pdf")
    assert pdf.status_code == 200
    assert pdf.content[:4] == b"%PDF"
