import Link from "next/link";
import { Mark } from "@/components/landing/Mark";

export default function ReplayLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b border-ink/[0.07]">
        <nav className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5 transition-opacity hover:opacity-70">
            <Mark />
            <span className="text-[15px] font-semibold tracking-tight text-ink">Curtail</span>
          </Link>
          <Link href="mailto:founders@curtail.ai" className="text-sm font-medium text-ink hover:opacity-70">
            Request access →
          </Link>
        </nav>
      </header>
      {children}
    </>
  );
}
