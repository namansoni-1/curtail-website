# Modeling assumptions

Every assumption that changes a reported number is a parameter. Engine
parameters live in `backend/curtail/params.py` (`ModelParams`). Each replay
run stores the exact parameters it used, and the PDF report lists them. The
public-trace adapter has its own settings in
`backend/curtail/traces/supercloud.py` (`SupercloudConfig`).

Wherever data is missing, the engine assumes the **strict case**: the job or
tenant is protected (not reduced), and a flag is counted and shown in the
results and the PDF.

## Event windows

| Parameter | Default | Meaning |
|---|---|---|
| `price_threshold_per_mwh` | 200 | A price event is a run of intervals with price ≥ this. |
| `include_grid_events` | true | DR and emergency flags also open events. When a grid event and a price spike overlap, the event takes precedence. |
| `min_event_minutes` | 15 | Shorter runs are ignored. |
| `max_event_minutes` | 240 | Longer runs are split into chunks. Each chunk is optimized on its own, and job deadlines are checked per chunk only (see weaknesses). |
| `interval_minutes` | 5 | Every series is resampled to this interval. Missing intervals are reported and never filled in silently. |

## Safety

| Parameter | Default | Meaning |
|---|---|---|
| `safety_margin` | 0.10 | Tightens every constraint by this fraction: only (1−m) of a job's deadline slack may be used, only (1−m) of a tenant's reduction allowance, and the tenant floor becomes min_guaranteed × (1+m). The reported ("firm") reduction is then derated by a further (1−m). |

The optimizer rounds reductions up and limits down, to whole watts. The
verifier then re-checks every decision against the raw tenant contracts and
job records with no shared code. Any decision that fails is dropped before
reporting.

## Power capping

| Parameter | Default | Meaning |
|---|---|---|
| `cap_curve` | 100%→100%, 90%→97%, 80%→92%, 70%→85%, 60%→76% | GPU power fraction → throughput fraction. The available cap levels are the points of this curve. The default shape follows the commonly reported sub-linear power/performance relationship for data-center GPUs; it is not measured. |
| `gpu_power_share` | 0.75 | Share of a job's power that responds to a GPU cap. CPU, memory, network and storage power stay unchanged. |
| `inference_floor_frac` | 0.80 | An inference job's total power may never be capped below this fraction. Inference is never paused or deferred. |

A capped job works through its own baseline power trace more slowly, so a job
that would have finished inside the window runs longer and adds load later in
the window. That added load counts against the reduction.

Delay for a job still running at the end of the window is window × (1 −
throughput). For a job that would have finished inside the window, it is the
extra time to finish.

**Inference has no batch deadline.** Its contractual protection is the power
floor, so inference caps within the floor do not need deadline slack. The
floor (default 80% of power, which is about 92% of throughput on the default
curve) is meant to stand in for the latency SLA. A tenant whose latency SLA
is tighter should get a higher floor.

## Pause with checkpoint

| Parameter | Default | Meaning |
|---|---|---|
| `checkpoint_minutes` | 10 | The job keeps drawing full power while it checkpoints. The reduction starts after this. |
| `restart_minutes` | 10 | Work lost on resume, added to the delay. |
| `paused_power_frac` | 0.25 | A paused job still draws this fraction of its pre-pause power (idle GPUs and host), even past the time it would have finished. |

Only training and batch jobs that are already running can be paused, and only
if they are not marked non-checkpointable. Pause delay = window + restart.

## Deferred start

Only training and batch jobs that start inside the window can be deferred. They
start at the window's end. Delay = window end − original start.

## Facility and economics

| Parameter | Default | Meaning |
|---|---|---|
| `facility_kw_per_it_kw` | 1.0 | Facility kW saved per IT kW saved. The default 1.0 credits no cooling savings. |
| `assumed_pue` | 1.4 | Used only when IT kW is missing: IT = total / PUE (flagged). |
| `energy_value_basis` | `rt_price` | A MWh avoided is worth the real-time price (the operator buys at real-time prices). The alternative, `fixed`, uses `fixed_energy_price_per_mwh`. |
| `fixed_energy_price_per_mwh` | 80 | Used by the `fixed` basis, and as the fallback when the price is missing. |
| `dr_payment_per_mwh` | 0 | Extra $/MWh for reductions during a flagged DR or emergency event. Default 0: no program revenue is assumed. |
| `default_compensation_per_mwh` | 150 | Used when a tenant's rate is missing (flagged). |

