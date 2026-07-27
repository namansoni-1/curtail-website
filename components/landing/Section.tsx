import { type ReactNode } from "react";

type SectionProps = {
  id?: string;
  tone?: "white" | "subtle" | "dark";
  className?: string;
  innerClassName?: string;
  children: ReactNode;
};

const tones = {
  white: "bg-paper border-ink/[0.07]",
  subtle: "bg-gray-50 border-ink/[0.07]",
  dark: "bg-ink border-ink",
};

export function Section({
  id,
  tone = "white",
  className = "",
  innerClassName = "",
  children,
}: SectionProps) {
  return (
    <section
      id={id}
      className={`border-t px-6 py-28 md:py-40 ${tones[tone]} ${className}`}
    >
      <div className={`mx-auto max-w-6xl ${innerClassName}`}>{children}</div>
    </section>
  );
}
