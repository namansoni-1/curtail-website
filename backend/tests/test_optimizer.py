"""Optimizer cases small enough to solve by hand.

Defaults: safety margin 0.10, GPU share 0.75, checkpoint 10 min, restart
10 min, paused power 0.25, 5-minute intervals, 6-interval (30 min) window.
A cap to power fraction f keeps 1 - 0.75 * (1 - f) of a job's power.
"""

from datetime import time, timedelta

import numpy as np
import pytest

from curtail.engine.event import solve_event
from curtail.engine.types import ActionKind, Blackout, JobType
from curtail.engine.verifier import verify_event
from curtail.params import ModelParams
from tests.helpers import T0, TZ, job, policy, spec

P = ModelParams()


def run(jobs, power, policies, params=P, s=None):
    s = s or spec()
    r = solve_event(s, jobs, power, {p.tenant_id: p for p in policies}, params, TZ)
    v = verify_event(r.decisions, {j.job_id: j for j in jobs}, power,
                     {p.tenant_id: p for p in policies}, params, s.ws, s.we, TZ, s.n)
    assert v == [], v
    return r, {d.job_id: d for d in r.decisions}


def flat(kw, n=6):
    return np.full(n, float(kw))


# --- reduce nothing ---------------------------------------------------------

def test_nothing_when_not_opted_in():
    r, d = run([job()], {"j1": flat(100)}, [policy(opted_in=False)])
    assert d["j1"].action == ActionKind.NONE
    assert d["j1"].reason == "tenant_not_opted_in"
    assert r.it_reduction_kw.sum() == 0


def test_nothing_when_deadline_missing_strict():
    _r, d = run([job(slack_min=None)], {"j1": flat(100)}, [policy()])
    assert d["j1"].action == ActionKind.NONE
    assert d["j1"].reason == "deadline_slack_insufficient"
    assert "deadline_missing_assumed_zero_slack" in d["j1"].flags


def test_nothing_when_compensation_exceeds_value():
    params = ModelParams(objective="net_revenue")
    r, d = run([job()], {"j1": flat(100)}, [policy(compensation_per_mwh=1000)], params,
               spec(price=60))
    assert r.it_reduction_kw.sum() == 0
    assert d["j1"].reason == "not_selected"


def test_nothing_when_unknown_policy_fields_strict():
    r, d = run([job()], {"j1": flat(100)}, [policy(min_guaranteed_kw=None)])
    assert d["j1"].reason == "tenant_min_missing"
    _r, d = run([job()], {"j1": flat(100)}, [policy(opted_in=None)])
    assert d["j1"].reason == "opt_in_unknown"


def test_nothing_for_unknown_job_type():
    _r, d = run([job(jtype=JobType.UNKNOWN)], {"j1": flat(100)}, [policy()])
    assert d["j1"].reason == "job_type_unknown"


def test_nothing_during_blackout():
    # 18:00 UTC on 2024-07-16 is 14:00 New York time, a Tuesday.
    b = Blackout(days=(1,), start=time(13, 0), end=time(15, 0))
    _r, d = run([job()], {"j1": flat(100)}, [policy(blackouts=(b,))])
    assert d["j1"].reason == "tenant_blackout"


# --- known answers -----------------------------------------------------------

def test_pause_wins_when_allowed():
    # Pause: 2 checkpoint intervals at full power, then 4 at 75 kW reduction = 300.
    # Best cap (0.6): 30 kW x 6 = 180.
    r, d = run([job()], {"j1": flat(100)}, [policy()])
    assert d["j1"].action == ActionKind.PAUSE
    assert r.it_reduction_kw.tolist() == pytest.approx([0, 0, 75, 75, 75, 75])
    assert d["j1"].delay_minutes == pytest.approx(40)


def test_tenant_pct_limit_forces_cap():
    # 50% of 100 kW less the 10% margin = 45 kW per interval: pause (75) is out.
    r, d = run([job()], {"j1": flat(100)}, [policy(max_reduction_pct=50)])
    assert d["j1"].action == ActionKind.CAP
    assert d["j1"].cap_power_frac == 0.6
    assert r.it_reduction_kw == pytest.approx(flat(30))


