import { type ReactNode } from "react";
import { ProtectedSLA } from "./benefits/ProtectedSLA";
import { RevenueFlow } from "./benefits/RevenueFlow";
import { VerifiedCapacity } from "./benefits/VerifiedCapacity";
import { Reveal } from "./Reveal";
import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";

type Benefit = {
  index: string;
  title: string;
  caption: string;
  specs: string[];
  file: string;
  visual: ReactNode;
};

const BENEFITS: Benefit[] = [
  {
    index: "01",
    title: "Verified capacity",
    caption:
      "Every MW is checked against tenant permissions before it commits. You offer what you can actually deliver.",
    specs: ["Per tenant, per event", "Full audit trail", "No overselling"],
    file: "verification.log",
    visual: <VerifiedCapacity />,
  },
  {
    index: "02",
    title: "Protected SLAs",
    caption:
      "Only opted-in tenants flex. Every other workload runs exactly as contracted.",
    specs: ["Tenant-set limits", "Opt out anytime", "No contract changes"],
    file: "tenant-load.live",
    visual: <ProtectedSLA />,
  },
  {
    index: "03",
    title: "New revenue",
    caption:
      "Grid payments split back per verified MW. Tenants get paid for the load they gave up.",
    specs: ["Settled per event", "Split by delivery", "Paid to the source"],
    file: "settlement.split",
    visual: <RevenueFlow />,
  },
];

export function Benefits() {
  return (
    <Section id="benefits">
      <Reveal className="max-w-2xl">
        <SectionLabel index="04">Benefits</SectionLabel>
        <h2 className="text-4xl font-semibold tracking-tight text-ink md:text-5xl md:leading-[1.15]">
          Verified capacity. Protected tenants. New revenue.
        </h2>
      </Reveal>

      <div className="mt-16 flex flex-col gap-4">
        {BENEFITS.map((benefit, i) => (
          <Reveal key={benefit.title} delay={0.05}>
            <article
              className={`grid items-center gap-6 rounded-xl border border-ink/[0.08] bg-gray-50/50 p-4 transition-colors duration-500 hover:border-ink/[0.16] lg:gap-10 lg:p-6 ${
                i % 2 === 1
                  ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]"
                  : "lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]"
              }`}
            >
              <div className={i % 2 === 1 ? "lg:order-2 lg:px-2" : "lg:pl-2"}>
                <p className="font-mono text-[11px] tracking-[0.2em] text-gray-400 uppercase">
                  <span className="text-signal">{benefit.index}</span> Benefit
                </p>
                <h3 className="mt-4 text-2xl font-semibold tracking-tight text-ink md:text-3xl">
                  {benefit.title}
                </h3>
                <p className="mt-3 max-w-sm text-[15px] leading-relaxed text-gray-500">
                  {benefit.caption}
                </p>
                <ul className="mt-6 flex flex-col gap-2 border-t border-ink/[0.07] pt-5">
                  {benefit.specs.map((spec) => (
                    <li
                      key={spec}
                      className="flex items-center gap-2.5 font-mono text-[11px] tracking-[0.06em] text-gray-500"
                    >
                      <span className="h-1 w-1 shrink-0 rounded-full bg-signal" />
                      {spec}
                    </li>
                  ))}
                </ul>
              </div>

              <div
                className={`overflow-hidden rounded-lg border border-ink/[0.08] bg-paper shadow-[0_20px_40px_-32px_rgba(12,11,10,0.4)] ${
                  i % 2 === 1 ? "lg:order-1" : ""
                }`}
              >
                <div className="flex h-8 items-center justify-between border-b border-ink/[0.06] px-3.5">
                  <span className="font-mono text-[10px] tracking-[0.14em] text-gray-400">
                    {benefit.file}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.16em] text-gray-400 uppercase">
                    <span className="h-1.5 w-1.5 rounded-full bg-signal" />
                    Running
                  </span>
                </div>
                {benefit.visual}
              </div>
            </article>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
