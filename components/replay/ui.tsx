import { type ButtonHTMLAttributes, type ReactNode } from "react";

export const fmt = {
  mwh: (x: number) =>
    Math.abs(x) < 1
      ? `${(x * 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`
      : `${x.toLocaleString(undefined, { maximumFractionDigits: x < 10 ? 2 : 1 })} MWh`,
  mw: (x: number) =>
    x < 1
      ? `${(x * 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} kW`
      : `${x.toLocaleString(undefined, { maximumFractionDigits: 2 })} MW`,
  kw: (x: number) => `${x.toLocaleString(undefined, { maximumFractionDigits: 1 })} kW`,
  usd: (x: number) =>
    `${x < 0 ? "−" : ""}$${Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
  pct: (x: number) => `${Math.round(x * 100)}%`,
  dt: (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
  date: (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
  label: (s: string) => s.replaceAll("_", " "),
};

export function Card({
  title,
  aside,
  children,
  className = "",
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-ink/10 bg-white/70 p-5 ${className}`}>
      {(title || aside) && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {aside && <div className="text-xs text-gray-500">{aside}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-ink/10 bg-white/70 px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-mono text-xl tracking-tight text-ink tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-gray-500">{sub}</div>}
    </div>
  );
}

export function Btn({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const v = {
    primary: "bg-ink text-paper hover:bg-gray-800 disabled:bg-gray-400",
    secondary: "border border-ink/15 text-ink hover:border-ink/30 hover:bg-ink/[0.03]",
    ghost: "text-gray-600 hover:text-ink hover:bg-ink/[0.04]",
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors duration-[var(--dur-hover)] disabled:cursor-not-allowed ${v} ${className}`}
    />
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "signal" | "warn" | "good" }) {
  const t = {
    neutral: "bg-gray-100 text-gray-700",
    signal: "bg-signal/15 text-signal-dim",
    warn: "bg-[#f6e3c4] text-[#7a4a12]",
    good: "bg-[#dcebdc] text-[#2f5a32]",
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${t}`}>{children}</span>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-xl border border-[#d9a38a] bg-[#fbeee7] px-4 py-3 text-sm text-[#7a2e12]">
      {error}
    </div>
  );
}

export function Table({
  head,
  rows,
  className = "",
}: {
  head: ReactNode[];
  rows: ReactNode[][];
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-b border-ink/10 px-2 py-2 text-xs font-medium whitespace-nowrap text-gray-500">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-ink/5 last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1.5 align-top whitespace-nowrap text-gray-800 tabular-nums">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
