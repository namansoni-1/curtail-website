import { CoordinationVisual } from "./CoordinationVisual";
import { Reveal } from "./Reveal";
import { SectionLabel } from "./SectionLabel";

export function CoreInsight() {
  return (
    <section className="relative overflow-hidden border-t border-ink bg-ink px-6 py-32 md:py-44">
      <div className="relative mx-auto max-w-2xl text-center">
        <Reveal>
          <SectionLabel onDark>The core insight</SectionLabel>
        </Reveal>

        <Reveal delay={0.1} variant="blur">
          <p className="mx-auto max-w-lg text-2xl leading-snug font-medium text-paper sm:text-3xl">
            Data centers already have flexible load. Cooling. Batteries.
            Deferrable jobs. Operators just have no layer to see it or use it.
            Curtail is that layer.
          </p>
        </Reveal>

        <Reveal delay={0.25} className="mt-14">
          <CoordinationVisual />
        </Reveal>
      </div>
    </section>
  );
}
