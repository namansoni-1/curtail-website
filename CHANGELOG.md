# Changelog

## Unreleased: Phase 1, Curtail Replay

### Changed
- Landing page, "The problem": the bell-curve animation is replaced by a grid
  of every hour of 2022 with ERCOT North Hub's real scarcity hours lit up
  (176 hours above $200/MWh, 40 above $1,000/MWh), plus three supporting
  figures.
- The site navigation links to Replay, and Replay pages have a header that
  leads back to the site.

### Added (public demo)
- `CURTAIL_DEMO_MODE`: a read-only API for the public site that preloads and
  replays the sample site.
- `render.yaml` for hosting that API, and `CURTAIL_CORS_ORIGIN_REGEX` for
  Vercel preview deployments.

### Added
- **Counterfactual engine** (`backend/curtail/engine/`):
  - Event windows come from DR and emergency flags, or from price ≥ a
    threshold. Long events are split into chunks.
  - For each window, a Google OR-Tools CP-SAT model picks at most one action
    per job: a GPU power cap level, pause with checkpoint, or deferred start.
  - Every tenant's opt-in, blackout windows, max % or kW reduction and
    guaranteed minimum must hold in every interval, and no job may miss its
    deadline.
  - The objective is maximum MWh or maximum operator net revenue.
- **Independent verifier** that re-checks every decision against the raw
  contracts and job records. Failing decisions are dropped, never reported.
- **Strict missing-data handling.** Unknown opt-in, limit, minimum, job type
  or deadline protects the job or tenant, and every case is counted as a flag.
- **Forecast mode.** A LightGBM job-power forecaster (trained on other time
  blocks) makes decisions without hindsight, which are then scored against
  actual power.
- **Ingestion** (`backend/curtail/ingest/`):
  - CSV and Parquet uploads, with a column-mapping step that has `sacct`,
    DCGM exporter and Kubernetes presets.
  - Unit and timezone options, Slurm timelimit and nodelist parsing, and
    DCGM node-to-job power attribution.
  - Validation reports: coverage, gaps, duplicates, outliers, unmatched ids,
    tenants without contracts.
  - Everything is resampled to 5-minute intervals.
- **Grid data** (`backend/curtail/grid/`), with disk caching:
  - PJM Data Miner 2 real-time LMPs (API key).
  - ERCOT's public real-time price archive.
  - Import of PJM Emergency Procedures CSV exports, classified into DR and
    emergency windows.
- **FastAPI backend** with a Postgres/TimescaleDB schema designed for Phase 2:
  everything hangs off a site, tenant contracts are versioned by validity
  window, and every run's per-job decisions are kept as a decision log.
  SQLite works for local development.
- **Replay UI** at `/replay`:
  - a sites list with a one-click synthetic sample
  - upload wizard with mapping and validation report
  - grid price fetch
  - results headline and KPIs
  - actual vs. curtailed timeline with event bands
  - per-event drill-down (capped, paused, deferred and protected jobs, with
    reasons and deadline risk)
  - per-tenant table
  - sensitivity controls (safety margin, price threshold, opt-in rate,
    decision mode, objective)
- **CFO-ready PDF report**: headline, metrics, chart, tenants, largest events,
  method, assumptions and data gaps.
- **MIT Supercloud adapter** (`backend/curtail/traces/supercloud.py`) and the
  `python -m curtail.cli supercloud` validation run. The adapter detects and
  corrects a 5-hour clock offset between the GPU traces and the Slurm log.
- **Tests:**
  - optimizer cases with known answers, including "reduce nothing"
  - Hypothesis property tests and a seeded fuzz test (no decision breaks a
    tenant minimum, limit or deadline)
  - ingestion parsers
  - trace clock alignment
  - an end-to-end upload-to-PDF test, run on SQLite and on Postgres 16
- Fixed: a job's delay now accumulates across events and across the chunks
  of a long event. Before this, a job slowed in several consecutive chunks
  could miss its deadline while each chunk passed on its own. On the
  Supercloud validation this cut the safe reduction from 68.4 to 42.1 kWh.
- `docker-compose.yml` with TimescaleDB, the API and the web app.
- `ASSUMPTIONS.md` and `docs/VALIDATION.md`.
