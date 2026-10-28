import { Button } from "./Button";
import { Section } from "./Section";
import { Stagger, StaggerItem, duration } from "@/components/motion";

export function FinalCTA() {
  return (
    <Section>
      <Stagger className="mx-auto max-w-3xl text-center" step={0.1}>
        <StaggerItem
          as="h2"
          kind="blur"
          distance="md"
          duration={duration.cinematic}
          className="text-4xl font-semibold tracking-tight text-ink md:text-6xl md:leading-[1.1]"
        >
          Ready to commit capacity?
        </StaggerItem>

        <StaggerItem
          as="p"
          duration={duration.slow}
          className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-gray-500"
        >
          See the console run on your site. One dispatch, end to end.
        </StaggerItem>

        <StaggerItem className="mt-11 flex flex-wrap items-center justify-center gap-4">
          <Button href="mailto:founders@curtail.ai">Request access</Button>
          <Button
            href="mailto:founders@curtail.ai?subject=Talk%20to%20the%20founders"
            variant="secondary"
          >
            Talk to the founders
          </Button>
        </StaggerItem>

        <StaggerItem
          as="p"
          distance="xs"
          duration={duration.fast}
          className="mt-9 text-sm text-gray-400"
        >
          Or write to{" "}
          <a
            href="mailto:founders@curtail.ai"
            className="text-gray-600 underline decoration-gray-300 underline-offset-4 transition-colors duration-[var(--dur-hover)] ease-[var(--ease-tactile)] hover:text-ink hover:decoration-gray-500"
          >
            founders@curtail.ai
          </a>
        </StaggerItem>
      </Stagger>
    </Section>
  );
}
