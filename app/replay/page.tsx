import type { Metadata } from "next";
import { SiteList } from "@/components/replay/SiteList";

export const metadata: Metadata = {
  title: "Curtail Replay",
  description: "Replay historical facility data to see how much power you could have safely curtailed.",
};

export default function ReplayHome() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">Curtail Replay</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">Sites</h1>
      <p className="mt-2 max-w-2xl text-gray-600">
        Upload a facility&apos;s history to see how much power it could have safely reduced during grid events and
        price spikes, which jobs it would have touched, and what it would have earned.
      </p>
      <div className="mt-8">
        <SiteList />
      </div>
    </main>
  );
}
