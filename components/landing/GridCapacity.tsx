import { GridCapacityField } from "./GridCapacityField";
import { Reveal } from "./Reveal";
import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";

export function GridCapacity() {
  return (
    <Section id="grid-capacity">
      <Reveal className="max-w-2xl">
        <SectionLabel index="03">The problem</SectionLabel>
        <p className="text-2xl leading-snug font-medium text-ink md:text-3xl">
          Demand spikes a few hours a year. Operators build for all 8,760.
        </p>
      </Reveal>

      <Reveal delay={0.15} className="mt-16">
        <GridCapacityField />
        <p className="mx-auto mt-8 max-w-md text-center text-sm text-gray-400">
          Tenant load absorbs the peak instead. Every tenant sets its own
          limit. Nothing new gets built.
        </p>
      </Reveal>
    </Section>
  );
}
