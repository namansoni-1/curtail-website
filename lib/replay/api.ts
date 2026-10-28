// Thin client for the Curtail Replay API (backend/curtail/api/main.py).

export const API_BASE =
  process.env.NEXT_PUBLIC_CURTAIL_API ?? "http://localhost:8000";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers:
      init?.body instanceof FormData
        ? init.headers
        : { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {}
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return res.json() as Promise<T>;
}

export type Site = {
  id: string;
  name: string;
  timezone: string;
  iso: string;
  price_node: string | null;
};

export type DatasetKind =
  | "facility_power"
  | "node_power"
  | "job_power"
  | "jobs"
  | "tenants"
  | "grid_signals"
  | "grid_events";

export type FieldSpec = { name: string; required: boolean; kind: string; help: string };

export type Preview = {
  dataset_id: string;
  kind: DatasetKind;
  filename: string;
  columns: string[];
  rows: Record<string, unknown>[];
  suggested_mapping: Record<string, string>;
  preset: string | null;
  fields: FieldSpec[];
};

export type SiteStatus = {
  facility_power: { rows: number; start: string | null; end: string | null };
  grid_signals: { rows: number; start: string | null; end: string | null };
  job_power: { rows: number; start: string | null; end: string | null };
  jobs: { rows: number };
  tenants: { rows: number };
  cross_checks: {
    jobs_without_power: number;
    power_job_ids_unmatched: number;
    tenants_without_config: string[];
    configured_tenants_without_jobs: string[];
  };
  datasets: {
    id: string;
    kind: string;
    filename: string;
    status: string;
    rows_loaded: number;
    created_at: string;
  }[];
};

export type CapPoint = { power_frac: number; throughput_frac: number };

export type Params = {
  price_threshold_per_mwh: number;
  include_grid_events: boolean;
  min_event_minutes: number;
  max_event_minutes: number;
  interval_minutes: number;
  safety_margin: number;
  cap_curve: CapPoint[];
  gpu_power_share: number;
  inference_floor_frac: number;
  checkpoint_minutes: number;
  restart_minutes: number;
  paused_power_frac: number;
  facility_kw_per_it_kw: number;
  assumed_pue: number;
  energy_value_basis: "rt_price" | "fixed";
  fixed_energy_price_per_mwh: number;
  dr_payment_per_mwh: number;
  default_compensation_per_mwh: number;
  objective: "mwh" | "net_revenue";
  missing_deadline_policy: "strict" | "timelimit";
  missing_min_guaranteed_policy: "strict" | "zero";
  opt_in_rate: number;
  mode: "hindsight" | "forecast";
  forecast_train_samples: number;
  solver_time_limit_s: number;
};

export type Summary = {
  period_start: string | null;
  period_end: string | null;
  period_months: number;
  events: number;
  events_with_reduction: number;
  event_hours: number;
  firm_mwh: number;
  avg_firm_mw_during_events: number;
  peak_firm_mw: number;
  jobs_affected: number;
  actions: Partial<Record<"cap" | "pause" | "defer", number>>;
  gross_value: number;
  rebound_cost: number;
  tenant_compensation: number;
  operator_net: number;
  sla_violations_reported: number;
  decisions_dropped_by_verifier: number;
  mode: "hindsight" | "forecast";
};

export type DecisionOut = {
  job_id: string;
  tenant_id: string | null;
  action: "none" | "cap" | "pause" | "defer";
  cap_power_frac: number | null;
  avg_reduction_kw: number;
  delay_minutes: number;
  slack_minutes: number | null;
  deadline_risk: "low" | "medium" | "high" | null;
  reason: string;
  flags: string[];
};

export type EventOut = {
  event_id: string;
  kind: "price" | "dr" | "emergency";
  start: string;
  end: string;
  avg_price: number;
  rebound_price: number;
  firm_avg_mw: number;
  firm_min_mw: number;
  firm_mwh: number;
  gross_value: number;
  rebound_cost: number;
  tenant_compensation: number;
  operator_net: number;
  solver_status: string;
  violations_dropped: { rule: string; tenant_id: string | null; job_id: string | null; detail: string }[];
  series: {
    ts: string[];
    facility_kw: (number | null)[];
    it_kw: (number | null)[];
    firm_reduction_kw: (number | null)[];
    price: (number | null)[];
  };
  tenants: Record<
    string,
    {
      modeled_mwh: number;
      jobs_affected: number;
      compensation: number;
      baseline_avg_kw: number;
      excluded_reason: string | null;
    }
  >;
  decisions: DecisionOut[];
};

export type TenantOut = {
  tenant_id: string;
  modeled_mwh: number;
  compensation: number;
  events_participated: number;
  jobs_affected: number;
  exclusions: Record<string, number>;
};

export type RunResult = {
  id: string;
  site_id: string;
  status: string;
  error: string | null;
  params: Params;
  summary: Summary;
  flags: Record<string, number>;
  tenants: TenantOut[];
  events: EventOut[];
  timeline: {
    ts: string[];
    actual_kw: (number | null)[];
    reduced_kw: (number | null)[];
    windows: { start: string; end: string; kind: string }[];
  };
};

export const api = {
  sites: () => call<Site[]>("/api/sites"),
  createSite: (s: Omit<Site, "price_node"> & { price_node?: string | null }) =>
    call<{ id: string }>("/api/sites", { method: "POST", body: JSON.stringify(s) }),
  loadSample: (siteId: string) =>
    call<{ ok: boolean }>(`/api/sites/${siteId}/load-sample`, { method: "POST" }),
  status: (siteId: string) => call<SiteStatus>(`/api/sites/${siteId}/status`),
  upload: (siteId: string, kind: DatasetKind, file: File) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    return call<Preview>(`/api/sites/${siteId}/uploads`, { method: "POST", body: fd });
  },
  apply: (datasetId: string, mapping: Record<string, string>, options: object) =>
    call<Record<string, unknown>>(`/api/datasets/${datasetId}/apply`, {
      method: "POST",
      body: JSON.stringify({ mapping, options }),
    }),
  fetchGrid: (siteId: string, body: { iso: string; node?: string; start: string; end: string }) =>
    call<Record<string, unknown>>(`/api/sites/${siteId}/grid/fetch`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  defaults: () => call<Params>("/api/params/defaults"),
  runs: (siteId: string) =>
    call<{ id: string; status: string; created_at: string; summary: Summary | null }[]>(
      `/api/sites/${siteId}/runs`,
    ),
  createRun: (siteId: string, params: Partial<Params>) =>
    call<{ id: string; status: string; summary: Summary }>(`/api/sites/${siteId}/runs`, {
      method: "POST",
      body: JSON.stringify(params),
    }),
  run: (runId: string) => call<RunResult>(`/api/runs/${runId}`),
  pdfUrl: (runId: string) => `${API_BASE}/api/runs/${runId}/report.pdf`,
};
