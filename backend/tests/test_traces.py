import pandas as pd

from curtail.traces.supercloud import align_clock


def test_align_clock_detects_whole_hour_offset():
    starts = pd.to_datetime(["2021-02-10 12:00", "2021-02-11 08:30"], utc=True)
    jobs = pd.DataFrame({"id_job": [1, 2], "time_start": starts})
    # Traces written 5 hours early (local wall clock stored as UTC), first
    # sample a couple of minutes after the job starts.
    power = pd.DataFrame({
        "id_job": [1, 1, 2],
        "ts": [starts[0] - pd.Timedelta("4h58min"), starts[0] - pd.Timedelta("4h53min"),
               starts[1] - pd.Timedelta("4h57min")],
        "gpu_kw": [0.2, 0.2, 0.3],
    })
    fixed, shift = align_clock(power, jobs)
    assert shift == 5.0
    assert (fixed.groupby("id_job")["ts"].min() >= jobs.set_index("id_job")["time_start"]).all()
