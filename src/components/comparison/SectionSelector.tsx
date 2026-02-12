import clsx from "clsx";
import type { SectionComparison, SectionMatchStatus, DiffToken } from "@/types/comparison";

// Calculate word counts from diff tokens
const calculateWordStats = (tokens: DiffToken[]): { added: number; removed: number } => {
  let added = 0;
  let removed = 0;
  
  for (const token of tokens) {
    if (token.kind === "added") {
      added += token.value.trim().split(/\s+/).filter(Boolean).length;
    } else if (token.kind === "removed") {
      removed += token.value.trim().split(/\s+/).filter(Boolean).length;
    }
  }
  
  return { added, removed };
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
          const wordStats = calculateWordStats(section.sectionDiffWord);
          const hasChanges = wordStats.added > 0 || wordStats.removed > 0;
          
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
              {hasChanges && (
                <span 
                  className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full"
                  style={{ 
                    background: wordStats.removed > 0 
                      ? "var(--color-removed)" 
                      : "var(--color-added)" 
                  }}
                />
              )}
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
          const wordStats = calculateWordStats(section.sectionDiffWord);
          const hasChanges = wordStats.added > 0 || wordStats.removed > 0;

          return (
            <button
              key={`section-${section.header}`}
              type="button"
              onClick={() => onSelect(section.header)}
              className={clsx(
                "group flex items-center justify-between gap-3 rounded-md border p-3 text-left transition",
                selected
                  ? "border-[var(--color-accent)]"
                  : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-bg-secondary)]"
              )}
              style={{
                background: selected ? "var(--color-accent-subtle)" : "transparent",
              }}
            >
              {/* Left: Section name */}
              <p 
                className="truncate text-sm font-medium"
                style={{ 
                  color: selected ? "var(--color-accent)" : "var(--color-text-primary)" 
                }}
              >
                {section.header}
              </p>

              {/* Right: Word stats */}
              <div className="flex shrink-0 items-center gap-2">
                {hasChanges ? (
                  <>
                    {wordStats.removed > 0 && (
                      <span 
                        className="rounded px-1.5 py-0.5 text-xs font-semibold"
                        style={{ 
                          background: "var(--color-removed-bg)",
                          color: "var(--color-removed)"
                        }}
                      >
                        −{wordStats.removed}
                      </span>
                    )}
                    {wordStats.added > 0 && (
                      <span 
                        className="rounded px-1.5 py-0.5 text-xs font-semibold"
                        style={{ 
                          background: "var(--color-added-bg)",
                          color: "var(--color-added)"
                        }}
                      >
                        +{wordStats.added}
                      </span>
                    )}
                  </>
                ) : (
                  <span 
                    className="text-[10px] uppercase tracking-wide"
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    No changes
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
