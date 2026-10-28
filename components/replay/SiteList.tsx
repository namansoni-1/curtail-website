"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Site } from "@/lib/replay/api";
import { Btn, Card, ErrorNote } from "./ui";

export function SiteList() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ id: "", name: "", timezone: "America/New_York", iso: "PJM" });
  const [busy, setBusy] = useState(false);

  const load = () => api.sites().then(setSites).catch((e) => setError(`${e.message}. Is the API running on ${process.env.NEXT_PUBLIC_CURTAIL_API ?? "localhost:8000"}?`));
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      await api.createSite({ ...form, id: form.id || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") });
      setForm({ ...form, id: "", name: "" });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function sample() {
    setBusy(true);
    setError(null);
    try {
      await api.createSite({ id: "sample", name: "Sample site (synthetic)", timezone: "America/New_York", iso: "PJM" });
      await api.loadSample("sample");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <ErrorNote error={error} />
      {sites && sites.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((s) => (
            <Link
              key={s.id}
              href={`/replay/${encodeURIComponent(s.id)}`}
              className="rounded-2xl border border-ink/10 bg-white/70 p-5 transition-colors hover:border-ink/25"
            >
              <div className="font-medium text-ink">{s.name}</div>
              <div className="mt-1 text-xs text-gray-500">
                {s.id} · {s.iso} · {s.timezone}
              </div>
            </Link>
          ))}
        </div>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <Card title="New site">
          <div className="grid gap-3 text-sm">
            <input placeholder="Name, e.g. Ashburn DC-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md border border-ink/15 bg-white px-3 py-2" />
            <div className="flex gap-3">
              <input placeholder="Timezone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="flex-1 rounded-md border border-ink/15 bg-white px-3 py-2" />
              <select value={form.iso} onChange={(e) => setForm({ ...form, iso: e.target.value })} className="rounded-md border border-ink/15 bg-white px-3 py-2">
                <option>PJM</option>
                <option>ERCOT</option>
              </select>
            </div>
            <Btn onClick={create} disabled={busy || !form.name}>Create site</Btn>
          </div>
        </Card>
        <Card title="Try it with sample data">
          <p className="mb-4 text-sm text-gray-600">
            Two weeks of a synthetic three-tenant facility: training, inference and batch workloads, price spikes and a
            demand-response event. Loaded through the same upload and validation path as real data.
          </p>
          <Btn variant="secondary" onClick={sample} disabled={busy}>
            {busy ? "Loading…" : "Load sample site"}
          </Btn>
        </Card>
      </div>
    </div>
  );
}
