import clsx from "clsx";
import type { SectionComparison, SectionMatchStatus } from "@/types/comparison";

const STATUS_CLASS: Record<SectionMatchStatus, string> = {
  matched: "bg-emerald-100 text-emerald-800",
  missing_in_base: "bg-amber-100 text-amber-800",
  missing_in_compared: "bg-rose-100 text-rose-800",
};

const STATUS_LABEL: Record<SectionMatchStatus, string> = {
  matched: "matched",
  missing_in_base: "missing in base",
  missing_in_compared: "missing in compared",
};

const coverageClass = (percent: number): string => {
  if (percent >= 99.9) {
    return "bg-emerald-100 text-emerald-800";
  }

  if (percent >= 95) {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-rose-100 text-rose-800";
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
      <div className="space-y-2 p-2">
        {sections.map((section) => {
          const selected = section.header === selectedHeader;
          return (
            <button
              key={`section-compact-${section.header}`}
              type="button"
              title={section.header}
              onClick={() => onSelect(section.header)}
              className={clsx(
                "mx-auto flex h-9 w-9 items-center justify-center rounded-md border text-[11px] font-bold",
                selected
                  ? "border-teal-500 bg-teal-100 text-teal-800"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {shortLabel(section.header)}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      <ul className="space-y-2">
        {sections.map((section) => {
          const selected = section.header === selectedHeader;

          return (
            <li key={`section-${section.header}`}>
              <button
                type="button"
                onClick={() => onSelect(section.header)}
                className={clsx(
                  "w-full rounded-xl border p-3 text-left transition",
                  selected
                    ? "border-teal-500 bg-teal-50 shadow-[0_2px_6px_rgba(13,148,136,0.18)]"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-slate-900">{section.header}</p>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase",
                        STATUS_CLASS[section.status],
                      )}
                    >
                      {STATUS_LABEL[section.status]}
                    </span>
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase",
                        coverageClass(section.coverage.percent),
                      )}
                    >
                      Coverage {section.coverage.percent.toFixed(1)}%
                    </span>
                  </div>
                </div>

                <p className="mt-1 text-xs text-slate-500">
                  {section.startParagraph ?? "-"} to {section.endParagraph ?? "-"} • {section.rows.length} clauses
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
