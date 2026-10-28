"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, unreachable, type Site } from "@/lib/replay/api";
import { DataTab } from "./DataTab";
import { ResultsTab } from "./ResultsTab";
import { ErrorNote } from "./ui";

export function SiteWorkspace({ siteId }: { siteId: string }) {
  const [site, setSite] = useState<Site | null>(null);
  const [tab, setTab] = useState<"results" | "data">("results");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .sites()
      .then((all) => {
        const s = all.find((x) => x.id === siteId);
        if (!s) setError(`No site "${siteId}"`);
        setSite(s ?? null);
      })
      .catch((e) => setError(unreachable(e)));
  }, [siteId]);

  return (
    <div>
      <Link href="/replay" className="text-xs text-gray-500 hover:text-ink">
        ← Sites
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">{site?.name ?? siteId}</h1>
          {site && (
            <p className="mt-1 text-sm text-gray-500">
              {site.iso} · {site.timezone}
            </p>
          )}
        </div>
        <div className="flex gap-1 rounded-full border border-ink/10 bg-white/70 p-1">
          {(["results", "data"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-full px-4 py-1.5 text-sm capitalize ${tab === t ? "bg-ink text-paper" : "text-gray-600 hover:text-ink"}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-6">
        <ErrorNote error={error} />
        {site && (tab === "results" ? <ResultsTab site={site} /> : <DataTab site={site} />)}
      </div>
    </div>
  );
}
