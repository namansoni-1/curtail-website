import { OperatorConsole } from "./console/OperatorConsole";
import { Reveal } from "./Reveal";
import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";

export function Product() {
  return (
    <Section id="product">
      <Reveal className="flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-xl">
          <SectionLabel index="01">Product</SectionLabel>
          <h2 className="text-4xl font-semibold tracking-tight text-ink md:text-5xl md:leading-[1.15]">
            Watch a dispatch run.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-gray-500 md:text-lg">
            This is the operator console. One request, start to settlement.
          </p>
        </div>
        <p className="font-mono text-[11px] tracking-[0.14em] text-gray-400 uppercase">
          Scrub any step below
        </p>
      </Reveal>

      <Reveal delay={0.15} className="mt-12">
        <OperatorConsole />
      </Reveal>
    </Section>
  );
}
