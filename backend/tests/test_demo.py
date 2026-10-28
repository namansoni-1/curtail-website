"""Public demo mode: preloaded sample, writes refused, replays allowed."""

from fastapi.testclient import TestClient

from curtail.api.main import DEMO_SITE, app
from curtail.config import settings


def test_demo_mode(monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", True)
    with TestClient(app) as c:
        assert c.get("/api/health").json() == {"ok": True, "demo": True}
        assert DEMO_SITE in [s["id"] for s in c.get("/api/sites").json()]
        runs = c.get(f"/api/sites/{DEMO_SITE}/runs").json()
        assert len(runs) == 1 and runs[0]["summary"]["events_with_reduction"] > 0

        assert c.post("/api/sites", json={"id": "x", "name": "X"}).status_code == 403
        assert c.post(f"/api/sites/{DEMO_SITE}/load-sample").status_code == 403
        r = c.post(f"/api/sites/{DEMO_SITE}/uploads", data={"kind": "jobs"},
                   files={"file": ("a.csv", b"a\n1\n")})
        assert r.status_code == 403
        assert c.post(f"/api/sites/{DEMO_SITE}/runs", json={"safety_margin": 0.2}).status_code == 200

    # A restart finds the site and does not replay it again.
    with TestClient(app) as c:
        assert len(c.get(f"/api/sites/{DEMO_SITE}/runs").json()) == 2
