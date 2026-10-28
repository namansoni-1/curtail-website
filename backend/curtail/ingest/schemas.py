"""Canonical dataset shapes, plus column-name presets for common exports
(DCGM exporter, Slurm sacct, Kubernetes pod metadata)."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Field:
    name: str
    required: bool = False
    kind: str = "float"  # float | time | str | bool | int | list | duration | power
    help: str = ""


DATASETS: dict[str, list[Field]] = {
    "facility_power": [
        Field("ts", True, "time", "Interval timestamp"),
        Field("total_kw", True, "power", "Total facility power"),
        Field("it_kw", False, "power", "IT load"),
        Field("cooling_kw", False, "power", "Cooling load"),
    ],
    "node_power": [
        Field("ts", True, "time", "Sample timestamp"),
        Field("host", True, "str", "Node hostname"),
        Field("gpu", False, "str", "GPU index or UUID"),
        Field("power_w", True, "power", "GPU power draw (DCGM_FI_DEV_POWER_USAGE)"),
        Field("job_id", False, "str", "Job label (Slurm job id or pod name)"),
    ],
    "job_power": [
        Field("ts", True, "time", "Interval timestamp"),
        Field("job_id", True, "str"),
        Field("kw", True, "power", "IT power attributable to the job"),
    ],
    "jobs": [
        Field("job_id", True, "str"),
        Field("tenant_id", False, "str", "Account, namespace or customer"),
        Field("job_type", False, "str", "training / inference / batch (mapped from a column)"),
        Field("submit", False, "time"),
        Field("start", True, "time"),
        Field("end", True, "time"),
        Field("deadline", False, "time", "SLA deadline; missing = strict (no slack)"),
        Field("timelimit", False, "duration", "Requested walltime"),
        Field("checkpointable", False, "bool"),
        Field("gpus", False, "int"),
        Field("nodes", False, "list", "Node list, for attributing node power"),
    ],
    "tenants": [
        Field("tenant_id", True, "str"),
        Field("opted_in", False, "bool"),
        Field("max_reduction_pct", False, "float"),
        Field("max_reduction_kw", False, "float"),
        Field("min_guaranteed_kw", False, "float"),
        Field("blackout_windows", False, "str",
              "e.g. 'Mon-Fri 09:00-17:00; 2024-07-04T00:00/2024-07-05T00:00'"),
        Field("compensation_per_mwh", False, "float"),
        Field("valid_from", False, "time"),
        Field("valid_to", False, "time"),
    ],
    "grid_signals": [
        Field("ts", True, "time"),
        Field("price", False, "float", "$/MWh"),
        Field("dr_flag", False, "bool", "Demand response event active"),
        Field("emergency_flag", False, "bool", "Grid emergency active"),
    ],
}

# Exact (case-insensitive) source column names for well-known exports.
PRESETS: dict[str, dict[str, dict[str, str]]] = {
    "dcgm": {"node_power": {
        "ts": "timestamp", "host": "Hostname", "gpu": "gpu",
        "power_w": "DCGM_FI_DEV_POWER_USAGE", "job_id": "hpc_job",
    }},
    "sacct": {"jobs": {
        "job_id": "JobID", "tenant_id": "Account", "job_type": "Partition",
        "submit": "Submit", "start": "Start", "end": "End", "timelimit": "Timelimit",
        "nodes": "NodeList", "gpus": "AllocTRES",
    }},
    "k8s": {"jobs": {
        "job_id": "pod", "tenant_id": "namespace", "job_type": "workload_type",
        "submit": "creationTimestamp", "start": "startTime", "end": "finishedAt",
        "nodes": "nodeName", "gpus": "nvidia.com/gpu",
    }},
}

SYNONYMS: dict[str, list[str]] = {
    "ts": ["ts", "timestamp", "time", "datetime", "interval_start", "date"],
    "total_kw": ["total_kw", "facility_kw", "total_power", "site_kw", "kw", "load_kw"],
    "it_kw": ["it_kw", "it_load", "it_power"],
    "cooling_kw": ["cooling_kw", "mechanical_kw", "cooling"],
    "host": ["host", "hostname", "node", "instance"],
    "gpu": ["gpu", "gpu_index", "gpu_uuid", "uuid"],
    "power_w": ["power_w", "dcgm_fi_dev_power_usage", "power_draw_w", "power"],
    "job_id": ["job_id", "jobid", "id_job", "pod", "job", "hpc_job"],
    "kw": ["kw", "power_kw"],
    "tenant_id": ["tenant_id", "tenant", "account", "namespace", "customer"],
    "job_type": ["job_type", "type", "workload_type", "partition", "qos"],
    "submit": ["submit", "time_submit", "submit_time", "creationtimestamp"],
    "start": ["start", "time_start", "start_time", "starttime"],
    "end": ["end", "time_end", "end_time", "finishedat"],
    "deadline": ["deadline", "sla_deadline", "due"],
    "timelimit": ["timelimit", "time_limit", "walltime"],
    "checkpointable": ["checkpointable", "can_checkpoint"],
    "gpus": ["gpus", "gpu_count", "num_gpus", "nvidia.com/gpu", "alloctres"],
    "nodes": ["nodes", "nodelist", "nodename"],
    "opted_in": ["opted_in", "opt_in", "enrolled"],
    "max_reduction_pct": ["max_reduction_pct", "max_pct"],
    "max_reduction_kw": ["max_reduction_kw", "max_kw"],
    "min_guaranteed_kw": ["min_guaranteed_kw", "min_kw", "guaranteed_kw"],
    "blackout_windows": ["blackout_windows", "blackouts", "blackout"],
    "compensation_per_mwh": ["compensation_per_mwh", "rate_per_mwh", "compensation"],
    "valid_from": ["valid_from", "effective_from"],
    "valid_to": ["valid_to", "effective_to"],
    "price": ["price", "lmp", "price_per_mwh", "total_lmp_rt", "spp", "settlement_point_price"],
    "dr_flag": ["dr_flag", "dr", "demand_response", "dr_event"],
    "emergency_flag": ["emergency_flag", "emergency", "eea"],
}


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9./]", "", s.lower())


def suggest_mapping(kind: str, columns: list[str]) -> tuple[dict[str, str], str | None]:
    """Guess source columns for each canonical field. Returns (mapping, preset)."""
    by_norm = {_norm(c): c for c in columns}
    for preset, shapes in PRESETS.items():
        shape = shapes.get(kind)
        if shape and sum(_norm(v) in by_norm for v in shape.values()) >= max(2, len(shape) // 2):
            return {k: by_norm[_norm(v)] for k, v in shape.items() if _norm(v) in by_norm}, preset
    mapping: dict[str, str] = {}
    for f in DATASETS[kind]:
        for syn in SYNONYMS.get(f.name, [f.name]):
            if _norm(syn) in by_norm and by_norm[_norm(syn)] not in mapping.values():
                mapping[f.name] = by_norm[_norm(syn)]
                break
    return mapping, None
