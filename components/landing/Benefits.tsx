import { type ReactNode } from "react";
import { ProtectedSLA } from "./benefits/ProtectedSLA";
import { RevenueFlow } from "./benefits/RevenueFlow";
import { VerifiedCapacity } from "./benefits/VerifiedCapacity";
import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";
import {
  Parallax,
  Stagger,
  StaggerGroup,
  StaggerItem,
  duration,
  stagger,
} from "@/components/motion";

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
      <Stagger className="max-w-2xl">
        <StaggerItem distance="xs">
          <SectionLabel index="04">Benefits</SectionLabel>
        </StaggerItem>
        <StaggerItem
          as="h2"
          kind="blur"
          distance="md"
          duration={duration.slow}
          className="text-4xl font-semibold tracking-tight text-ink md:text-5xl md:leading-[1.15]"
        >
          Verified capacity. Protected tenants. New revenue.
        </StaggerItem>
      </Stagger>

      <div className="mt-16 flex flex-col gap-4">
        {BENEFITS.map((benefit, i) => {
          const flipped = i % 2 === 1;
          return (
            // Each card orchestrates itself: copy resolves first, the panel
            // follows. The visuals also drift in opposite directions per row,
            // which keeps the alternating layout from reading as a pattern.
            <Stagger key={benefit.title} step={stagger.loose}>
              <StaggerItem
                as="article"
                kind="scale"
                distance="md"
                duration={duration.slow}
                hover="lift"
                className={`group grid items-center gap-6 rounded-xl border border-ink/[0.08] bg-gray-50/50 p-4 transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:border-ink/[0.16] hover:shadow-[0_24px_48px_-36px_rgba(12,11,10,0.45)] lg:gap-10 lg:p-6 ${
                  flipped
                    ? "lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]"
                    : "lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]"
                }`}
              >
                <StaggerGroup
                  className={flipped ? "lg:order-2 lg:px-2" : "lg:pl-2"}
                  step={stagger.tight}
                >
                  <StaggerItem
                    as="p"
                    distance="xs"
                    className="font-mono text-[11px] tracking-[0.2em] text-gray-400 uppercase"
                  >
                    <span className="text-signal">{benefit.index}</span> Benefit
                  </StaggerItem>
                  <StaggerItem
                    as="h3"
                    distance="sm"
                    className="mt-4 text-2xl font-semibold tracking-tight text-ink md:text-3xl"
                  >
                    {benefit.title}
                  </StaggerItem>
                  <StaggerItem
                    as="p"
                    distance="xs"
                    className="mt-3 max-w-sm text-[15px] leading-relaxed text-gray-500"
                  >
                    {benefit.caption}
                  </StaggerItem>
                  <StaggerGroup
                    as="ul"
                    step={stagger.tight}
                    className="mt-6 flex flex-col gap-2 border-t border-ink/[0.07] pt-5"
                  >
                    {benefit.specs.map((spec) => (
                      <StaggerItem
                        as="li"
                        key={spec}
                        distance="xs"
                        duration={duration.fast}
                        className="flex items-center gap-2.5 font-mono text-[11px] tracking-[0.06em] text-gray-500"
                      >
                        <span className="h-1 w-1 shrink-0 rounded-full bg-signal" />
                        {spec}
                      </StaggerItem>
                    ))}
                  </StaggerGroup>
                </StaggerGroup>

                <Parallax
                  className={flipped ? "lg:order-1" : ""}
                  distance={flipped ? -14 : 14}
                >
                  <div className="overflow-hidden rounded-lg border border-ink/[0.08] bg-paper shadow-[0_20px_40px_-32px_rgba(12,11,10,0.4)] transition-shadow duration-[var(--dur-fast)] ease-[var(--ease-out)] group-hover:shadow-[0_28px_56px_-32px_rgba(12,11,10,0.5)]">
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
                </Parallax>
              </StaggerItem>
            </Stagger>
          );
        })}
      </div>
    </Section>
  );
}
