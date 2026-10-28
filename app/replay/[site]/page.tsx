import type { Metadata } from "next";
import { SiteWorkspace } from "@/components/replay/SiteWorkspace";

export const metadata: Metadata = { title: "Curtail Replay" };

export default async function SitePage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <SiteWorkspace siteId={decodeURIComponent(site)} />
    </main>
  );
}
