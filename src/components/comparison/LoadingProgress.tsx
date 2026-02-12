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
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className={compact ? "text-xs text-slate-600" : "text-sm font-semibold text-slate-700"}>
          {label}
        </p>
        <p
          className={compact ? "text-xs font-semibold text-slate-700" : "text-sm font-semibold text-slate-800"}
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
        className={compact ? "h-2 w-full overflow-hidden rounded-full bg-slate-200" : "h-2.5 w-full overflow-hidden rounded-full bg-slate-200"}
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-teal-600 to-cyan-600 transition-[width] duration-150 ease-out"
          style={{ width: `${normalizedPercent}%` }}
        />
      </div>
    </div>
  );
};
