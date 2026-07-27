"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useScroll, useSpring } from "framer-motion";
import { ARCHITECTURE_STAGES, ArchitectureField } from "./ArchitectureField";
import { Reveal } from "./Reveal";
import { Section } from "./Section";
import { SectionLabel } from "./SectionLabel";

export function Architecture() {
  const [stage, setStage] = useState(-1);
  const scrubRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: scrubRef,
    offset: ["start start", "end end"],
  });
  const scrollProgress = useSpring(scrollYProgress, {
    stiffness: 220,
    damping: 36,
    mass: 0.6,
  });

  return (
    <Section id="architecture" tone="subtle" className="!py-0">
      <div className="px-6 pt-28 pb-16 text-center md:pt-40">
        <Reveal>
          <SectionLabel index="02">How it works</SectionLabel>
          <h2 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight text-ink md:text-5xl md:leading-[1.15]">
            From grid signal to committed capacity.
          </h2>
        </Reveal>
      </div>

      <div ref={scrubRef} style={{ height: "260vh" }} className="relative">
        <div className="sticky top-0 flex h-screen flex-col items-center justify-center px-6">
          <div className="mb-8 h-9 max-w-xs text-center sm:h-4 sm:max-w-md">
            <AnimatePresence mode="wait">
              {stage >= 0 && (
                <motion.p
                  key={stage}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.4 }}
                  className="font-mono text-xs tracking-[0.14em] text-signal uppercase"
                >
                  {ARCHITECTURE_STAGES[stage]?.text}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="mx-auto w-full max-w-2xl">
            <ArchitectureField onStage={setStage} scrollProgress={scrollProgress} />
          </div>
        </div>
      </div>
    </Section>
  );
}
