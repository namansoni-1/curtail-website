"""Command line entry points.

    uv run python -m curtail.cli supercloud [--iso ERCOT --node HB_NORTH]

builds the MIT Supercloud validation site, loads it through the normal
upload -> mapping -> validation path, fetches grid prices, runs the replay
scenarios and writes results to CURTAIL_DATA_DIR/validation/.
"""

from __future__ import annotations

import argparse
import json

from curtail.config import settings
from curtail.db import SessionLocal, Site, init_db
from curtail.ingest import service
from curtail.params import ModelParams

SCENARIOS = {
    "base": {},
    "forecast": {"mode": "forecast"},
    "margin_0": {"safety_margin": 0.0},
    "margin_30": {"safety_margin": 0.3},
    "threshold_100": {"price_threshold_per_mwh": 100},
    "threshold_1000": {"price_threshold_per_mwh": 1000},
    "opt_in_50": {"opt_in_rate": 0.5},
    "net_revenue": {"objective": "net_revenue"},
}


def supercloud(iso: str, node: str | None, rebuild: bool) -> None:
    from curtail.api.main import execute_run
    from curtail.grid.service import fetch_into_site
    from curtail.report.pdf import build_pdf
    from curtail.traces.supercloud import SupercloudConfig, build, synthesize_site

    cfg = SupercloudConfig()
    site_dir = cfg.root / "site"
    if rebuild or not (site_dir / "jobs.csv").exists():
        build(cfg)
    elif rebuild is False and (cfg.root / "power").exists():
        # Re-synthesize from cached traces (cheap) so config changes apply.
        from curtail.traces.supercloud import download_power, list_gpu_files, load_gpu_jobs, sample_jobs

        jobs = load_gpu_jobs(cfg)
        files = sample_jobs(jobs, list_gpu_files(cfg), cfg)
        synthesize_site(jobs, download_power(files, cfg), cfg, site_dir)

    init_db()
    db = SessionLocal()
    site_id = f"supercloud-feb2021-{iso.lower()}"
    site = db.get(Site, site_id) or Site(id=site_id)
    site.name = f"MIT Supercloud GPU jobs, Feb 2021 ({iso} prices)"
    site.timezone, site.iso, site.price_node = "America/New_York", iso, node
    db.add(site)
    db.commit()

    reports = {}
    for kind, fname, extra in (
        ("jobs", "jobs.csv", {"deadline": "Deadline"}),
        ("job_power", "job_power.parquet", {}),
        ("facility_power", "facility.csv", {}),
        ("tenants", "tenants.csv", {}),
    ):
        p = site_dir / fname
        ds = service.save_upload(db, site_id, kind, p.name, p.read_bytes())
        mapping = {**service.preview(ds)["suggested_mapping"], **extra}
        reports[kind] = service.apply(db, ds, mapping, {"timezone": "UTC"})
        print(f"loaded {kind}: {reports[kind]['rows_loaded']} rows")
    grid = fetch_into_site(db, site_id, iso, node, cfg.start, cfg.end)
    print(f"grid: {grid['price_intervals']} intervals from {grid['source']}")

    out = settings.data_dir / "validation" / site_id
    out.mkdir(parents=True, exist_ok=True)
    summary = {"validation_reports": reports, "grid": grid, "scenarios": {}}
    for name, over in SCENARIOS.items():
        run = execute_run(db, site_id, ModelParams(**over))
        if run.status != "done":
            raise SystemExit(f"{name} failed: {run.error}")
        summary["scenarios"][name] = {"run_id": run.id, "params": over, **run.summary}
        print(name, json.dumps({k: run.summary[k] for k in (
            "events", "events_with_reduction", "firm_mwh", "operator_net", "jobs_affected",
            "decisions_dropped_by_verifier")}, default=str))
        if name == "base":
            (out / "report.pdf").write_bytes(build_pdf(run.result, site.name, run.id))
            (out / "base_result.json").write_text(json.dumps(run.result, default=str))
    (out / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    print(f"wrote {out}")


def main() -> None:
    ap = argparse.ArgumentParser(prog="curtail")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sc = sub.add_parser("supercloud", help="Build and replay the MIT Supercloud validation site")
    sc.add_argument("--iso", default="ERCOT", choices=["PJM", "ERCOT"])
    sc.add_argument("--node", default=None)
    sc.add_argument("--rebuild", action="store_true", help="Re-download and rebuild the trace")
    args = ap.parse_args()
    if args.cmd == "supercloud":
        supercloud(args.iso, args.node, args.rebuild)


if __name__ == "__main__":
    main()