- **Rebound.** All reduced energy is treated as **shifted, not avoided**. It
  is assumed to be bought back right after the event, at the average price of
  an equally long window that follows. This is conservative: capping usually
  improves energy per unit of work.
- **Compensation.** Tenant compensation is charged on the modeled (not
  derated) reduction, so the operator's cost is never understated.
- **Revenue.** Operator net = value of the firm reduction − rebound cost −
  tenant compensation. Capacity-market payments are not included.

## Objective and scenarios

| Parameter | Default | Meaning |
|---|---|---|
| `objective` | `mwh` | Maximize reduced energy. `net_revenue` instead maximizes operator net, including rebound and compensation. |
| `opt_in_rate` | 1.0 | Scenario knob. Keeps the first ceil(rate × n) opted-in tenants, sorted by tenant id, and treats the rest as opted out. |
| `mode` | `hindsight` | `hindsight` decides with actual job power. `forecast` decides with LightGBM-predicted power, then scores against actual power; anything that would have broken a rule is dropped and counted. |
| `forecast_train_samples` | 200,000 | Training samples for the forecaster. The models are trained on time blocks other than the block being predicted. |
| `solver_time_limit_s` | 5 | CP-SAT time limit per event. If it is hit, the best feasible solution is used. |

## Missing-data policies

| Parameter | Default | Meaning |
|---|---|---|
| `missing_deadline_policy` | `strict` | A training or batch job with no deadline has zero slack, so only zero-delay actions are allowed, which in practice means none. `timelimit` uses the requested walltime as the deadline (flagged). |
| `missing_min_guaranteed_policy` | `strict` | A tenant with no minimum is protected. `zero` assumes a zero minimum (flagged). |

Other strict defaults, which are not configurable:

- unknown opt-in → protected
- no reduction limit → protected
- unknown job type → protected
- job with no tenant → protected
- job with no power data → not counted

Phase 1 replays use each tenant's latest contract row. The validity dates are
stored for Phase 2.

## Public trace validation (MIT Supercloud), `SupercloudConfig`

| Setting | Default | Meaning |
|---|---|---|
| `start`, `end` | 2021-02-01 – 2021-03-01 | Full coverage of one month, which includes Winter Storm Uri. The whole trace is 2.4 TB; a thin uniform sample would be meaningless. |
| `download_budget_gb` | 30 | February is about 20 GB, so every GPU job in the window is included. |
| `gpu_power_share` | 0.75 | Measured nvidia-smi power is GPU-only. Job power = GPU power / 0.75. |
| `baseline_it_kw` | 0 | Non-GPU and idle-node load is unknown, so the "facility" is the GPU jobs' own load. |
| `pue` | 1.3 | Facility total = IT × PUE. Reductions are credited at IT level only (see `facility_kw_per_it_kw`). |
| `n_tenants` | 8 | Users are hashed into 8 synthetic tenants. Tenants 3 and 6 are opted out; tenant 1 has a Mon–Fri 09:00–17:00 blackout. |
| tenant limits | drawn | `max_reduction_pct` is drawn from {20, 30, 50}%, compensation from {100, 150, 200} $/MWh, and min_guaranteed = 30% of the tenant's median load (seed 11). |
| job type | rule | Interactive sessions are treated as inference unless the dataset labels them as DNN training. All other GPU jobs are treated as training. |
| deadlines | synthesized | Supercloud has no SLAs, and 44% of walltimes are unlimited (median one year). Deadline = end + min(walltime slack, tenant SLA fraction × runtime, 24 h), with the SLA fraction drawn per tenant from {5%, 10%, 25%}. |
| clock alignment | detected | nvidia-smi timestamps run 5 h behind Slurm (Eastern wall-clock time stored as UTC). The adapter detects the whole-hour offset from the data and corrects it. |
| prices | ERCOT HB_NORTH | PJM needs an API key. ERCOT's 2021 archive is public. Supercloud is in Massachusetts, so this pairing is a stand-in for "a real 2021 price series with real scarcity events", not the site's actual tariff. |
