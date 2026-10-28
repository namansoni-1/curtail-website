"use client";

import { useState } from "react";
import { api, type DatasetKind, type Preview } from "@/lib/replay/api";
import { Btn, Card, ErrorNote, Table, fmt } from "./ui";

const KINDS: { kind: DatasetKind; label: string; hint: string }[] = [
  { kind: "facility_power", label: "Facility power", hint: "Required. Timestamp, total kW, optional IT and cooling kW." },
  { kind: "jobs", label: "Job records", hint: "Slurm sacct or Kubernetes pod metadata." },
  { kind: "node_power", label: "Node / GPU power", hint: "DCGM exporter samples; attributed to jobs." },
  { kind: "job_power", label: "Per-job power", hint: "Already attributed: timestamp, job id, kW." },
  { kind: "tenants", label: "Tenant contracts", hint: "Opt-in, limits, guaranteed minimum, blackouts, $/MWh." },
  { kind: "grid_signals", label: "Grid signals", hint: "Price $/MWh and DR / emergency flags." },
  { kind: "grid_events", label: "Grid events", hint: "Event postings, e.g. the PJM Emergency Procedures CSV export." },
];

const POWER_FIELDS = new Set(["total_kw", "it_kw", "cooling_kw", "power_w", "kw"]);

export function UploadWizard({ siteId, timezone, onLoaded }: { siteId: string; timezone: string; onLoaded: () => void }) {
  const [kind, setKind] = useState<DatasetKind>("facility_power");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [tz, setTz] = useState(timezone);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [typeMap, setTypeMap] = useState("");
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doUpload() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      const p = await api.upload(siteId, kind, file);
      setPreview(p);
      setMapping(p.suggested_mapping);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doApply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const job_type_map = Object.fromEntries(
        typeMap
          .split(",")
          .map((p) => p.split("=").map((s) => s.trim()))
          .filter((p) => p.length === 2 && p[0] && p[1]),
      );
      const options: Record<string, unknown> = { timezone: tz, units };
      if (Object.keys(job_type_map).length) options.job_type_map = job_type_map;
      const clean = Object.fromEntries(Object.entries(mapping).filter(([, v]) => v));
      setReport(await api.apply(preview.dataset_id, clean, options));
      onLoaded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Upload data" aside="CSV or Parquet. Uploading a kind again replaces it.">
      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="flex flex-col gap-1">
          {KINDS.map((k) => (
            <button
              key={k.kind}
              onClick={() => {
                setKind(k.kind);
                setPreview(null);
                setReport(null);
              }}
              className={`rounded-lg px-3 py-2 text-left text-sm transition-colors ${kind === k.kind ? "bg-ink text-paper" : "text-gray-700 hover:bg-ink/[0.04]"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="min-w-0">
          <p className="mb-3 text-sm text-gray-600">{KINDS.find((k) => k.kind === kind)?.hint}</p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,.parquet,.pq,.txt,.gz"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-full file:border file:border-ink/15 file:bg-transparent file:px-3 file:py-1.5 file:text-sm"
            />
            <Btn onClick={doUpload} disabled={!file || busy}>
              {busy && !preview ? "Reading…" : "Read file"}
            </Btn>
          </div>
          <ErrorNote error={error} />

          {preview && (
            <div className="mt-5 space-y-4">
              <div className="text-sm text-gray-600">
                <span className="font-medium text-ink">{preview.filename}</span> · {preview.columns.length} columns
                {preview.preset && <> · detected <span className="font-medium text-ink">{preview.preset}</span> export</>}
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">Map columns</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {preview.fields.map((f) => (
                    <label key={f.name} className="flex items-center gap-2 text-sm">
                      <span className="w-40 shrink-0 font-mono text-xs text-gray-700">
                        {f.name}
                        {f.required && <span className="text-signal"> *</span>}
                      </span>
                      <select
                        value={mapping[f.name] ?? ""}
                        onChange={(e) => setMapping({ ...mapping, [f.name]: e.target.value })}
                        className="min-w-0 flex-1 rounded-md border border-ink/15 bg-white px-2 py-1 text-sm"
                        title={f.help}
                      >
                        <option value="">— not mapped —</option>
                        {preview.columns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      {POWER_FIELDS.has(f.name) && mapping[f.name] && (
                        <select
                          value={units[f.name] ?? (f.name === "power_w" ? "W" : "kW")}
                          onChange={(e) => setUnits({ ...units, [f.name]: e.target.value })}
                          className="rounded-md border border-ink/15 bg-white px-1 py-1 text-xs"
                          aria-label={`${f.name} unit`}
                        >
                          <option>W</option>
                          <option>kW</option>
                          <option>MW</option>
                        </select>
                      )}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <span className="text-gray-600">Timezone for naive timestamps</span>
                  <input value={tz} onChange={(e) => setTz(e.target.value)} className="w-48 rounded-md border border-ink/15 bg-white px-2 py-1" />
                </label>
                {kind === "jobs" && (
                  <label className="flex min-w-[320px] flex-1 items-center gap-2">
                    <span className="text-gray-600">Job type map</span>
                    <input
                      value={typeMap}
                      onChange={(e) => setTypeMap(e.target.value)}
                      placeholder="gpu-train=training, serve=inference (blank = keyword guess)"
                      className="flex-1 rounded-md border border-ink/15 bg-white px-2 py-1"
                    />
                  </label>
                )}
              </div>
              <details>
                <summary className="cursor-pointer text-xs text-gray-500">Preview first rows</summary>
                <Table
                  className="mt-2 max-h-64 overflow-auto"
                  head={preview.columns.slice(0, 12)}
                  rows={preview.rows.slice(0, 8).map((r) => preview.columns.slice(0, 12).map((c) => String(r[c] ?? "")))}
                />
              </details>
              <Btn onClick={doApply} disabled={busy}>
                {busy ? "Validating…" : "Validate and load"}
              </Btn>
            </div>
          )}

          {report && <ValidationReport report={report} />}
        </div>
      </div>
    </Card>
  );
}

function ValidationReport({ report }: { report: Record<string, unknown> }) {
  const r = report as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  const issues: string[] = [];
  if (r.parse?.rows_unparseable) issues.push(`${r.parse.rows_unparseable} rows could not be parsed and were dropped`);
  if (r.intervals_missing) issues.push(`${r.intervals_missing} missing ${r.interval_minutes}-minute intervals (${(100 - r.coverage_pct).toFixed(1)}%)`);
  if (r.duplicate_timestamps) issues.push(`${r.duplicate_timestamps} duplicate timestamps (averaged)`);
  for (const [col, o] of Object.entries((r.outliers ?? {}) as Record<string, any>)) { // eslint-disable-line @typescript-eslint/no-explicit-any
    if (o.negative) issues.push(`${col}: ${o.negative} negative values`);
    if (o.robust_z_gt_8) issues.push(`${col}: ${o.robust_z_gt_8} extreme outliers`);
    if (o.negative_kw) issues.push(`${o.negative_kw} negative kW samples dropped`);
  }
  if (r.it_exceeds_total) issues.push(`IT load exceeds total in ${r.it_exceeds_total} intervals`);
  if (r.end_before_start) issues.push(`${r.end_before_start} jobs end before they start (dropped)`);
  if (r.missing_deadline) issues.push(`${r.missing_deadline} jobs have no deadline (treated as zero slack)`);
  if (r.job_types?.unknown) issues.push(`${r.job_types.unknown} jobs have an unknown type (protected)`);
  const cc = r.cross_checks ?? {};
  if (cc.power_job_ids_unmatched) issues.push(`${cc.power_job_ids_unmatched} power job ids match no job record`);
  if (cc.jobs_without_power) issues.push(`${cc.jobs_without_power} jobs have no power data (not counted)`);
  if (cc.tenants_without_config?.length) issues.push(`Tenants without contract config (protected): ${cc.tenants_without_config.join(", ")}`);
  if (r.blackout_parse_errors?.length) issues.push(`Unreadable blackout windows: ${r.blackout_parse_errors.join("; ")}`);

  return (
    <div className="mt-5 rounded-xl border border-ink/10 bg-gray-50 p-4 text-sm">
      <div className="mb-2 font-medium text-ink">
        Loaded {r.rows_loaded?.toLocaleString()} rows
        {r.date_range?.start && (
          <span className="font-normal text-gray-600">
            {" "}· {fmt.date(r.date_range.start)} – {fmt.date(r.date_range.end)}
          </span>
        )}
      </div>
      {issues.length === 0 ? (
        <p className="text-gray-600">No issues found.</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-5 text-gray-700">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-gray-500">Full report</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-white p-2 text-xs">{JSON.stringify(report, null, 2)}</pre>
      </details>
    </div>
  );
}
