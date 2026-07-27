import { Button } from "./Button";
import { Reveal } from "./Reveal";
import { Section } from "./Section";

export function FinalCTA() {
  return (
    <Section>
      <Reveal className="mx-auto max-w-3xl text-center">
        <h2 className="text-4xl font-semibold tracking-tight text-ink md:text-6xl md:leading-[1.1]">
          Ready to commit capacity?
        </h2>
        <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-gray-500">
          See the console run on your site. One dispatch, end to end.
        </p>

        <div className="mt-11 flex flex-wrap items-center justify-center gap-4">
          <Button href="mailto:founders@curtail.ai">Request access</Button>
          <Button
            href="mailto:founders@curtail.ai?subject=Talk%20to%20the%20founders"
            variant="secondary"
          >
            Talk to the founders
          </Button>
        </div>

        <p className="mt-9 text-sm text-gray-400">
          Or write to{" "}
          <a
            href="mailto:founders@curtail.ai"
            className="text-gray-600 underline decoration-gray-300 underline-offset-4 transition-colors hover:text-ink hover:decoration-gray-500"
          >
            founders@curtail.ai
          </a>
        </p>
      </Reveal>
    </Section>
  );
}
