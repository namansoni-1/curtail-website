import { GridCapacityField } from "./GridCapacityField";
import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";
import { Stagger, StaggerItem, duration } from "@/components/motion";

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

      {/* The chart draws itself against scroll (see GridCapacityField), so it
          only needs to be present — not revealed on top of that. */}
      <Stagger className="mt-16" step={0.14}>
        <StaggerItem kind="fade" distance="sm" duration={duration.slow}>
          <GridCapacityField />
        </StaggerItem>
        <StaggerItem
          as="p"
          distance="xs"
          className="mx-auto mt-8 max-w-md text-center text-sm text-gray-400"
        >
          Tenant load absorbs the peak instead. Every tenant sets its own limit.
          Nothing new gets built.
        </StaggerItem>
      </Stagger>
    </Section>
  );
}
