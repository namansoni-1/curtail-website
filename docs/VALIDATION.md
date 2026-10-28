# Validation on a public GPU trace

Phase 1's question is: *"Over N months, how much could this facility have
safely reduced, during how many events, affecting which jobs, earning what,
with zero SLA violations?"* This document answers it on real GPU job traces
and real grid prices. The tenant contracts are synthesized, and so is
everything listed in [ASSUMPTIONS.md](../ASSUMPTIONS.md#public-trace-validation-mit-supercloud-supercloudconfig).

Reproduce with:

```bash
cd backend && uv run python -m curtail.cli supercloud --iso ERCOT
```

Results land in `backend/data/validation/supercloud-feb2021-ercot/`
(`summary.json`, `base_result.json`, `report.pdf`).

## Which trace, and why

| Trace | Usable? | Notes |
|---|---|---|
| **MIT Supercloud** (datacenter-challenge 202201) | **Yes** | Public S3, no sign-up. It has a Slurm accounting log *and* per-GPU nvidia-smi power at 100 ms, which is the only public trace with measured GPU power per job. CC BY-NC-ND 4.0, so the data is downloaded, never committed. |
| Alibaba GPU 2020 | Not used | GPU utilization only, no power. Power would have to be modeled from utilization, which adds an assumption layer the Supercloud data avoids. |
| Microsoft Philly | Not used | Scheduler logs and utilization, no power, and from 2017. |

The full Supercloud GPU trace is 2.4 TB, so a uniform sample under a few GB
would cover about 0.2% of jobs. The adapter instead takes **every GPU job in
February 2021** (1,485 jobs, 1,495 trace files, 20 GB streamed and
aggregated to 5-minute job power). February 2021 also contains **Winter Storm
Uri**, the most extreme real price event available.

Prices are **ERCOT HB_NORTH real-time** settlement point prices: 15-minute
data from ERCOT's public archive, forward-filled to 5 minutes. PJM prices
need an API key, which was not available for this run. Re-run with
`--iso PJM` once `CURTAIL_PJM_API_KEY` is set. Supercloud is in
Massachusetts, so ERCOT stands in for "a real 2021 price series with real
scarcity events", not the site's tariff.

### Data issue found and fixed

Every GPU trace started about 5 hours before its Slurm job. The nvidia-smi
timestamps are Eastern wall-clock time stored as if they were UTC. Before
the fix, almost every job-event had no power inside its event window. The
adapter now detects the whole-hour offset from the data (median gap between
a job's first sample and its Slurm start; 5.0 h here) and corrects it. A
test covers the detection.

## Results (base case: hindsight, 10% safety margin, $200/MWh threshold)

**Over 0.92 months (Feb 2021), the 1,485 Supercloud GPU jobs could have
safely shifted 42.1 kWh out of 54 of 59 price events. That is 7.1% of the
GPU jobs' energy during those events. It affected 355 jobs (728 caps, 44
pauses and 34 deferrals across events), with zero SLA or tenant-rule
violations.** The verifier dropped no decisions. Of the 806 actions:

- 94 were inference caps within the power floor, which carry no deadline.
- 140 had "low" deadline risk and 291 "medium" (under 60% of the usable
  slack).
- 281 were "high": still inside the slack, but using most of it. That's
  expected, because the optimizer pushes each job toward its limit.

An earlier version of the engine reported 68.4 kWh here. It checked each
4-hour chunk of a long event against a job's full slack, so jobs slowed in
several consecutive Uri chunks would have **missed their deadlines**. The
replay now carries each job's accumulated delay forward, and a regression
test covers it. The fix cut the claim by 38%.

The absolute numbers are small because the cluster was small and quiet that
month: average GPU-job IT load was 1.8 kW and the peak 7.5 kW. Supercloud was
ramping up, and most GPUs sat near idle (median job draw about 100 W). **The
share of event energy is the number that transfers to other sites**, not the
kWh.

The money is the most important finding: **in the base case, operator net is
−$3.55** (gross $157.09, less rebound $154.39, less tenant compensation $6.25).
Most of it (32 of the 42 kWh, $150 of the $157 gross) came in 38 event
chunks during Uri, when prices stayed near the $9,000 cap for days. Energy
shifted out of one 4-hour chunk was bought back in the next one at the same
price. **Under multi-day scarcity, shifting load in time is worth almost
nothing; only real avoidance or real DR payments are.** Maximizing MWh is
therefore the wrong objective for money. Optimizing for net revenue instead
gives **+$37.37** by acting in only 25 events, the ones followed by cheaper
prices. Scaled linearly to 1 MW of average GPU load, that is about **$20k for
February 2021**. That scaling is illustrative only, given how much of it is
Uri.

### Scenarios

| Scenario | Events | With reduction | Firm kWh | Share of event energy | Jobs | Gross $ | Rebound $ | Tenants $ | Net $ | Dropped by verifier |
|---|---|---|---|---|---|---|---|---|---|---|
| Base (hindsight, 10% margin, $200/MWh) | 59 | 54 | 42.1 | 7.1% | 355 | 157.09 | 154.39 | 6.25 | −3.55 | 0 |
| **Forecast (no hindsight)** | 59 | 47 | 10.3 | 1.7% | 92 | 47.51 | 42.67 | 1.54 | 3.30 | **105** |
| Safety margin 0% | 59 | 54 | 47.5 | 8.0% | 372 | 174.91 | 168.79 | 6.38 | −0.26 | 0 |
| Safety margin 30% | 59 | 54 | 30.3 | 5.1% | 287 | 111.61 | 111.43 | 5.63 | −5.45 | 0 |
| Threshold $100/MWh | 69 | 63 | 44.8 | n/a | 368 | 158.51 | 157.33 | 6.67 | −5.49 | 0 |
| Threshold $1,000/MWh | 48 | 47 | 37.8 | n/a | 314 | 166.82 | 157.97 | 5.61 | 3.24 | 0 |
| Opt-in rate 50% | 59 | 54 | 23.2 | 3.9% | 206 | 79.88 | 80.65 | 3.08 | −3.85 | 0 |
| Objective: net revenue | 59 | 25 | 19.0 | 3.2% | 135 | 81.90 | 41.84 | 2.70 | **37.37** | 0 |

"Share" is relative to GPU-job energy during the base case's events (0.593
MWh), so it is n/a where the threshold changes which events exist.

