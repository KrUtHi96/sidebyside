import {
  buildParagraphDiff,
  buildSentenceDiff,
  buildWordDiff,
} from "@/lib/diff/tokenizeDiff";
import type {
  ClauseNode,
  ComparisonRow,
  DiffToken,
  ExtractedDocument,
  PageRange,
  SectionCoverage,
  SectionAnchor,
  SectionComparison,
  SectionPageMap,
} from "@/types/comparison";

const normalizeHeader = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

const isAppendixSection = (header: string): boolean =>
  normalizeHeader(header).startsWith("appendix");

const groupClausesById = (clauses: ClauseNode[]): Map<string, ClauseNode[]> => {
  const grouped = new Map<string, ClauseNode[]>();

  for (const clause of clauses) {
    if (!grouped.has(clause.id)) {
      grouped.set(clause.id, []);
    }

    grouped.get(clause.id)?.push(clause);
  }

  return grouped;
};

const buildClauseSequence = (
  baseClauses: ClauseNode[],
  comparedClauses: ClauseNode[],
): string[] => {
  const sequence: string[] = [];
  const seen = new Set<string>();

  for (const clause of baseClauses) {
    if (!seen.has(clause.id)) {
      sequence.push(clause.id);
      seen.add(clause.id);
    }
  }

  for (const clause of comparedClauses) {
    if (!seen.has(clause.id)) {
      sequence.push(clause.id);
      seen.add(clause.id);
    }
  }

  return sequence;
};

const isDuplicateGroup = (group: ClauseNode[] | undefined): boolean =>
  !!group && group.length > 1;

const buildDisplayLabel = (
  labelBase: string | undefined,
  labelCompared: string | undefined,
): string => {
  if (labelBase && labelCompared) {
    return labelBase === labelCompared
      ? labelBase
      : `${labelBase} | ${labelCompared}`;
  }

  return labelBase ?? labelCompared ?? "Unknown";
};

const buildAmbiguousRow = (
  key: string,
  baseGroup?: ClauseNode[],
  comparedGroup?: ClauseNode[],
): ComparisonRow => {
  const base = baseGroup?.[0];
  const compared = comparedGroup?.[0];
  const labelBase = base?.rawLabel;
  const labelCompared = compared?.rawLabel;

  return {
    key,
    labelBase,
    labelCompared,
    displayLabel: buildDisplayLabel(labelBase, labelCompared),
    inBase: !!base,
    inCompared: !!compared,
    base,
    compared,
    status: "ambiguous",
    diffWord: [
      {
        value:
          "Unable to compare automatically due to duplicate clause identifiers in one or both sections.",
        kind: "equal",
      },
    ],
    diffSentence: [
      {
        value:
          "Unable to compare automatically due to duplicate clause identifiers in one or both sections.",
        kind: "equal",
      },
    ],
    diffParagraph: [
      {
        value:
          "Unable to compare automatically due to duplicate clause identifiers in one or both sections.",
        kind: "equal",
      },
    ],
  };
};

const buildRowsForSection = (
  baseClauses: ClauseNode[],
  comparedClauses: ClauseNode[],
): ComparisonRow[] => {
  const baseGrouped = groupClausesById(baseClauses);
  const comparedGrouped = groupClausesById(comparedClauses);
  const sequence = buildClauseSequence(baseClauses, comparedClauses);

  return sequence.map((key) => {
    const baseGroup = baseGrouped.get(key);
    const comparedGroup = comparedGrouped.get(key);

    if (isDuplicateGroup(baseGroup) || isDuplicateGroup(comparedGroup)) {
      return buildAmbiguousRow(key, baseGroup, comparedGroup);
    }

    const base = baseGroup?.[0];
    const compared = comparedGroup?.[0];
    const labelBase = base?.rawLabel;
    const labelCompared = compared?.rawLabel;

    if (base && compared) {
      const wordDiff = buildWordDiff(base.textPreserved, compared.textPreserved);
      const sentenceDiff = buildSentenceDiff(base.textPreserved, compared.textPreserved);
      const paragraphDiff = buildParagraphDiff(base.textPreserved, compared.textPreserved);

      return {
        key,
        labelBase,
        labelCompared,
        displayLabel: buildDisplayLabel(labelBase, labelCompared),
        inBase: true,
        inCompared: true,
        base,
        compared,
        status:
          base.textPreserved.trim() === compared.textPreserved.trim()
            ? "unchanged"
            : "changed",
        diffWord: wordDiff,
        diffSentence: sentenceDiff,
        diffParagraph: paragraphDiff,
      };
    }

    if (base && !compared) {
      return {
        key,
        labelBase,
        labelCompared,
        displayLabel: buildDisplayLabel(labelBase, labelCompared),
        inBase: true,
        inCompared: false,
        base,
        status: "removed",
        diffWord: [{ value: base.textPreserved, kind: "removed" }],
        diffSentence: [{ value: base.textPreserved, kind: "removed" }],
        diffParagraph: [{ value: base.textPreserved, kind: "removed" }],
      };
    }

    return {
      key,
      labelBase,
      labelCompared,
      displayLabel: buildDisplayLabel(labelBase, labelCompared),
      inBase: false,
      inCompared: true,
      compared,
      status: "added",
      diffWord: [{ value: compared?.textPreserved ?? "", kind: "added" }],
      diffSentence: [{ value: compared?.textPreserved ?? "", kind: "added" }],
      diffParagraph: [{ value: compared?.textPreserved ?? "", kind: "added" }],
    };
  });
};

