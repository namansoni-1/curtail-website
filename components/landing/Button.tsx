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
      // Named properties rather than `transition-all`: the browser only has to
      // watch what actually changes, and transform/opacity/box-shadow all
      // composite without touching layout. 220ms sits in the tactile band —
      // 300ms reads as slightly slow for a pointer response.
      className={`group inline-flex h-11 -translate-y-0 items-center justify-center gap-1.5 rounded-full px-6 text-sm font-medium transition-[transform,box-shadow,background-color,border-color] duration-[var(--dur-hover)] ease-[var(--ease-tactile)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] active:duration-[var(--dur-micro)] ${variants[variant]} ${className}`}
    >
      {children}
      <span
        aria-hidden="true"
        className="-ml-0.5 opacity-60 transition-[transform,opacity] duration-[var(--dur-hover)] ease-[var(--ease-tactile)] group-hover:translate-x-0.5 group-hover:opacity-100"
      >
        →
      </span>
    </Link>
  );
}
