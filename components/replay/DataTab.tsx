"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Site, type SiteStatus } from "@/lib/replay/api";
import { UploadWizard } from "./UploadWizard";
import { Badge, Btn, Card, ErrorNote, Table, fmt } from "./ui";

export function DataTab({ site }: { site: Site }) {
  const [status, setStatus] = useState<SiteStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    api.health().then((h) => setDemo(h.demo)).catch(() => {});
  }, []);

  const refresh = useCallback(() => {
    api.status(site.id).then(setStatus).catch((e) => setError(e.message));
  }, [site.id]);
  useEffect(refresh, [refresh]);

  return (
    <div className="space-y-5">
      <ErrorNote error={error} />
      {status && <StatusCard status={status} />}
      {!demo && (
        <>
          <UploadWizard siteId={site.id} timezone={site.timezone} onLoaded={refresh} />
          <GridFetch site={site} status={status} onLoaded={refresh} />
        </>
      )}
    </div>
  );
}

function range(r: { start: string | null; end: string | null }) {
  return r.start ? `${fmt.date(r.start)} – ${fmt.date(r.end!)}` : "—";
}

function StatusCard({ status }: { status: SiteStatus }) {
  const cc = status.cross_checks;
  const rows = [
    ["Facility power", status.facility_power.rows, range(status.facility_power), status.facility_power.rows ? "good" : "warn"],
    ["Per-job power", status.job_power.rows, range(status.job_power), status.job_power.rows ? "good" : "warn"],
    ["Job records", status.jobs.rows, "", status.jobs.rows ? "good" : "warn"],
    ["Tenant contracts", status.tenants.rows, "", status.tenants.rows ? "good" : "warn"],
    ["Grid signals", status.grid_signals.rows, range(status.grid_signals), status.grid_signals.rows ? "good" : "warn"],
  ] as const;
  return (
    <Card title="What's loaded" aside="Missing data is handled strictly: it protects jobs and tenants rather than counting them.">
      <Table
        head={["Dataset", "Rows", "Range", ""]}
        rows={rows.map(([n, c, r, tone]) => [
          n,
          c.toLocaleString(),
          r,
          <Badge key={n} tone={tone}>{tone === "good" ? "loaded" : "missing"}</Badge>,
        ])}
      />
      {(cc.jobs_without_power > 0 || cc.power_job_ids_unmatched > 0 || cc.tenants_without_config.length > 0) && (
        <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
          {cc.jobs_without_power > 0 && <li>{cc.jobs_without_power.toLocaleString()} jobs have no power data and cannot be acted on.</li>}
          {cc.power_job_ids_unmatched > 0 && <li>{cc.power_job_ids_unmatched.toLocaleString()} power series match no job record.</li>}
          {cc.tenants_without_config.length > 0 && <li>No contract for: {cc.tenants_without_config.join(", ")}.</li>}
        </ul>
      )}
    </Card>
  );
}

function GridFetch({ site, status, onLoaded }: { site: Site; status: SiteStatus | null; onLoaded: () => void }) {
  const [iso, setIso] = useState(site.iso || "PJM");
  const [node, setNode] = useState(site.price_node ?? "");
  const start0 = status?.facility_power.start?.slice(0, 10) ?? "";
  const end0 = status?.facility_power.end?.slice(0, 10) ?? "";
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = (await api.fetchGrid(site.id, {
        iso,
        node: node || undefined,
        start: start || start0,
        end: end || end0,
      })) as Record<string, string | number>;
      setMsg(`Loaded ${Number(r.price_intervals).toLocaleString()} price intervals from ${r.source}. ${r.events_note}`);
      onLoaded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Fetch grid prices" aside="Used when no grid signals were uploaded. Cached on disk.">
      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Market</span>
          <select value={iso} onChange={(e) => setIso(e.target.value)} className="rounded-md border border-ink/15 bg-white px-2 py-1.5">
            <option value="PJM">PJM (real-time LMP, API key)</option>
            <option value="ERCOT">ERCOT (real-time SPP, public)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">{iso === "PJM" ? "Pnode id" : "Settlement point"}</span>
          <input value={node} onChange={(e) => setNode(e.target.value)} placeholder={iso === "PJM" ? "51288 (Western Hub)" : "HB_NORTH"} className="w-44 rounded-md border border-ink/15 bg-white px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">Start</span>
          <input type="date" value={start || start0} onChange={(e) => setStart(e.target.value)} className="rounded-md border border-ink/15 bg-white px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-500">End</span>
          <input type="date" value={end || end0} onChange={(e) => setEnd(e.target.value)} className="rounded-md border border-ink/15 bg-white px-2 py-1.5" />
        </label>
        <Btn onClick={go} disabled={busy || !(start || start0)}>
          {busy ? "Fetching…" : "Fetch"}
        </Btn>
      </div>
      {msg && <p className="mt-3 text-sm text-gray-700">{msg}</p>}
      <div className="mt-3">
        <ErrorNote error={error} />
      </div>
    </Card>
  );
}
