import { ScarcityGrid } from "./ScarcityGrid";
import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";
import { Stagger, StaggerItem, duration } from "@/components/motion";

const STATS = [
  { value: "176", label: "of 8,760 hours above $200/MWh" },
  { value: "40", label: "hours above $1,000/MWh" },
  { value: "21%", label: "of a flat load's energy bill, spent in its 100 priciest hours" },
];

export function GridCapacity() {
  return (
    <Section id="grid-capacity">
      <Stagger className="max-w-2xl">
        <StaggerItem distance="xs">
          <SectionLabel index="03">The problem</SectionLabel>
        </StaggerItem>
        <StaggerItem
          as="p"
          kind="blur"
          distance="md"
          duration={duration.slow}
          className="text-2xl leading-snug font-medium text-ink md:text-3xl"
        >
          Demand spikes a few hours a year. Operators build for all 8,760.
        </StaggerItem>
      </Stagger>

      {/* The grid sweeps in against scroll (see ScarcityGrid), so it only
          needs to be present — not revealed on top of that. */}
      <div className="mt-16">
        <ScarcityGrid />
      </div>

      <Stagger className="mt-14 grid gap-8 border-t border-ink/[0.07] pt-10 sm:grid-cols-3" step={0.1}>
        {STATS.map((s) => (
          <StaggerItem key={s.value} distance="xs">
            <div className="font-mono text-3xl tracking-tight text-ink tabular-nums">{s.value}</div>
            <p className="mt-2 max-w-[16rem] text-sm text-gray-500">{s.label}</p>
          </StaggerItem>
        ))}
      </Stagger>

      <Stagger className="mt-14">
        <StaggerItem as="p" distance="xs" className="max-w-md text-sm text-gray-400">
          Tenant load absorbs those hours instead. Every tenant sets its own limit.
          Nothing new gets built.
        </StaggerItem>
      </Stagger>
    </Section>
  );
}
