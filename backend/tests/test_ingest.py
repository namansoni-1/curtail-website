import pandas as pd
import pytest

from curtail.grid.sources import classify_event
from curtail.ingest.parse import (
    classify_job_type, expand_nodelist, parse_duration_minutes, parse_gpus, parse_time,
)
from curtail.ingest.schemas import suggest_mapping
from curtail.ingest.service import parse_blackouts


def test_slurm_timelimit():
    s = pd.Series(["1-02:00:00", "02:30:00", "45:00", "90", "UNLIMITED", None])
    assert parse_duration_minutes(s).tolist()[:4] == [1560, 150, 45, 90]
    assert parse_duration_minutes(s).isna().tolist()[4:] == [True, True]
    assert parse_duration_minutes(pd.Series([60, 4294967295])).isna().tolist() == [False, True]


def test_nodelists():
    assert expand_nodelist("gpu[01-03,07]") == ["gpu01", "gpu02", "gpu03", "gpu07"]
    assert expand_nodelist("a1,b[1-2]") == ["a1", "b1", "b2"]
    assert expand_nodelist("['r1-n1', 'r2-n2']") == ["r1-n1", "r2-n2"]


def test_gpu_counts():
    s = pd.Series(["cpu=64,gres/gpu=8", "1=20,1001=2", "4", None])
    assert parse_gpus(s).tolist()[:3] == [8, 2, 4]


def test_times_epoch_and_local():
    t = parse_time(pd.Series([1609535703, 1609535704]), "UTC")
    assert str(t.iloc[0]) == "2021-01-01 21:15:03+00:00"
    t = parse_time(pd.Series(["2024-07-01 12:00", "Unknown"]), "America/New_York")
    assert str(t.iloc[0]) == "2024-07-01 16:00:00+00:00" and pd.isna(t.iloc[1])


def test_job_type_heuristics_and_map():
    s = pd.Series(["train-a100", "serve", "batch", "debug"])
    assert classify_job_type(s, None).tolist() == ["training", "inference", "batch", "unknown"]
    assert classify_job_type(s, {"debug": "batch"}).tolist() == ["unknown"] * 3 + ["batch"]


def test_blackouts():
    b, err = parse_blackouts("Mon-Fri 09:00-17:00; Sat,Sun 22:00-02:00; "
                             "2024-07-04T00:00/2024-07-05T00:00; nonsense")
    assert b[0] == {"days": [0, 1, 2, 3, 4], "start": "09:00", "end": "17:00"}
    assert b[1]["days"] == [5, 6]
    assert "starts_at" in b[2]
    assert err == ["nonsense"]


def test_presets_detected():
    m, preset = suggest_mapping("jobs", ["JobID", "Account", "Partition", "Submit", "Start",
                                         "End", "Timelimit", "NodeList", "AllocTRES"])
    assert preset == "sacct" and m["tenant_id"] == "Account"
    m, preset = suggest_mapping("node_power", ["timestamp", "Hostname", "gpu",
                                               "DCGM_FI_DEV_POWER_USAGE", "hpc_job"])
    assert preset == "dcgm" and m["power_w"] == "DCGM_FI_DEV_POWER_USAGE"


@pytest.mark.parametrize("text,kind", [
    ("Pre-Emergency Load Management Reduction Action", "dr"),
    ("Maximum Generation Emergency Action", "emergency"),
    ("Hot Weather Alert", None),
    ("Performance Assessment Interval", "emergency"),
])
def test_event_classification(text, kind):
    assert classify_event(text) == kind
