import { OperatorConsole } from "./console/OperatorConsole";
import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";
import {
  Parallax,
  Reveal,
  Stagger,
  StaggerGroup,
  StaggerItem,
  duration,
} from "@/components/motion";

export function Product() {
  return (
    <Section id="product">
      <Stagger className="flex flex-wrap items-end justify-between gap-6">
        <StaggerGroup className="max-w-xl">
          <StaggerItem distance="xs">
            <SectionLabel index="01">Product</SectionLabel>
          </StaggerItem>
          <StaggerItem
            as="h2"
            kind="blur"
            distance="md"
            duration={duration.slow}
            className="text-4xl font-semibold tracking-tight text-ink md:text-5xl md:leading-[1.15]"
          >
            Watch a dispatch run.
          </StaggerItem>
          <StaggerItem
            as="p"
            className="mt-4 text-base leading-relaxed text-gray-500 md:text-lg"
          >
            This is the operator console. One request, start to settlement.
          </StaggerItem>
        </StaggerGroup>

        <StaggerItem
          as="p"
          distance="xs"
          className="font-mono text-[11px] tracking-[0.14em] text-gray-400 uppercase"
        >
          Scrub any step below
        </StaggerItem>
      </Stagger>

      {/* The console rides slightly against the scroll so it reads as sitting
          in front of the copy above it. */}
      <Parallax className="mt-12" distance={18}>
        <Reveal kind="scale" distance="lg" duration={duration.cinematic}>
          <OperatorConsole />
        </Reveal>
      </Parallax>
    </Section>
  );
}
