import clsx from "clsx";
import type { SectionComparison, SectionMatchStatus } from "@/types/comparison";

const STATUS_CONFIG: Record<SectionMatchStatus, { bg: string; text: string; label: string; indicator: string }> = {
  matched: {
    bg: "rgba(34, 197, 94, 0.1)",
    text: "#166534",
    label: "Matched Sections",
    indicator: "var(--color-added)",
  },
  missing_in_base: {
    bg: "rgba(245, 158, 11, 0.1)",
    text: "#92400e",
    label: "missing in base",
    indicator: "var(--color-changed)",
  },
  missing_in_compared: {
    bg: "rgba(239, 68, 68, 0.1)",
    text: "#991b1b",
    label: "missing in compared",
    indicator: "var(--color-removed)",
  },
};

const coverageConfig = (percent: number): { bg: string; text: string } => {
  if (percent >= 99.9) {
    return { bg: "rgba(34, 197, 94, 0.1)", text: "#166534" };
  }
  if (percent >= 95) {
    return { bg: "rgba(245, 158, 11, 0.1)", text: "#92400e" };
  }
  return { bg: "rgba(239, 68, 68, 0.1)", text: "#991b1b" };
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
                background: selected ? "var(--color-primary)" : "transparent",
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
                  ? "border-[var(--color-primary)]"
                  : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]"
              )}
              style={{
                background: selected ? "var(--color-primary-subtle)" : "transparent",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <p 
                  className="text-sm font-medium"
                  style={{ 
                    color: selected ? "var(--color-primary)" : "var(--color-text-primary)" 
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
                  {section.coverage.percent.toFixed(0)}% Coverage
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
