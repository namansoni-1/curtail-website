type SectionLabelProps = {
  children: string;
  index?: string;
  onDark?: boolean;
};

export function SectionLabel({ children, index, onDark = false }: SectionLabelProps) {
  return (
    <p
      className={`mb-4 inline-flex items-center gap-2 font-mono text-[11px] font-medium tracking-[0.2em] uppercase ${
        onDark ? "text-gray-400" : "text-gray-500"
      }`}
    >
      {index && <span className="text-signal">{index}</span>}
      {children}
    </p>
  );
}