def test_min_guaranteed_limits_reduction():
    # Must keep 80 * 1.1 = 88 kW, so at most 12 kW: only the 0.9 cap (7.5 kW) fits.
    r, d = run([job()], {"j1": flat(100)}, [policy(min_guaranteed_kw=80)])
    assert d["j1"].cap_power_frac == 0.9
    assert r.it_reduction_kw == pytest.approx(flat(7.5))


def test_max_kw_limit_shared_across_jobs():
    # 20 kW cap less margin = 18 kW for the tenant. Two 100 kW jobs: best fit is
    # 0.9 on both (7.5 + 7.5 = 15) over one at 0.8 (15) tie-broken by less delay.
    jobs = [job("j1"), job("j2")]
    r, _d = run(jobs, {"j1": flat(100), "j2": flat(100)}, [policy(max_reduction_kw=20,
                                                                 max_reduction_pct=None)])
    assert r.it_reduction_kw == pytest.approx(flat(15))
    assert all(r.it_reduction_kw <= 18 + 1e-9)


def test_inference_floor():
    # Inference keeps >= 80%: caps 0.9 (keep 0.925) and 0.8 (keep 0.85) qualify,
    # 0.7 (keep 0.775) does not, and pausing is never allowed.
    r, d = run([job(jtype=JobType.INFERENCE)], {"j1": flat(100)}, [policy()])
    assert d["j1"].action == ActionKind.CAP
    assert d["j1"].cap_power_frac == 0.8
    assert r.it_reduction_kw == pytest.approx(flat(15))


def test_deadline_slack_limits_cap_depth():
    # 30 min window: cap 0.9 delays 0.9 min, 0.8 delays 2.4 min. Slack 2 min x 0.9
    # usable = 1.8 min, so only 0.9 fits; pausing (40 min) does not.
    _r, d = run([job(slack_min=2)], {"j1": flat(100)}, [policy()])
    assert d["j1"].cap_power_frac == 0.9
    assert d["j1"].delay_minutes == pytest.approx(0.9)


def test_defer_job_starting_in_window():
    # Starts at minute 10 (interval 2). Deferring removes all 4 intervals of it;
    # it starts at the window end, 20 minutes late. Deferring a tenant's only
    # job is a 100% reduction, so this needs a zero safety margin.
    p = np.array([0, 0, 50, 50, 50, 50.0])
    r, d = run([job(start_min=10)], {"j1": p}, [policy()], ModelParams(safety_margin=0))
    assert d["j1"].action == ActionKind.DEFER
    assert d["j1"].delay_minutes == pytest.approx(20)
    assert r.it_reduction_kw == pytest.approx(p)


def test_capped_job_ending_in_window_runs_longer():
    # Ends after interval 3; at 0.6 cap (throughput 0.76) it keeps running into
    # interval 4, which shows up as negative reduction there.
    p = np.array([100, 100, 100, 100, 0, 0.0])
    from curtail.engine.power_model import cap_option
    o = cap_option(p, 0.6, 0.76, P, job_ends_in_window=True)
    assert o.reduction[:4] == pytest.approx([30, 30, 30, 30])
    assert o.reduction[4] == pytest.approx(-70)
    assert o.delay_minutes == pytest.approx(20 / 0.76 - 20)


def test_independent_tenants_both_contribute():
    jobs = [job("a1", "A"), job("b1", "B")]
    power = {"a1": flat(100), "b1": flat(200)}
    _r, d = run(jobs, power, [policy("A", max_reduction_pct=50), policy("B", opted_in=False)])
    assert d["a1"].action == ActionKind.CAP
    assert d["b1"].reason == "tenant_not_opted_in"


def test_verifier_catches_violation():
    # Hand-built decision that breaks the tenant minimum must be flagged.
    from curtail.engine.types import Decision
    j = job()
    bad = Decision("j1", "A", ActionKind.PAUSE, reduction_kw=[75.0] * 6, delay_minutes=40)
    v = verify_event([bad], {"j1": j}, {"j1": flat(100)}, {"A": policy(min_guaranteed_kw=80)},
                     P, T0, T0 + timedelta(minutes=30), TZ, 6)
    assert {x.rule for x in v} == {"min_guaranteed"}
