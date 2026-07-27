const CLAIMED = new Set([4, 5]);

/**
 * The wordmark's companion glyph: a fragment of the same fabric used
 * throughout the site — most cells idle, a small bounded pair claimed.
 */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`grid grid-cols-3 gap-[2px] ${className}`}
      aria-hidden="true"
    >
      {Array.from({ length: 9 }).map((_, i) => (
        <span
          key={i}
          className={`h-[3px] w-[3px] ${CLAIMED.has(i) ? "bg-signal" : "bg-ink/20"}`}
        />
      ))}
    </span>
  );
}
