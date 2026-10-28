# Curtail

Curtail is a permission-and-coordination layer between data center operators
and their tenants for power flexibility. When power is constrained or
expensive, it works out how much load can be **safely** reduced, picks which
jobs to slow, pause or move within each tenant's rules, and tracks what is owed
to tenants and earned by the operator.

This repository holds the marketing site (`/`) and **Curtail Replay**
(`/replay`), Phase 1 of the product. You upload a facility's history and get
an answer like: *"over N months you could have safely reduced X MWh during Y
events, affecting these jobs, earning $Z, with zero SLA violations."*

## Layout

| Path | What |
|---|---|
| `app/`, `components/landing/`, `components/motion/` | Marketing site (Next.js 16, React 19, Tailwind 4) |
| `app/replay/`, `components/replay/`, `lib/replay/` | Replay UI |
| `backend/curtail/ingest/` | CSV/Parquet upload, column mapping (sacct, DCGM, Kubernetes presets), validation, resampling |
| `backend/curtail/grid/` | PJM and ERCOT price fetchers with disk cache; grid event import |
| `backend/curtail/engine/` | Event detection, action power model, CP-SAT optimizer, verifier, replay, LightGBM forecaster |
| `backend/curtail/report/` | PDF report |
| `backend/curtail/traces/` | MIT Supercloud public-trace adapter |
| `backend/tests/` | Optimizer, property, ingestion, trace and end-to-end tests |
| `ASSUMPTIONS.md` | Every number-affecting assumption and its parameter |
| `docs/VALIDATION.md` | Results on the public trace, and known weaknesses |

## Run it with Docker

```bash
docker compose up --build
```

Then open http://localhost:3000/replay and choose **Load sample site**, or
create a site and upload your own data. The stack is TimescaleDB, the FastAPI
API on :8000 and the web app on :3000.

## Run it without Docker

You need Node 22 or later and [uv](https://docs.astral.sh/uv/). On macOS you
also need `brew install libomp` for LightGBM. The backend falls back to SQLite
when `CURTAIL_DATABASE_URL` is not set.

```bash
cd backend && uv sync && uv run uvicorn curtail.api.main:app --port 8000
```

```bash
npm install && npm run dev
```

## Configuration

All settings are environment variables, read by `backend/curtail/config.py`:

| Variable | Default | Purpose |
|---|---|---|
| `CURTAIL_DATABASE_URL` | `sqlite:///./data/curtail.db` | Postgres/TimescaleDB in compose: `postgresql+psycopg://curtail:curtail@db:5432/curtail`. Plain Postgres also works, without hypertables. |
| `CURTAIL_DATA_DIR` | `./data` | Uploads, fetched-price cache, downloaded traces |
| `CURTAIL_CORS_ORIGINS` | `http://localhost:3000` | Web origin(s), comma-separated |
| `CURTAIL_PJM_API_KEY` | none | PJM Data Miner 2 subscription key, needed for PJM prices. Register for free at https://apiportal.pjm.com/ |
| `NEXT_PUBLIC_CURTAIL_API` | `http://localhost:8000` | API address as seen from the browser (web build) |

### Grid data

- **PJM real-time LMPs** come from Data Miner 2 (`rt_hrl_lmps`, or
  `rt_fivemin_hrl_lmps` for recent months) and need `CURTAIL_PJM_API_KEY`.
  The default node is Western Hub (`51288`).
- **PJM emergency and DR events** have no public API. Export postings from
  https://emergencyprocedures.pjm.com and upload the CSV as a **Grid events**
  dataset. Load-management and pre-emergency actions are classified as DR;
  maximum generation, voltage reduction, load shed and PAI postings as
  emergencies. Alerts are ignored.
- **ERCOT real-time settlement point prices** come from ERCOT's public yearly
  archive (report 13061). No key is needed.

Fetched data is cached under `CURTAIL_DATA_DIR/cache`.

## Data you can upload

Each dataset goes through a mapping step: the UI suggests a column for every
field (exact presets for `sacct`, DCGM exporter and Kubernetes exports) and
you can change any of them. Units (W/kW/MW) and a timezone for naive
timestamps are options of the same step.

| Dataset | Required fields | Optional fields |
|---|---|---|
| Facility power | ts, total_kw | it_kw, cooling_kw |
| Job records | job_id, start, end | tenant_id, job_type, submit, deadline, timelimit, checkpointable, gpus, nodes |
| Node/GPU power (DCGM) | ts, host, power_w | gpu, job_id label (otherwise attributed through job node lists) |
| Per-job power | ts, job_id, kw | |
| Tenant contracts | tenant_id | opted_in, max_reduction_pct, max_reduction_kw, min_guaranteed_kw, blackout_windows (`Mon-Fri 09:00-17:00; 2024-07-04T00:00/2024-07-05T00:00`), compensation_per_mwh, valid_from, valid_to |
| Grid signals | ts | price, dr_flag, emergency_flag |
| Grid events | start, end | kind, description |

Each upload returns a validation report: date range, missing intervals and
the largest gaps, duplicates, outliers, unmatched job ids, jobs without power,
and tenants without contracts. Uploading a dataset kind again replaces it.

## Tests

```bash
cd backend && uv run pytest
```

The suite covers:

- optimizer cases with hand-solved answers, including several "reduce nothing" cases
- Hypothesis property tests and a seeded fuzz test checking that no decision
  breaks a tenant minimum, a tenant limit or a job deadline
- an end-to-end test from upload through mapping, validation, replay (both
  modes) and PDF

## Public-trace validation

```bash
cd backend && uv run python -m curtail.cli supercloud --iso ERCOT
```

This downloads about 20 GB of MIT Supercloud GPU traces for February 2021
(CC BY-NC-ND 4.0; nothing from the dataset is committed here) and builds a
synthetic-tenant site. It loads the site through the normal ingestion path,
pairs it with real ERCOT prices and runs the scenario set. Results and
known weaknesses are in [docs/VALIDATION.md](docs/VALIDATION.md).