const buildSectionText = (clauses: ClauseNode[]): string =>
  clauses.map((clause) => clause.textPreserved).join("\n\n").trim();

const emptyCoverage = (): SectionCoverage => ({
  totalLines: 0,
  mappedLines: 0,
  unmatchedLines: 0,
  percent: 100,
});

const mergeCoverage = (
  base?: SectionCoverage,
  compared?: SectionCoverage,
): SectionCoverage => {
  const totalLines = (base?.totalLines ?? 0) + (compared?.totalLines ?? 0);
  const mappedLines = (base?.mappedLines ?? 0) + (compared?.mappedLines ?? 0);
  const unmatchedLines =
    (base?.unmatchedLines ?? 0) + (compared?.unmatchedLines ?? 0);

  if (totalLines === 0) {
    return emptyCoverage();
  }

  return {
    totalLines,
    mappedLines,
    unmatchedLines,
    percent: Math.round((mappedLines / totalLines) * 1000) / 10,
  };
};

const buildHeaderSequence = (
  baseHeaders: string[],
  comparedHeaders: string[],
): string[] => {
  const sequence: string[] = [];
  const seen = new Set<string>();

  for (const header of baseHeaders) {
    if (!seen.has(header)) {
      sequence.push(header);
      seen.add(header);
    }
  }

  for (const header of comparedHeaders) {
    if (!seen.has(header)) {
      sequence.push(header);
      seen.add(header);
    }
  }

  return sequence;
};

const buildPageRange = (clauses: ClauseNode[]): PageRange | undefined => {
  if (clauses.length === 0) {
    return undefined;
  }

  let pageStart = Number.POSITIVE_INFINITY;
  let pageEnd = Number.NEGATIVE_INFINITY;

  for (const clause of clauses) {
    pageStart = Math.min(pageStart, clause.pageStart);
    pageEnd = Math.max(pageEnd, clause.pageEnd);
  }

  if (!Number.isFinite(pageStart) || !Number.isFinite(pageEnd)) {
    return undefined;
  }

  return {
    pageStart,
    pageEnd,
  };
};

const collapseSpaces = (value: string): string => value.replace(/\s+/g, " ").trim();

const compactSnippet = (value: string, limit = 180): string => {
  const compact = collapseSpaces(value);
  if (compact.length <= limit) {
    return compact;
  }

  return `${compact.slice(0, limit - 1)}…`;
};

const collectDiffSnippet = (
  tokens: DiffToken[],
  kind: DiffToken["kind"],
): string | undefined => {
  const text = tokens
    .filter((token) => token.kind === kind)
    .map((token) => token.value)
    .join(" ");

  const snippet = compactSnippet(text);
  return snippet || undefined;
};

const resolveComparedAnchor = (
  rows: ComparisonRow[],
  index: number,
  fallbackPageRange: PageRange | undefined,
): { page: number; y: number } | undefined => {
  const current = rows[index];
  if (current.compared) {
    return {
      page: current.compared.anchorPage,
      y: current.compared.anchorY,
    };
  }

  for (let distance = 1; distance < rows.length; distance += 1) {
    const prev = rows[index - distance];
    if (prev?.compared) {
      return {
        page: prev.compared.anchorPage,
        y: prev.compared.anchorY,
      };
    }

    const next = rows[index + distance];
    if (next?.compared) {
      return {
        page: next.compared.anchorPage,
        y: next.compared.anchorY,
      };
    }
  }

  if (fallbackPageRange) {
    return {
      page: fallbackPageRange.pageStart,
      y: 780,
    };
  }

  return undefined;
};

