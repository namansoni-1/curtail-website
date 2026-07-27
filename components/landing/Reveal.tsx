"use client";

import { motion, type Variants } from "framer-motion";
import { type ReactNode } from "react";

const EASE = [0.16, 1, 0.3, 1] as const;

const variantsByKind: Record<"fade" | "blur", Variants> = {
  fade: {
    hidden: { opacity: 0, y: 22 },
    visible: { opacity: 1, y: 0 },
  },
  blur: {
    hidden: { opacity: 0, y: 10, filter: "blur(8px)" },
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
  },
};

type RevealProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  duration?: number;
  variant?: "fade" | "blur";
};

export function Reveal({
  children,
  className,
  delay = 0,
  duration = 0.9,
  variant = "fade",
}: RevealProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-100px" }}
      transition={{ duration, delay, ease: EASE }}
      variants={variantsByKind[variant]}
    >
      {children}
    </motion.div>
  );
}
