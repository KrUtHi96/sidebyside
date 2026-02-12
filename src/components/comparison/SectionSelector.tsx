import clsx from "clsx";
import type { SectionComparison, SectionMatchStatus } from "@/types/comparison";

const STATUS_CONFIG: Record<SectionMatchStatus, { bg: string; text: string; label: string; indicator: string }> = {
  matched: {
    bg: "var(--color-added-subtle)",
    text: "var(--color-added)",
    label: "MATCHED SECTION",
    indicator: "var(--color-added)",
  },
  missing_in_base: {
    bg: "var(--color-changed-subtle)",
    text: "var(--color-changed)",
    label: "missing in base",
    indicator: "var(--color-changed)",
  },
  missing_in_compared: {
    bg: "var(--color-removed-subtle)",
    text: "var(--color-removed)",
    label: "missing in compared",
    indicator: "var(--color-removed)",
  },
};

const coverageConfig = (percent: number): { bg: string; text: string } => {
  if (percent >= 99.9) {
    return { bg: "var(--color-added-subtle)", text: "var(--color-added)" };
  }
  if (percent >= 95) {
    return { bg: "var(--color-changed-subtle)", text: "var(--color-changed)" };
  }
  return { bg: "var(--color-removed-subtle)", text: "var(--color-removed)" };
};

const shortLabel = (value: string): string => {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 3).toUpperCase();
  }
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
};

export const SectionSelector = ({
  sections,
  selectedHeader,
  onSelect,
  compact = false,
}: {
  sections: SectionComparison[];
  selectedHeader: string | null;
  onSelect: (header: string) => void;
  compact?: boolean;
}) => {
  if (compact) {
    return (
      <div className="flex flex-col gap-1 p-2">
        {sections.map((section) => {
          const selected = section.header === selectedHeader;
          const status = STATUS_CONFIG[section.status];
          return (
            <button
              key={`section-compact-${section.header}`}
              type="button"
              title={section.header}
              onClick={() => onSelect(section.header)}
              className={clsx(
                "relative mx-auto flex h-9 w-9 items-center justify-center rounded-md text-[11px] font-semibold transition",
                selected
                  ? "text-white"
                  : "text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-secondary)]"
              )}
              style={{
                background: selected ? "var(--color-charcoal)" : "transparent",
              }}
            >
              {shortLabel(section.header)}
              {/* Change indicator dot */}
              <span 
                className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full"
                style={{ background: status.indicator }}
              />
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <div className="flex flex-col gap-1">
        {sections.map((section) => {
          const selected = section.header === selectedHeader;
          const status = STATUS_CONFIG[section.status];
          const coverage = coverageConfig(section.coverage.percent);

          return (
            <button
              key={`section-${section.header}`}
              type="button"
              onClick={() => onSelect(section.header)}
              className={clsx(
                "w-full rounded-md border p-3 text-left transition",
                selected
                  ? "border-[var(--color-accent)]"
                  : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]"
              )}
              style={{
                background: selected ? "var(--color-accent-subtle)" : "transparent",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <p 
                  className="text-sm font-medium"
                  style={{ 
                    color: selected ? "var(--color-accent)" : "var(--color-text-primary)" 
                  }}
                >
                  {section.header}
                </p>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: status.bg,
                    color: status.text,
                  }}
                >
                  {status.label}
                </span>
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{
                    background: coverage.bg,
                    color: coverage.text,
                  }}
                >
                  {section.coverage.percent.toFixed(0)}% COVERAGE
                </span>
              </div>

              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                {section.startParagraph ?? "-"} to {section.endParagraph ?? "-"} • {section.rows.length} clauses
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
};
