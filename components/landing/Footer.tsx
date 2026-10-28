import { Mark } from "./Mark";
import { Stagger, StaggerItem, duration } from "@/components/motion";

export function Footer() {
  return (
    <footer className="border-t border-ink/[0.07] px-6 py-12">
      <Stagger className="mx-auto max-w-6xl" step={0.08}>
        <StaggerItem
          as="p"
          distance="xs"
          duration={duration.slow}
          className="text-center text-sm text-gray-400"
        >
          Built with data center operators and University of Chicago power
          systems researchers.
        </StaggerItem>
        <StaggerItem
          distance="xs"
          className="mt-8 flex flex-col items-center justify-between gap-6 border-t border-ink/[0.06] pt-8 md:flex-row"
        >
          <div className="flex items-center gap-2.5">
            <Mark />
            <span className="text-sm font-semibold text-ink">Curtail</span>
          </div>
          <p className="font-mono text-xs tracking-wide text-gray-400">
            &copy; {new Date().getFullYear()} Curtail
          </p>
        </StaggerItem>
      </Stagger>
    </footer>
  );
}
