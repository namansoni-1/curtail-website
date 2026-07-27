import Link from "next/link";
import { Mark } from "./Mark";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#architecture", label: "How it works" },
  { href: "#benefits", label: "Benefits" },
];

export function Navbar() {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-ink/[0.06] bg-paper/75 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <Mark />
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Curtail
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="group relative text-sm text-gray-500 transition-colors duration-200 hover:text-ink"
            >
              {link.label}
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-signal transition-transform duration-300 ease-out group-hover:scale-x-100" />
            </Link>
          ))}
        </div>

        <Link
          href="mailto:founders@curtail.ai"
          className="group flex items-center gap-1.5 text-sm font-medium text-ink transition-opacity hover:opacity-70"
        >
          Request access
          <span
            aria-hidden="true"
            className="transition-transform duration-300 ease-out group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      </nav>
    </header>
  );
}
