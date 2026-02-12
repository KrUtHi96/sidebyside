type LoadingProgressProps = {
  percent: number;
  label: string;
  compact?: boolean;
};

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
};

export const LoadingProgress = ({
  percent,
  label,
  compact = false,
}: LoadingProgressProps) => {
  const normalizedPercent = clampPercent(percent);

  return (
    <div className="w-full">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p 
          className={compact ? "text-xs" : "text-sm font-medium"}
          style={{ color: "var(--color-text-secondary)" }}
        >
          {label}
        </p>
        <p
          className={compact ? "text-xs font-semibold" : "text-sm font-semibold"}
          style={{ color: "var(--color-text-primary)" }}
        >
          {Math.round(normalizedPercent)}%
        </p>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(normalizedPercent)}
        className="h-2 w-full overflow-hidden rounded-full"
        style={{ background: "var(--color-bg-tertiary)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-150 ease-out"
          style={{ 
            width: `${normalizedPercent}%`,
            background: "var(--color-accent)"
          }}
        />
      </div>
    </div>
  );
};