const buildSectionAnchors = (
  sectionHeader: string,
  rows: ComparisonRow[],
  comparedRange: PageRange | undefined,
): SectionAnchor[] => {
  return rows.map((row, index) => {
    const removedSnippet =
      row.status === "removed" || row.status === "changed"
        ? collectDiffSnippet(row.diffWord, "removed") ?? compactSnippet(row.base?.textPreserved ?? "")
        : undefined;

    const addedSnippet =
      row.status === "added" || row.status === "changed"
        ? collectDiffSnippet(row.diffWord, "added") ?? compactSnippet(row.compared?.textPreserved ?? "")
        : undefined;

    const comparedAnchor =
      row.inCompared
        ? (row.compared
            ? { page: row.compared.anchorPage, y: row.compared.anchorY }
            : undefined)
        : resolveComparedAnchor(rows, index, comparedRange);

    return {
      sectionHeader,
      anchorId: `${sectionHeader}::${row.key}`,
      label: row.displayLabel,
      base: row.base
        ? {
            page: row.base.anchorPage,
            y: row.base.anchorY,
          }
        : undefined,
      compared: comparedAnchor,
      status: row.status,
      removedSnippet,
      addedSnippet,
    } satisfies SectionAnchor;
  });
};

export const buildSectionComparisons = (
  baseDocument: ExtractedDocument,
  comparedDocument: ExtractedDocument,
): {
  sections: SectionComparison[];
  sectionPageMap: SectionPageMap[];
  sectionAnchors: SectionAnchor[];
  rows: ComparisonRow[];
  selectedSectionDefault?: string;
} => {
  const baseSections = baseDocument.sections.filter(
    (section) => !isAppendixSection(section.header),
  );
  const comparedSections = comparedDocument.sections.filter(
    (section) => !isAppendixSection(section.header),
  );

  const baseByHeader = new Map(
    baseSections.map((section) => [section.header, section]),
  );
  const comparedByHeader = new Map(
    comparedSections.map((section) => [section.header, section]),
  );

  const headers = buildHeaderSequence(
    baseSections.map((section) => section.header),
    comparedSections.map((section) => section.header),
  );

  const builtSections = headers.map((header) => {
    const base = baseByHeader.get(header);
    const compared = comparedByHeader.get(header);

    const status = base && compared
      ? "matched"
      : base
        ? "missing_in_compared"
        : "missing_in_base";

    const baseClauses = base?.clauses ?? [];
    const comparedClauses = compared?.clauses ?? [];

    const baseSectionTextPreserved = buildSectionText(baseClauses);
    const comparedSectionTextPreserved = buildSectionText(comparedClauses);

    return {
      header,
      status,
      baseClauses,
      comparedClauses,
      baseSectionTextPreserved,
      comparedSectionTextPreserved,
      sectionDiffWord: buildWordDiff(baseSectionTextPreserved, comparedSectionTextPreserved),
      sectionDiffSentence: buildSentenceDiff(
        baseSectionTextPreserved,
        comparedSectionTextPreserved,
      ),
      sectionDiffParagraph: buildParagraphDiff(
        baseSectionTextPreserved,
        comparedSectionTextPreserved,
      ),
      rows: buildRowsForSection(baseClauses, comparedClauses),
      coverage: mergeCoverage(base?.coverage, compared?.coverage),
      startParagraph: base?.startParagraph ?? compared?.startParagraph,
      endParagraph: base?.endParagraph ?? compared?.endParagraph,
    } satisfies SectionComparison;
  });

  const sections = builtSections.filter((section) => {
    const hasAnyClause =
      section.baseClauses.length > 0 || section.comparedClauses.length > 0;
    const hasAnyText =
      section.baseSectionTextPreserved.trim().length > 0 ||
      section.comparedSectionTextPreserved.trim().length > 0;
    return hasAnyClause || hasAnyText;
  });

  const sectionPageMap = sections.map((section) => ({
    header: section.header,
    base: buildPageRange(section.baseClauses),
    compared: buildPageRange(section.comparedClauses),
  } satisfies SectionPageMap));

  const sectionAnchors = sections.flatMap((section) => {
    const range = sectionPageMap.find((entry) => entry.header === section.header);
    return buildSectionAnchors(section.header, section.rows, range?.compared);
  });

  const rows = sections.flatMap((section) =>
    section.rows.map((row) => ({
      ...row,
      key: `${section.header}::${row.key}`,
    })),
  );

  const selectedSectionDefault =
    sections.find((section) => section.status === "matched")?.header ?? sections[0]?.header;

  return {
    sections,
    sectionPageMap,
    sectionAnchors,
    rows,
    selectedSectionDefault,
  };
};
