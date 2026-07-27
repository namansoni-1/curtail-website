"use client";

import { motion } from "framer-motion";
import { HeroField } from "./HeroField";
import { Button } from "./Button";

const EASE = [0.16, 1, 0.3, 1] as const;

export function Hero() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-16">
      <div className="absolute inset-0">
        <HeroField />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,transparent_55%,var(--paper)_92%)]" />
      </div>

      <div className="relative z-10 mx-auto max-w-4xl text-center">
        <motion.p
          className="mb-7 font-mono text-[11px] font-medium tracking-[0.2em] text-gray-500 uppercase"
          initial={{ opacity: 0, filter: "blur(4px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 0.9, delay: 0.1, ease: EASE }}
        >
          For multi-tenant data centers
        </motion.p>

        <motion.h1
          className="text-5xl font-semibold tracking-tight text-ink sm:text-6xl md:text-7xl md:leading-[1.05]"
          initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.1, delay: 0.25, ease: EASE }}
        >
          Turn tenant load into
          <br />
          dispatchable grid capacity.
        </motion.h1>

        <motion.p
          className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-gray-500 md:text-lg"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.55, ease: EASE }}
        >
          Curtail turns opted-in tenant load into verified capacity you can
          commit to the grid. No new hardware. No contract changes.
        </motion.p>

        <motion.div
          className="mt-11 flex items-center justify-center"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, delay: 0.75, ease: EASE }}
        >
          <Button href="mailto:founders@curtail.ai">Request access</Button>
        </motion.div>
      </div>

      <motion.div
        className="absolute bottom-10 left-1/2 -translate-x-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1.5, duration: 1 }}
      >
        <div className="flex flex-col items-center gap-2.5">
          <span className="font-mono text-[10px] tracking-[0.25em] text-gray-400 uppercase">
            Scroll
          </span>
          <motion.div
            className="h-7 w-px bg-gradient-to-b from-gray-300 to-transparent"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </motion.div>
    </section>
  );
}
