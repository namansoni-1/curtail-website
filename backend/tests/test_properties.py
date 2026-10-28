"""Property tests: whatever the inputs, no reported decision breaks a tenant
minimum, a tenant limit, or a job deadline."""

from datetime import timedelta

import numpy as np
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from curtail.engine.event import solve_event
from curtail.engine.types import ActionKind, JobType
from curtail.engine.verifier import verify_event
from curtail.params import ModelParams
from tests.helpers import TZ, job, policy, spec

job_types = st.sampled_from([JobType.TRAINING, JobType.TRAINING, JobType.BATCH,
                             JobType.INFERENCE, JobType.UNKNOWN])


@st.composite
def scenario(draw):
    n = draw(st.integers(2, 24))
    tenants = [f"T{i}" for i in range(draw(st.integers(1, 4)))]
    policies = {}
    for t in tenants:
        policies[t] = policy(
            t,
            opted_in=draw(st.sampled_from([True, True, True, True, False, None])),
            max_reduction_pct=draw(st.one_of(st.floats(5, 100), st.floats(5, 100), st.none())),
            max_reduction_kw=draw(st.one_of(st.none(), st.floats(1, 500))),
            min_guaranteed_kw=draw(st.one_of(st.floats(0, 400), st.floats(0, 400), st.none())),
            compensation_per_mwh=draw(st.floats(0, 400)),
        )
    jobs, power = [], {}
    for i in range(draw(st.integers(1, 12))):
        start = draw(st.integers(-300, 5 * n - 5))
        end = draw(st.integers(max(start + 5, 1), 5 * n + 600))
        j = job(f"j{i}", draw(st.sampled_from(tenants)), draw(job_types), start, end,
                draw(st.one_of(st.floats(0, 600), st.floats(0, 600), st.none())))
        lo = max(0, start // 5) if start > 0 else 0
        hi = min(n, max(0, -(-end // 5)))
        p = np.zeros(n)
        p[lo:hi] = draw(st.lists(st.floats(1, 300), min_size=hi - lo, max_size=hi - lo)) \
            if hi > lo else []
        jobs.append(j)
        power[j.job_id] = p
    params = ModelParams(
        safety_margin=draw(st.floats(0, 0.5)),
        objective=draw(st.sampled_from(["mwh", "net_revenue"])),
        missing_deadline_policy="strict",
        missing_min_guaranteed_policy=draw(st.sampled_from(["strict", "zero"])),
    )
    return n, jobs, power, policies, params, draw(st.floats(-50, 3000))


@settings(max_examples=150, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(scenario())
def test_no_decision_violates_rules(sc):
    n, jobs, power, policies, params, price = sc
    s = spec(n=n, price=price)
    r = solve_event(s, jobs, power, policies, params, TZ)
    violations = verify_event(r.decisions, {j.job_id: j for j in jobs}, power, policies,
                              params, s.ws, s.we, TZ, n)
    assert violations == []

    # Spell the two headline guarantees out directly as well.
    for t, pol in policies.items():
        base = sum((power[j.job_id] for j in jobs if j.tenant_id == t), np.zeros(n))
        red = sum((np.asarray(d.reduction_kw) for d in r.decisions
                   if d.tenant_id == t and d.action != ActionKind.NONE), np.zeros(n))
        if np.any(red > 0):
            assert pol.opted_in is True
            floor = (pol.min_guaranteed_kw or 0.0) * (1 + params.safety_margin)
            assert np.all((red <= 1e-6) | (base - red >= floor - 1e-6))
    by_id = {j.job_id: j for j in jobs}
    for d in r.decisions:
        if d.action == ActionKind.NONE:
            continue
        j = by_id[d.job_id]
        assert j.job_type != JobType.UNKNOWN
        if j.job_type == JobType.INFERENCE:
            assert d.action == ActionKind.CAP
            keep = 1 - params.gpu_power_share * (1 - d.cap_power_frac)
            assert keep >= params.inference_floor_frac - 1e-9
        else:
            assert j.deadline is not None
            assert j.end + timedelta(minutes=d.delay_minutes) <= j.deadline


def test_random_scenarios_exercise_every_action():
    """Seeded fuzzing that also checks the generator is not vacuous: plenty of
    decisions must actually act, using every action kind."""
    from collections import Counter

    rng = np.random.default_rng(7)
    seen = Counter()
    for _ in range(300):
        n = int(rng.integers(3, 24))
        tenants = [f"T{i}" for i in range(int(rng.integers(1, 4)))]
        policies = {t: policy(t, max_reduction_pct=float(rng.uniform(10, 100)),
                              min_guaranteed_kw=float(rng.uniform(0, 300)),
                              max_reduction_kw=None if rng.random() < .5
                              else float(rng.uniform(5, 300)))
                    for t in tenants}
        jobs, power = [], {}
        for i in range(int(rng.integers(1, 15))):
            start = int(rng.integers(-300, 5 * n))
            end = int(rng.integers(max(start + 5, 1), 5 * n + 600))
            jt = rng.choice([JobType.TRAINING, JobType.BATCH, JobType.INFERENCE])
            j = job(f"j{i}", str(rng.choice(tenants)), JobType(jt), start, end,
                    float(rng.uniform(0, 600)))
            p = np.zeros(n)
            lo, hi = max(0, start // 5), min(n, -(-end // 5))
            if hi > lo:
                p[lo:hi] = rng.uniform(10, 300, hi - lo)
            jobs.append(j)
            power[j.job_id] = p
        params = ModelParams(safety_margin=float(rng.uniform(0, .3)))
        s = spec(n=n)
        r = solve_event(s, jobs, power, policies, params, TZ)
        assert verify_event(r.decisions, {j.job_id: j for j in jobs}, power, policies,
                            params, s.ws, s.we, TZ, n) == []
        seen.update(d.action for d in r.decisions)
    assert seen[ActionKind.CAP] > 50
    assert seen[ActionKind.PAUSE] > 10
    assert seen[ActionKind.DEFER] > 5