### What limits the reduction

Across the base case's 2,254 job-event decisions:

| Count | Reason |
|---|---|
| 806 | **selected** |
| 1,118 | not enough deadline slack, by far the most binding constraint |
| 163 | allowed, but tenant limits or value left them unselected |
| 126 | tenant not opted in |
| 40 | tenant blackout |
| 1 | no power data |

### Hindsight vs. forecast

Deciding without hindsight cuts the safe reduction from 42.1 to 10.3 kWh,
roughly 4 times less. Of the decisions the forecast-mode optimizer made,
105 would have broken a tenant rule or a deadline once actual power was
known, and the verifier removed them. Those 105 are a measure of how much
a live system would need re-optimization inside an event and margins sized
to forecast error. The hindsight figure should be read as an upper bound,
and the forecast figure as closer to what a first live deployment would
achieve.

## Known weaknesses

1. **The validation site is small and partly synthetic.**
   - Real: job timing and GPU power.
   - Synthetic, and they drive the result: tenants, contracts, deadlines,
     job types (interactive = inference, everything else = training) and
     facility load (GPU-job load only, × PUE).
   - The deadline-slack synthesis especially: 1,118 job-events were blocked
     by slack, so the result moves almost one-for-one with the SLA fractions
     drawn ({5%, 10%, 25%} of runtime).
2. **February 2021 is one unusual month.** Uri dominates the dollars. A
   busier summer window would be more representative. The adapter supports
   any window, but full coverage of a busy month is about 400 GB.
3. **ERCOT prices for a Massachusetts site.** It's a stand-in until a PJM key
   is configured. No real DR or emergency events were paired. PJM event
   history has to be uploaded from the Emergency Procedures export, and
   ERCOT EEA notices are not fetched.
4. **Power-cap curve, GPU share and pause overheads are assumptions, not
   measurements.** None were calibrated on this hardware. The cap curve sets
   cap depth and delay directly.
5. **Rebound is crude.** Shifted energy is bought back over the window right
   after the event, at that window's average price. In reality, deferred
   work can be scheduled into the cheapest following hours, which would
   value shifting more highly. On the other hand, capping saves some energy
   outright, and the model credits none.
6. **Earlier delays don't move later power.** A job's accumulated delay
   reduces its remaining slack for later events (a bug found and fixed while
   writing this report). Its recorded power trace is not re-timed, though, so
   later events see the job's power as it actually happened, not as it would
   have after earlier delays.
7. **Each job takes one fixed action per event chunk.** There is no
   re-optimization within an event and no staged caps.
8. **No facility-level physics.** There is no cooling credit (by design),
   no ramp-rate limits, and no check of how fast reductions can be
   delivered.
9. **Forecast mode** trains on block-held-out data from the same month. Jobs
   that haven't started are assigned their job type's median startup power.
10. **TimescaleDB is untested here.** The API and end-to-end test run on
    SQLite and plain Postgres 16. The hypertable step and docker-compose
    itself have not been run, because Docker is not installed on the
    development machine.
