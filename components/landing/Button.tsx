import Link from "next/link";
import { type ReactNode } from "react";

type ButtonProps = {
  href: string;
  variant?: "primary" | "secondary" | "inverted";
  children: ReactNode;
  className?: string;
};

const variants = {
  primary:
    "bg-ink text-paper hover:bg-gray-800 shadow-[0_1px_2px_rgba(12,11,10,0.08)] hover:shadow-[0_10px_24px_-10px_rgba(12,11,10,0.45)]",
  secondary:
    "border border-ink/15 bg-transparent text-ink hover:border-ink/30 hover:bg-ink/[0.03]",
  inverted:
    "bg-paper text-ink hover:bg-gray-50 shadow-[0_10px_24px_-10px_rgba(0,0,0,0.5)]",
};

export function Button({
  href,
  variant = "primary",
  children,
  className = "",
}: ButtonProps) {
  return (
    <Link
      href={href}
      className={`group inline-flex h-11 -translate-y-0 items-center justify-center gap-1.5 rounded-full px-6 text-sm font-medium transition-all duration-300 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${variants[variant]} ${className}`}
    >
      {children}
      <span
        aria-hidden="true"
        className="-ml-0.5 opacity-60 transition-all duration-300 ease-out group-hover:translate-x-0.5 group-hover:opacity-100"
      >
        →
      </span>
    </Link>
  );
}
