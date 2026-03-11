"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { LoadingProgress } from "@/components/comparison/LoadingProgress";
import {
  PdfComparePane,
  type PdfHighlightSnippet,
  type PdfJumpTargetWithNonce,
  type PdfSyncViewport,
} from "@/components/comparison/PdfComparePane";
import { RedlineText } from "@/components/comparison/RedlineText";
import { SectionSelector } from "@/components/comparison/SectionSelector";
import type {
  ComparisonResult,
  DiffGranularity,
  DiffToken,
  ParagraphRecord,
} from "@/types/comparison";

const parseApiPayload = async (
  response: Response,
): Promise<{ payload: Record<string, unknown> | null; text: string | null }> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as Record<string, unknown>;
    return { payload, text: null };
  }

  const text = await response.text();
  return { payload: null, text };
};

const toApiError = (
  response: Response,
  payload: Record<string, unknown> | null,
  text: string | null,
): Error => {
  if (payload && typeof payload.error === "string" && payload.error.trim()) {
    return new Error(payload.error);
  }

  if (text && /^<!doctype html/i.test(text.trim())) {
    return new Error(
      `Request failed (${response.status}). API returned HTML instead of JSON.`,
    );
  }

  if (text && text.trim()) {
    return new Error(`Request failed (${response.status}): ${text.slice(0, 220)}`);
  }

  return new Error(`Request failed (${response.status}).`);
};

const formatPageRange = (issue: ParagraphRecord): string =>
  issue.pageStart === issue.pageEnd
    ? `p.${issue.pageStart}`
    : `p.${issue.pageStart}-${issue.pageEnd}`;

const truncateIssueText = (text: string, maxLength = 140): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
};

const formatFlags = (flags: ParagraphRecord["extractionFlags"]): string | null =>
  flags.length > 0 ? flags.join(", ") : null;

type IssueSide = "base" | "compared";
type PdfSide = "base" | "compared";
type TopTab = "matched" | "unmatched";
type CompareViewMode = "text" | "pdf";
type PdfJumpTarget = { page: number; y?: number; source: "section" | "issue" };
type SyncLeader = "base" | "compared" | null;
type IssueDisplayType = "MATCH ISSUE" | "EXTRACTION ISSUE";
type CompactWarningPopoverState = { open: boolean };
type UnmatchedExplorerState = { baseCollapsed: boolean; comparedCollapsed: boolean };
type SectionBucket = "matched_only" | "unmatched_only";

type IssuePairSelection = {
  base?: ParagraphRecord;
  compared?: ParagraphRecord;
};

type LoadingMode = "idle" | "bootstrapping" | "comparing";
type BusyLoadingMode = Exclude<LoadingMode, "idle">;

const UNKNOWN_SECTION_HEADER = "__unknown_section__";

const isIssueCardEligible = (issue: ParagraphRecord): boolean =>
  issue.extractionFlags.includes("unmatched") ||
  issue.extractionFlags.includes("unextractable");

const normalizeSectionDisplayLabel = (header: string): string => {
  if (header === UNKNOWN_SECTION_HEADER) {
    return "Unknown Section";
  }
  return header;
};

const normalizeIssueDisplayLabel = (label: string): string => label;

const resolveIssueDisplayType = (
  issue: ParagraphRecord,
): IssueDisplayType | null => {
  if (issue.extractionFlags.includes("unextractable")) {
    return "EXTRACTION ISSUE";
  }

  if (issue.extractionFlags.includes("unmatched")) {
    return "MATCH ISSUE";
  }

  return null;
};

const normalizeLookup = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

type ResultSection = ComparisonResult["sections"][number];

const resolveIssueSectionHeader = (
  issue: ParagraphRecord,
  sectionHeadersByLength: string[],
): string => {
  if (issue.sectionHeader?.trim()) {
    return issue.sectionHeader.trim();
  }

  const label = issue.originalLabel.trim();
  for (const header of sectionHeadersByLength) {
    if (label === header || label.startsWith(`${header}-`)) {
      return header;
    }
  }

  return UNKNOWN_SECTION_HEADER;
};

const bucketSection = (
  section: ResultSection,
  mixedSectionHeaders: Set<string>,
): SectionBucket =>
  section.status === "matched" && !mixedSectionHeaders.has(section.header)
    ? "matched_only"
    : "unmatched_only";

const resolveSectionBuckets = (
  nextResult: ComparisonResult,
): {
  matchedOnlyHeaders: string[];
  unmatchedOnlyHeaders: string[];
  unmatchedSectionHeaders: string[];
} => {
  const headersByLength = [...nextResult.sections.map((section) => section.header)].sort(
    (left, right) => right.length - left.length,
  );
  const baseIssues = nextResult.extractionIssues.base.filter(isIssueCardEligible);
  const comparedIssues = nextResult.extractionIssues.compared.filter(isIssueCardEligible);
  const issueHeaders = new Set<string>();
  for (const issue of baseIssues) {
    issueHeaders.add(resolveIssueSectionHeader(issue, headersByLength));
  }
  for (const issue of comparedIssues) {
    issueHeaders.add(resolveIssueSectionHeader(issue, headersByLength));
  }

  const mixedSectionHeaders = new Set<string>();
  for (const section of nextResult.sections) {
    if (
      section.coverageBySide.base.unmatchedLines > 0 ||
      section.coverageBySide.compared.unmatchedLines > 0
    ) {
      mixedSectionHeaders.add(section.header);
    }
  }
  for (const issueHeader of issueHeaders) {
    if (issueHeader !== UNKNOWN_SECTION_HEADER) {
      mixedSectionHeaders.add(issueHeader);
    }
  }

  const matchedOnlyHeaders: string[] = [];
  const unmatchedOnlyHeaders: string[] = [];
  for (const section of nextResult.sections) {
    if (bucketSection(section, mixedSectionHeaders) === "matched_only") {
      matchedOnlyHeaders.push(section.header);
    } else {
      unmatchedOnlyHeaders.push(section.header);
    }
  }

  const unmatchedSectionHeaders = [...unmatchedOnlyHeaders];
  const seenUnmatchedHeaders = new Set(unmatchedSectionHeaders);
  for (const issueHeader of issueHeaders) {
    if (seenUnmatchedHeaders.has(issueHeader)) {
      continue;
    }
    unmatchedSectionHeaders.push(issueHeader);
    seenUnmatchedHeaders.add(issueHeader);
  }

  return {
    matchedOnlyHeaders,
    unmatchedOnlyHeaders,
    unmatchedSectionHeaders,
  };
};

const logoStrokeWidth = "1.5";

const LogoIcon = ({ className = "" }: { className?: string }) => (
  <svg
    viewBox="0 0 32 32"
    fill="none"
    className={className}
    stroke="currentColor"
    strokeWidth={logoStrokeWidth}
  >
    <rect x="3" y="4" width="11" height="24" />
    <line x1="7" y1="4" x2="7" y2="28" strokeDasharray="2 2" />
    <line x1="11" y1="4" x2="11" y2="28" strokeDasharray="2 2" />
    <line x1="3" y1="10" x2="14" y2="10" strokeDasharray="2 2" />
    <line x1="3" y1="16" x2="14" y2="16" strokeDasharray="2 2" />
    <line x1="3" y1="22" x2="14" y2="22" strokeDasharray="2 2" />
    <line x1="16" y1="2" x2="16" y2="30" strokeWidth="2" />
    <rect x="18" y="4" width="11" height="24" />
  </svg>
);

export const ComparisonWorkspace = () => {
  const [basePdf, setBasePdf] = useState<File | null>(null);
  const [comparedPdf, setComparedPdf] = useState<File | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [loadingMode, setLoadingMode] = useState<LoadingMode>("idle");
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeTopTab, setActiveTopTab] = useState<TopTab>("matched");
  const [compareViewMode, setCompareViewMode] = useState<CompareViewMode>("text");
  const [diffGranularity, setDiffGranularity] =
    useState<DiffGranularity>("word");
  const [selectedSectionHeader, setSelectedSectionHeader] = useState<string | null>(null);
  const [selectedUnmatchedSectionHeader, setSelectedUnmatchedSectionHeader] =
    useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [selectedIssuePair, setSelectedIssuePair] = useState<IssuePairSelection>({});
  const [warningPopover, setWarningPopover] = useState<CompactWarningPopoverState>({
    open: false,
  });
  const [unmatchedExplorer, setUnmatchedExplorer] =
    useState<UnmatchedExplorerState>({
      baseCollapsed: true,
      comparedCollapsed: true,
    });
  const [matchedPdfJumpTargets, setMatchedPdfJumpTargets] = useState<{
    base: PdfJumpTargetWithNonce | null;
    compared: PdfJumpTargetWithNonce | null;
  }>({
    base: null,
    compared: null,
  });
  const [unmatchedPdfJumpTargets, setUnmatchedPdfJumpTargets] = useState<{
    base: PdfJumpTargetWithNonce | null;
    compared: PdfJumpTargetWithNonce | null;
  }>({
    base: null,
    compared: null,
  });
  const [pdfSyncLeader, setPdfSyncLeader] = useState<SyncLeader>(null);
  const [pdfSyncViewport, setPdfSyncViewport] = useState<PdfSyncViewport | null>(null);

  const didBootstrapDefaults = useRef(false);
  const progressIntervalRef = useRef<number | null>(null);
  const progressCompletionRef = useRef<number | null>(null);
  const baseScrollRef = useRef<HTMLDivElement | null>(null);
  const comparedScrollRef = useRef<HTMLDivElement | null>(null);
  const unmatchedBaseScrollRef = useRef<HTMLDivElement | null>(null);
  const unmatchedComparedScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingFromRef = useRef<"base" | "compared" | null>(null);
  const warningButtonRef = useRef<HTMLButtonElement | null>(null);
  const warningPopoverRef = useRef<HTMLDivElement | null>(null);

  const isBootstrapping = loadingMode === "bootstrapping";
  const isComparing = loadingMode === "comparing";
  const isBusy = loadingMode !== "idle";
  const canCompare = Boolean(basePdf && comparedPdf) && !isBusy;

  const clearProgressTimers = useCallback(() => {
    if (progressIntervalRef.current) {
      window.clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }

    if (progressCompletionRef.current) {
      window.clearTimeout(progressCompletionRef.current);
      progressCompletionRef.current = null;
    }
  }, []);

  const startProgress = useCallback(
    (mode: BusyLoadingMode, label: string) => {
      clearProgressTimers();
      setLoadingMode(mode);
      setProgressLabel(label);
      setProgressPercent(8);

      const cap = 92;
      progressIntervalRef.current = window.setInterval(() => {
        setProgressPercent((previous) => {
          if (previous >= cap) {
            return previous;
          }

          const remaining = cap - previous;
          const step = Math.max(0.4, remaining * 0.14);
          return Math.min(cap, Number((previous + step).toFixed(1)));
        });
      }, 120);
    },
    [clearProgressTimers],
  );

  const completeProgress = useCallback(async () => {
    clearProgressTimers();
    setProgressPercent(100);

    await new Promise<void>((resolve) => {
      progressCompletionRef.current = window.setTimeout(() => {
        setLoadingMode("idle");
        setProgressPercent(0);
        setProgressLabel("");
        progressCompletionRef.current = null;
        resolve();
      }, 250);
    });
  }, [clearProgressTimers]);

  const stopProgress = useCallback(() => {
    clearProgressTimers();
    setLoadingMode("idle");
    setProgressPercent(0);
    setProgressLabel("");
  }, [clearProgressTimers]);

  const sectionHeadersByLength = useMemo(
    () =>
      [...(result?.sections.map((section) => section.header) ?? [])].sort(
        (left, right) => right.length - left.length,
      ),
    [result],
  );

  const baseExtractionIssues = useMemo(() => result?.extractionIssues.base ?? [], [result]);
  const comparedExtractionIssues = useMemo(
    () => result?.extractionIssues.compared ?? [],
    [result],
  );

  const eligibleBaseIssues = useMemo(
    () => baseExtractionIssues.filter(isIssueCardEligible),
    [baseExtractionIssues],
  );
  const eligibleComparedIssues = useMemo(
    () => comparedExtractionIssues.filter(isIssueCardEligible),
    [comparedExtractionIssues],
  );

  const issueHeadersByType = useMemo(() => {
    const baseHeaders = new Set<string>();
    const comparedHeaders = new Set<string>();

    for (const issue of eligibleBaseIssues) {
      baseHeaders.add(resolveIssueSectionHeader(issue, sectionHeadersByLength));
    }
    for (const issue of eligibleComparedIssues) {
      comparedHeaders.add(resolveIssueSectionHeader(issue, sectionHeadersByLength));
    }

    const allHeaders = new Set<string>([...baseHeaders, ...comparedHeaders]);
    return {
      base: [...baseHeaders],
      compared: [...comparedHeaders],
      all: [...allHeaders],
    };
  }, [eligibleBaseIssues, eligibleComparedIssues, sectionHeadersByLength]);

  const mixedSectionHeaders = useMemo(() => {
    const mixed = new Set<string>();
    for (const section of result?.sections ?? []) {
      if (
        section.coverageBySide.base.unmatchedLines > 0 ||
        section.coverageBySide.compared.unmatchedLines > 0
      ) {
        mixed.add(section.header);
      }
    }
    for (const header of issueHeadersByType.all) {
      if (header !== UNKNOWN_SECTION_HEADER) {
        mixed.add(header);
      }
    }
    return mixed;
  }, [issueHeadersByType.all, result]);

  const matchedOnlySections = useMemo(
    () =>
      (result?.sections ?? []).filter(
        (section) => bucketSection(section, mixedSectionHeaders) === "matched_only",
      ),
    [mixedSectionHeaders, result],
  );

  const unmatchedOnlySections = useMemo(
    () =>
      (result?.sections ?? []).filter(
        (section) => bucketSection(section, mixedSectionHeaders) === "unmatched_only",
      ),
    [mixedSectionHeaders, result],
  );

  const unmatchedSectionHeaders = useMemo(() => {
    const headers = unmatchedOnlySections.map((section) => section.header);
    const seen = new Set(headers);
    for (const header of issueHeadersByType.all) {
      if (seen.has(header)) {
        continue;
      }
      headers.push(header);
      seen.add(header);
    }
    return headers;
  }, [issueHeadersByType.all, unmatchedOnlySections]);

  const selectedSection = useMemo(
    () =>
      matchedOnlySections.find((section) => section.header === selectedSectionHeader) ?? null,
    [matchedOnlySections, selectedSectionHeader],
  );
  const selectedUnmatchedSection = useMemo(
    () =>
      unmatchedOnlySections.find(
        (section) => section.header === selectedUnmatchedSectionHeader,
      ) ?? null,
    [selectedUnmatchedSectionHeader, unmatchedOnlySections],
  );

  const sectionTokens = useMemo<DiffToken[]>(
    () => {
      if (!selectedSection) {
        return [];
      }

      if (diffGranularity === "sentence") {
        return selectedSection.sectionDiffSentence;
      }

      if (diffGranularity === "paragraph") {
        return selectedSection.sectionDiffParagraph;
      }

      return selectedSection.sectionDiffWord;
    },
    [diffGranularity, selectedSection],
  );
  const unmatchedSectionTokens = useMemo<DiffToken[]>(
    () => {
      if (!selectedUnmatchedSection) {
        return [];
      }

      if (diffGranularity === "sentence") {
        return selectedUnmatchedSection.sectionDiffSentence;
      }

      if (diffGranularity === "paragraph") {
        return selectedUnmatchedSection.sectionDiffParagraph;
      }

      return selectedUnmatchedSection.sectionDiffWord;
    },
    [diffGranularity, selectedUnmatchedSection],
  );

  const unmatchedSelectableBaseIssues = useMemo(
    () =>
      eligibleBaseIssues.filter((issue) => {
        if (!selectedUnmatchedSectionHeader) {
          return false;
        }
        return (
          resolveIssueSectionHeader(issue, sectionHeadersByLength) ===
          selectedUnmatchedSectionHeader
        );
      }),
    [eligibleBaseIssues, sectionHeadersByLength, selectedUnmatchedSectionHeader],
  );
  const unmatchedSelectableComparedIssues = useMemo(
    () =>
      eligibleComparedIssues.filter((issue) => {
        if (!selectedUnmatchedSectionHeader) {
          return false;
        }
        return (
          resolveIssueSectionHeader(issue, sectionHeadersByLength) ===
          selectedUnmatchedSectionHeader
        );
      }),
    [eligibleComparedIssues, sectionHeadersByLength, selectedUnmatchedSectionHeader],
  );

  const processingWarnings = useMemo(
    () => [...new Set((result?.processing?.warnings ?? []).filter(Boolean))],
    [result],
  );

  const baseOcrUsed = Boolean(result?.processing?.base.ocrUsed);
  const comparedOcrUsed = Boolean(result?.processing?.compared.ocrUsed);

  const ocrUsedSummary = useMemo(() => {
    const sides: string[] = [];
    if (baseOcrUsed) {
      sides.push("base");
    }
    if (comparedOcrUsed) {
      sides.push("compared");
    }
    if (sides.length === 0) {
      return null;
    }

    return `OCR fallback used for ${sides.join(" and ")} document${sides.length > 1 ? "s" : ""}.`;
  }, [baseOcrUsed, comparedOcrUsed]);
  const hasProcessingWarnings =
    Boolean(ocrUsedSummary) || processingWarnings.length > 0;

  const matchedSectionAnchors = useMemo(
    () =>
      selectedSectionHeader
        ? result?.sectionAnchors.filter(
            (anchor) => anchor.sectionHeader === selectedSectionHeader,
          ) ?? []
        : [],
    [result, selectedSectionHeader],
  );
  const unmatchedSectionAnchors = useMemo(
    () =>
      selectedUnmatchedSectionHeader
        ? result?.sectionAnchors.filter(
            (anchor) => anchor.sectionHeader === selectedUnmatchedSectionHeader,
          ) ?? []
        : [],
    [result, selectedUnmatchedSectionHeader],
  );

  const resolveSectionJumpTargets = useCallback(
    (
      header: string,
      source: PdfJumpTarget["source"],
    ): { base: PdfJumpTargetWithNonce; compared: PdfJumpTargetWithNonce } | null => {
      if (!result) {
        return null;
      }

      const sectionPageMap = result.sectionPageMap.find((entry) => entry.header === header);
      const sectionAnchors = result.sectionAnchors.filter(
        (anchor) => anchor.sectionHeader === header,
      );
      const baseAnchor = sectionAnchors.find((anchor) => anchor.base)?.base;
      const comparedAnchor = sectionAnchors.find((anchor) => anchor.compared)?.compared;
      const nonce = Date.now();

      return {
        base: {
          page: baseAnchor?.page ?? sectionPageMap?.base?.pageStart ?? 1,
          y: baseAnchor?.y,
          source,
          nonce,
        },
        compared: {
          page: comparedAnchor?.page ?? sectionPageMap?.compared?.pageStart ?? 1,
          y: comparedAnchor?.y,
          source,
          nonce,
        },
      };
    },
    [result],
  );

  const resolveIssueJumpTargets = useCallback(
    (
      issue: ParagraphRecord,
      side: IssueSide,
    ): { base: PdfJumpTargetWithNonce; compared: PdfJumpTargetWithNonce } | null => {
      if (!result) {
        return null;
      }

      const sectionHeader = resolveIssueSectionHeader(issue, sectionHeadersByLength);
      const sectionPageMap = result.sectionPageMap.find(
        (entry) => entry.header === sectionHeader,
      );
      const sectionAnchors = result.sectionAnchors.filter(
        (anchor) => anchor.sectionHeader === sectionHeader,
      );
      const normalizedIssueLabel = normalizeLookup(issue.originalLabel);
      const matchedByLabel = sectionAnchors.find((anchor) => {
        const normalizedAnchorLabel = normalizeLookup(anchor.label);
        return (
          normalizedAnchorLabel.includes(normalizedIssueLabel) ||
          normalizedIssueLabel.includes(normalizedAnchorLabel)
        );
      });
      const matchedByPage = [...sectionAnchors]
        .filter((anchor) => (side === "base" ? anchor.base : anchor.compared))
        .sort((left, right) => {
          const leftPage = side === "base" ? left.base?.page ?? 1 : left.compared?.page ?? 1;
          const rightPage =
            side === "base" ? right.base?.page ?? 1 : right.compared?.page ?? 1;
          return Math.abs(leftPage - issue.pageStart) - Math.abs(rightPage - issue.pageStart);
        })[0];
      const anchor = matchedByLabel ?? matchedByPage;
      const nonce = Date.now();

      return {
        base: {
          page:
            anchor?.base?.page ??
            (side === "base" ? issue.pageStart : sectionPageMap?.base?.pageStart ?? 1),
          y: anchor?.base?.y,
          source: "issue",
          nonce,
        },
        compared: {
          page:
            anchor?.compared?.page ??
            (side === "compared"
              ? issue.pageStart
              : sectionPageMap?.compared?.pageStart ?? 1),
          y: anchor?.compared?.y,
          source: "issue",
          nonce,
        },
      };
    },
    [result, sectionHeadersByLength],
  );

  const matchedPdfHighlightSnippets = useMemo<Record<PdfSide, PdfHighlightSnippet[]>>(() => {
    const base: PdfHighlightSnippet[] = [];
    const compared: PdfHighlightSnippet[] = [];
    for (const anchor of matchedSectionAnchors) {
      if (anchor.removedSnippet?.trim()) {
        base.push({
          id: `${anchor.anchorId}-removed-base`,
          kind: "removed",
          text: anchor.removedSnippet,
          anchorPage: anchor.base?.page,
          anchorY: anchor.base?.y,
        });
        compared.push({
          id: `${anchor.anchorId}-removed-compared`,
          kind: "removed",
          text: anchor.removedSnippet,
          anchorPage: anchor.compared?.page,
          anchorY: anchor.compared?.y,
        });
      }
      if (anchor.addedSnippet?.trim()) {
        base.push({
          id: `${anchor.anchorId}-added-base`,
          kind: "added",
          text: anchor.addedSnippet,
          anchorPage: anchor.base?.page,
          anchorY: anchor.base?.y,
        });
        compared.push({
          id: `${anchor.anchorId}-added-compared`,
          kind: "added",
          text: anchor.addedSnippet,
          anchorPage: anchor.compared?.page,
          anchorY: anchor.compared?.y,
        });
      }
    }
    return { base, compared };
  }, [matchedSectionAnchors]);

  const unmatchedPdfHighlightSnippets = useMemo<Record<PdfSide, PdfHighlightSnippet[]>>(() => {
    const base: PdfHighlightSnippet[] = [];
    const compared: PdfHighlightSnippet[] = [];
    for (const anchor of unmatchedSectionAnchors) {
      if (anchor.removedSnippet?.trim()) {
        base.push({
          id: `${anchor.anchorId}-removed-base`,
          kind: "removed",
          text: anchor.removedSnippet,
          anchorPage: anchor.base?.page,
          anchorY: anchor.base?.y,
        });
        compared.push({
          id: `${anchor.anchorId}-removed-compared`,
          kind: "removed",
          text: anchor.removedSnippet,
          anchorPage: anchor.compared?.page,
          anchorY: anchor.compared?.y,
        });
      }
      if (anchor.addedSnippet?.trim()) {
        base.push({
          id: `${anchor.anchorId}-added-base`,
          kind: "added",
          text: anchor.addedSnippet,
          anchorPage: anchor.base?.page,
          anchorY: anchor.base?.y,
        });
        compared.push({
          id: `${anchor.anchorId}-added-compared`,
          kind: "added",
          text: anchor.addedSnippet,
          anchorPage: anchor.compared?.page,
          anchorY: anchor.compared?.y,
        });
      }
    }

    if (
      selectedIssuePair.base &&
      resolveIssueSectionHeader(selectedIssuePair.base, sectionHeadersByLength) ===
        selectedUnmatchedSectionHeader
    ) {
      base.push({
        id: `selected-issue-base-${selectedIssuePair.base.key}`,
        kind: "removed",
        text: selectedIssuePair.base.text,
        anchorPage: selectedIssuePair.base.pageStart,
      });
    }

    if (
      selectedIssuePair.compared &&
      resolveIssueSectionHeader(selectedIssuePair.compared, sectionHeadersByLength) ===
        selectedUnmatchedSectionHeader
    ) {
      compared.push({
        id: `selected-issue-compared-${selectedIssuePair.compared.key}`,
        kind: "added",
        text: selectedIssuePair.compared.text,
        anchorPage: selectedIssuePair.compared.pageStart,
      });
    }

    return { base, compared };
  }, [
    sectionHeadersByLength,
    selectedIssuePair.base,
    selectedIssuePair.compared,
    selectedUnmatchedSectionHeader,
    unmatchedSectionAnchors,
  ]);

  const onPdfViewportChange = useCallback(
    (side: PdfSide, viewport: Omit<PdfSyncViewport, "nonce">) => {
      setPdfSyncLeader(side);
      setPdfSyncViewport({
        ...viewport,
        nonce: Date.now(),
      });
    },
    [],
  );

  const assignIssueToPair = useCallback(
    (side: IssueSide, issue: ParagraphRecord) => {
      if (!isIssueCardEligible(issue)) {
        return;
      }

      setSelectedIssuePair((previous) => ({
        ...previous,
        [side]: issue,
      }));

      const nextJumpTargets = resolveIssueJumpTargets(issue, side);
      if (!nextJumpTargets) {
        return;
      }

      if (activeTopTab === "matched") {
        setMatchedPdfJumpTargets(nextJumpTargets);
      } else {
        setUnmatchedPdfJumpTargets(nextJumpTargets);
      }
    },
    [activeTopTab, resolveIssueJumpTargets],
  );

  const loadDefaultComparison = useCallback(async () => {
    setError(null);
    startProgress("bootstrapping", "Loading default comparison...");

    try {
      const response = await fetch("/api/compare/default", {
        method: "GET",
      });
      const { payload, text } = await parseApiPayload(response);
      if (!response.ok) {
        throw toApiError(response, payload, text);
      }

      const nextResult = payload?.result as ComparisonResult;
      if (!nextResult) {
        throw new Error("Default comparison response is missing result payload.");
      }

      const buckets = resolveSectionBuckets(nextResult);
      const nextActiveTab: TopTab =
        buckets.matchedOnlyHeaders.length === 0 &&
        buckets.unmatchedSectionHeaders.length > 0
          ? "unmatched"
          : "matched";

      setResult(nextResult);
      setComparisonId(payload?.comparisonId as string);
      setActiveTopTab(nextActiveTab);
      setSelectedSectionHeader(buckets.matchedOnlyHeaders[0] ?? null);
      setSelectedUnmatchedSectionHeader(buckets.unmatchedSectionHeaders[0] ?? null);
      setSelectedIssuePair({});
      setCompareViewMode("text");
      setDiffGranularity("word");
      setWarningPopover({ open: false });
      setUnmatchedExplorer({ baseCollapsed: true, comparedCollapsed: true });
      setMatchedPdfJumpTargets({ base: null, compared: null });
      setUnmatchedPdfJumpTargets({ base: null, compared: null });
      setPdfSyncLeader(null);
      setPdfSyncViewport(null);
      await completeProgress();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to load default comparison.";
      setError(`${message} Upload PDFs manually to continue.`);
      stopProgress();
    }
  }, [completeProgress, startProgress, stopProgress]);

  const compareFiles = useCallback(async () => {
    if (!basePdf || !comparedPdf) {
      setError("Select both PDFs to compare.");
      return;
    }

    setError(null);
    startProgress("comparing", "Comparing uploaded PDFs...");

    try {
      const formData = new FormData();
      formData.append("basePdf", basePdf);
      formData.append("comparePdf", comparedPdf);

      const response = await fetch("/api/compare", {
        method: "POST",
        body: formData,
      });

      const { payload, text } = await parseApiPayload(response);
      if (!response.ok) {
        throw toApiError(response, payload, text);
      }

      const nextResult = payload?.result as ComparisonResult;
      if (!nextResult) {
        throw new Error("Comparison response is missing result payload.");
      }

      const buckets = resolveSectionBuckets(nextResult);
      const nextActiveTab: TopTab =
        buckets.matchedOnlyHeaders.length === 0 &&
        buckets.unmatchedSectionHeaders.length > 0
          ? "unmatched"
          : "matched";

      setResult(nextResult);
      setComparisonId(payload?.comparisonId as string);
      setActiveTopTab(nextActiveTab);
      setSelectedSectionHeader(buckets.matchedOnlyHeaders[0] ?? null);
      setSelectedUnmatchedSectionHeader(buckets.unmatchedSectionHeaders[0] ?? null);
      setSelectedIssuePair({});
      setCompareViewMode("text");
      setDiffGranularity("word");
      setWarningPopover({ open: false });
      setUnmatchedExplorer({ baseCollapsed: true, comparedCollapsed: true });
      setMatchedPdfJumpTargets({ base: null, compared: null });
      setUnmatchedPdfJumpTargets({ base: null, compared: null });
      setPdfSyncLeader(null);
      setPdfSyncViewport(null);
      await completeProgress();
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Unable to compare files.";
      setError(message);
      stopProgress();
    }
  }, [basePdf, comparedPdf, completeProgress, startProgress, stopProgress]);

  const onSelectPdf = useCallback(
    (side: "base" | "compared", event: ChangeEvent<HTMLInputElement>) => {
      const nextFile = event.target.files?.[0];
      if (!nextFile) {
        return;
      }

      const isPdfByType = nextFile.type === "application/pdf";
      const isPdfByName = /\.pdf$/i.test(nextFile.name);
      if (!isPdfByType && !isPdfByName) {
        setError("Only PDF files are supported.");
        event.target.value = "";
        return;
      }

      setError(null);
      if (side === "base") {
        setBasePdf(nextFile);
        return;
      }

      setComparedPdf(nextFile);
    },
    [],
  );

  useEffect(() => {
    if (didBootstrapDefaults.current) {
      return;
    }

    didBootstrapDefaults.current = true;
    void loadDefaultComparison();
  }, [loadDefaultComparison]);

  useEffect(
    () => () => {
      clearProgressTimers();
    },
    [clearProgressTimers],
  );

  useEffect(() => {
    if (matchedOnlySections.length === 0) {
      setSelectedSectionHeader(null);
      return;
    }

    if (!selectedSectionHeader) {
      setSelectedSectionHeader(matchedOnlySections[0].header);
      return;
    }

    const isSelectedHeaderMatched = matchedOnlySections.some(
      (section) => section.header === selectedSectionHeader,
    );

    if (!isSelectedHeaderMatched) {
      setSelectedSectionHeader(matchedOnlySections[0].header);
    }
  }, [matchedOnlySections, selectedSectionHeader]);

  useEffect(() => {
    if (unmatchedSectionHeaders.length === 0) {
      setSelectedUnmatchedSectionHeader(null);
      return;
    }

    if (
      selectedUnmatchedSectionHeader &&
      !unmatchedSectionHeaders.includes(selectedUnmatchedSectionHeader)
    ) {
      setSelectedUnmatchedSectionHeader(unmatchedSectionHeaders[0]);
    }
  }, [selectedUnmatchedSectionHeader, unmatchedSectionHeaders]);

  useEffect(() => {
    setSelectedIssuePair((previous) => {
      const nextBase =
        previous.base &&
        unmatchedSelectableBaseIssues.some((issue) => issue.key === previous.base?.key)
          ? previous.base
          : undefined;
      const nextCompared =
        previous.compared &&
        unmatchedSelectableComparedIssues.some(
          (issue) => issue.key === previous.compared?.key,
        )
          ? previous.compared
          : undefined;

      if (nextBase === previous.base && nextCompared === previous.compared) {
        return previous;
      }

      return {
        base: nextBase,
        compared: nextCompared,
      };
    });
  }, [unmatchedSelectableBaseIssues, unmatchedSelectableComparedIssues]);

  useEffect(() => {
    if (!selectedSectionHeader) {
      setMatchedPdfJumpTargets({ base: null, compared: null });
      return;
    }

    const next = resolveSectionJumpTargets(selectedSectionHeader, "section");
    setMatchedPdfJumpTargets(next ?? { base: null, compared: null });
  }, [resolveSectionJumpTargets, selectedSectionHeader]);

  useEffect(() => {
    if (!selectedUnmatchedSectionHeader) {
      setUnmatchedPdfJumpTargets({ base: null, compared: null });
      return;
    }

    const next = resolveSectionJumpTargets(selectedUnmatchedSectionHeader, "section");
    setUnmatchedPdfJumpTargets(next ?? { base: null, compared: null });
  }, [resolveSectionJumpTargets, selectedUnmatchedSectionHeader]);

  useEffect(() => {
    setPdfSyncLeader(null);
    setPdfSyncViewport(null);
  }, [activeTopTab, compareViewMode, selectedSectionHeader, selectedUnmatchedSectionHeader]);

  useEffect(() => {
    if (!warningPopover.open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setWarningPopover({ open: false });
        warningButtonRef.current?.focus();
      }
    };

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (warningPopoverRef.current?.contains(target)) {
        return;
      }
      if (warningButtonRef.current?.contains(target)) {
        return;
      }
      setWarningPopover({ open: false });
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [warningPopover.open]);

  useEffect(() => {
    if (warningPopover.open) {
      warningPopoverRef.current?.focus();
    }
  }, [warningPopover.open]);

  const exportPdf = useCallback(() => {
    if (!comparisonId) {
      return;
    }

    window.open(
      `/api/compare/${comparisonId}/export?granularity=word`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [comparisonId]);

  const onSelectSection = useCallback(
    (header: string) => {
      setSelectedSectionHeader(header);
      const nextJumpTargets = resolveSectionJumpTargets(header, "section");
      if (nextJumpTargets) {
        setMatchedPdfJumpTargets(nextJumpTargets);
      }
    },
    [resolveSectionJumpTargets],
  );
  const onToggleUnmatchedSection = useCallback(
    (header: string) => {
      setSelectedUnmatchedSectionHeader((previous) => {
        const next = previous === header ? null : header;
        if (!next) {
          setUnmatchedPdfJumpTargets({ base: null, compared: null });
          return null;
        }
        const nextJumpTargets = resolveSectionJumpTargets(next, "section");
        if (nextJumpTargets) {
          setUnmatchedPdfJumpTargets(nextJumpTargets);
        } else {
          setUnmatchedPdfJumpTargets({ base: null, compared: null });
        }
        return next;
      });
    },
    [resolveSectionJumpTargets],
  );

  const syncScrollPosition = useCallback(
    (source: HTMLDivElement, target: HTMLDivElement, sourceSide: "base" | "compared") => {
      if (syncingFromRef.current && syncingFromRef.current !== sourceSide) {
        return;
      }

      const sourceMaxScroll = source.scrollHeight - source.clientHeight;
      const targetMaxScroll = target.scrollHeight - target.clientHeight;
      const ratio = sourceMaxScroll > 0 ? source.scrollTop / sourceMaxScroll : 0;

      syncingFromRef.current = sourceSide;
      target.scrollTop = ratio * Math.max(0, targetMaxScroll);
      window.requestAnimationFrame(() => {
        if (syncingFromRef.current === sourceSide) {
          syncingFromRef.current = null;
        }
      });
    },
    [],
  );

  const onBaseScroll = useCallback(() => {
    if (syncingFromRef.current === "compared") {
      return;
    }

    const source = baseScrollRef.current;
    const target = comparedScrollRef.current;
    if (!source || !target) {
      return;
    }

    syncScrollPosition(source, target, "base");
  }, [syncScrollPosition]);

  const onComparedScroll = useCallback(() => {
    if (syncingFromRef.current === "base") {
      return;
    }

    const source = comparedScrollRef.current;
    const target = baseScrollRef.current;
    if (!source || !target) {
      return;
    }

    syncScrollPosition(source, target, "compared");
  }, [syncScrollPosition]);

  const onUnmatchedBaseScroll = useCallback(() => {
    if (syncingFromRef.current === "compared") {
      return;
    }

    const source = unmatchedBaseScrollRef.current;
    const target = unmatchedComparedScrollRef.current;
    if (!source || !target) {
      return;
    }

    syncScrollPosition(source, target, "base");
  }, [syncScrollPosition]);

  const onUnmatchedComparedScroll = useCallback(() => {
    if (syncingFromRef.current === "base") {
      return;
    }

    const source = unmatchedComparedScrollRef.current;
    const target = unmatchedBaseScrollRef.current;
    if (!source || !target) {
      return;
    }

    syncScrollPosition(source, target, "compared");
  }, [syncScrollPosition]);

  useEffect(() => {
    const base =
      activeTopTab === "matched"
        ? baseScrollRef.current
        : unmatchedBaseScrollRef.current;
    const compared =
      activeTopTab === "matched"
        ? comparedScrollRef.current
        : unmatchedComparedScrollRef.current;
    if (!base || !compared) {
      return;
    }

    syncingFromRef.current = "base";
    base.scrollTop = 0;
    compared.scrollTop = 0;
    const resetId = window.setTimeout(() => {
      syncingFromRef.current = null;
    }, 0);

    return () => {
      window.clearTimeout(resetId);
      syncingFromRef.current = null;
    };
  }, [
    activeTopTab,
    compareViewMode,
    diffGranularity,
    selectedSectionHeader,
    selectedUnmatchedSectionHeader,
  ]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[var(--color-bg-secondary)]">
      <header
        className="flex h-[var(--header-height)] shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-white px-5"
        style={{ height: 56 }}
      >
        <div className="flex items-center gap-2.5">
          <LogoIcon className="h-5.5 w-5.5 text-[var(--color-charcoal)]" />
          <span className="text-[17px] font-semibold tracking-[-0.3px] text-[var(--color-charcoal)]">
            SideBySide
          </span>
        </div>

        <div className="h-6 w-px bg-[var(--color-border)]" />

        <div className="flex flex-1 items-center gap-2">
          <label
            title="Choose base PDF"
            className={`flex items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-tertiary)] opacity-90 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] ${isBusy ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="font-medium text-[var(--color-text-primary)]">Base PDF</span>
            <span className="max-w-[140px] truncate text-xs">
              {basePdf?.name ?? result?.baseFileName ?? "IFRS base document"}
            </span>
            <input
              className="hidden"
              type="file"
              accept="application/pdf"
              disabled={isBusy}
              onChange={(event) => onSelectPdf("base", event)}
            />
          </label>

          <span className="text-sm text-[var(--color-text-muted)]">vs</span>

          <label
            title="Choose compared PDF"
            className={`flex items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-tertiary)] opacity-90 transition hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] ${isBusy ? "cursor-not-allowed" : "cursor-pointer"}`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="font-medium text-[var(--color-text-primary)]">Compared PDF</span>
            <span className="max-w-[140px] truncate text-xs">
              {comparedPdf?.name ?? result?.comparedFileName ?? "AASB compared document"}
            </span>
            <input
              className="hidden"
              type="file"
              accept="application/pdf"
              disabled={isBusy}
              onChange={(event) => onSelectPdf("compared", event)}
            />
          </label>

          <button
            type="button"
            onClick={compareFiles}
            disabled={!canCompare}
            title={!canCompare ? "Select both PDFs to compare" : undefined}
            className="rounded-md bg-[var(--color-charcoal)] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--color-charcoal-light)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isComparing ? "Comparing..." : "Compare"}
          </button>

          <div className="inline-flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-0.5">
            <button
              type="button"
              onClick={() => setCompareViewMode("text")}
              disabled={!result}
              aria-pressed={compareViewMode === "text"}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                compareViewMode === "text"
                  ? "bg-[var(--color-charcoal)] text-white shadow-sm"
                  : "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              Text
            </button>
            <button
              type="button"
              onClick={() => setCompareViewMode("pdf")}
              disabled={!result}
              aria-pressed={compareViewMode === "pdf"}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                compareViewMode === "pdf"
                  ? "bg-[var(--color-charcoal)] text-white shadow-sm"
                  : "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              PDF
            </button>
          </div>

          <div className="inline-flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-0.5">
            <button
              type="button"
              onClick={() => setActiveTopTab("matched")}
              disabled={!result}
              aria-pressed={activeTopTab === "matched"}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                activeTopTab === "matched"
                  ? "bg-[var(--color-charcoal)] text-white shadow-sm"
                  : "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              Matched
            </button>
            <button
              type="button"
              onClick={() => setActiveTopTab("unmatched")}
              disabled={!result}
              aria-pressed={activeTopTab === "unmatched"}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                activeTopTab === "unmatched"
                  ? "bg-[var(--color-charcoal)] text-white shadow-sm"
                  : "bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              Unmatched
            </button>
          </div>

          <select
            disabled={!result || compareViewMode === "pdf"}
            title="Select inline comparison granularity."
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-tertiary)] disabled:cursor-not-allowed"
            value={diffGranularity}
            onChange={(event) =>
              setDiffGranularity(event.target.value as DiffGranularity)
            }
          >
            <option value="word">Word</option>
            <option value="sentence">Sentence</option>
            <option value="paragraph">All Changes</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={exportPdf}
            disabled={!comparisonId}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-text-secondary)] transition hover:border-[var(--color-charcoal)] hover:bg-[var(--color-bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export PDF
          </button>
        </div>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTopTab === "matched" ? (
          <div className="flex flex-1 overflow-hidden">
            <aside
              className="flex shrink-0 flex-col border-r border-[var(--color-border)] bg-white transition-all duration-300"
              style={{ width: railCollapsed ? 48 : 280 }}
            >
              <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] p-3">
                {!railCollapsed && (
                  <span className="text-xs font-semibold uppercase tracking-[1px] text-[var(--color-charcoal)]">
                    Matched Sections
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setRailCollapsed((value) => !value)}
                  className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-bg-secondary)] text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-tertiary)] hover:text-[var(--color-charcoal)]"
                  title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    style={{ transform: railCollapsed ? "rotate(180deg)" : "none" }}
                  >
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
              </div>

              <SectionSelector
                compact={railCollapsed}
                sections={matchedOnlySections}
                selectedHeader={selectedSectionHeader}
                onSelect={onSelectSection}
              />
            </aside>

            <main className="flex flex-1 flex-col overflow-hidden">
              <div className="flex h-[var(--panel-header-height)] shrink-0 border-b border-[var(--color-border)] bg-white">
                <div className="flex flex-1 items-center gap-3 border-r border-[var(--color-border)] px-6">
                  <span className="rounded bg-[var(--color-bg-secondary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--color-text-tertiary)]">
                    Base
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {result?.baseFileName ?? "No file compared yet"}
                    </span>
                    {baseOcrUsed ? (
                      <span className="rounded bg-[var(--color-accent-subtle)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                        OCR
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-1 items-center gap-3 px-6">
                  <span className="rounded bg-[var(--color-accent-subtle)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--color-accent)]">
                    Compared
                  </span>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                      {result?.comparedFileName ?? "No file compared yet"}
                    </span>
                    {comparedOcrUsed ? (
                      <span className="rounded bg-[var(--color-accent-subtle)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                        OCR
                      </span>
                    ) : null}
                  </div>
                  {hasProcessingWarnings ? (
                    <div className="relative ml-auto">
                      <button
                        ref={warningButtonRef}
                        type="button"
                        aria-expanded={warningPopover.open}
                        aria-controls="comparison-warnings-popover"
                        onClick={() =>
                          setWarningPopover((previous) => ({ open: !previous.open }))
                        }
                        className="h-6 w-6 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[12px] font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-charcoal)]"
                        title="View OCR and processing warnings"
                      >
                        !
                      </button>
                      {warningPopover.open ? (
                        <div
                          id="comparison-warnings-popover"
                          ref={warningPopoverRef}
                          tabIndex={-1}
                          className="absolute right-0 top-8 z-20 w-[min(88vw,420px)] rounded-md border border-[var(--color-border)] bg-white p-3 shadow-lg"
                        >
                          {ocrUsedSummary ? (
                            <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                              {ocrUsedSummary}
                            </p>
                          ) : null}
                          {processingWarnings.length > 0 ? (
                            <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-tertiary)]">
                              {processingWarnings.map((warning, index) => (
                                <li key={`compact-warning-${index}`}>{warning}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-1 overflow-hidden">
                <article className="flex flex-1 flex-col overflow-hidden border-r border-[var(--color-border)] bg-white">
                  <div
                    ref={baseScrollRef}
                    onScroll={compareViewMode === "text" ? onBaseScroll : undefined}
                    className={
                      compareViewMode === "text"
                        ? "flex-1 overflow-y-auto p-8"
                        : "flex-1 overflow-hidden p-3"
                    }
                  >
                    {compareViewMode === "text" ? (
                      selectedSection ? (
                        selectedSection.baseSectionTextPreserved ? (
                          <pre
                            className="whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.8]"
                            style={{ color: "var(--color-text-secondary)" }}
                          >
                            {selectedSection.baseSectionTextPreserved}
                          </pre>
                        ) : (
                          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-tertiary)]">
                            This section is missing in the base document.
                          </div>
                        )
                      ) : matchedOnlySections.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          No fully matched sections.
                        </p>
                      ) : (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          Select a matched section to compare.
                        </p>
                      )
                    ) : selectedSection ? (
                      <PdfComparePane
                        side="base"
                        comparisonId={comparisonId}
                        sectionAnchors={matchedSectionAnchors}
                        highlightSnippets={matchedPdfHighlightSnippets.base}
                        jumpTarget={matchedPdfJumpTargets.base}
                        syncViewport={
                          activeTopTab === "matched" &&
                          compareViewMode === "pdf" &&
                          pdfSyncLeader === "compared"
                            ? pdfSyncViewport
                            : null
                        }
                        onViewportChange={onPdfViewportChange}
                        emptyMessage="Compare files first to render PDFs."
                      />
                    ) : matchedOnlySections.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        No fully matched sections.
                      </p>
                    ) : (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Select a matched section to compare.
                      </p>
                    )}
                  </div>
                </article>

                <article className="flex flex-1 flex-col overflow-hidden bg-white">
                  <div
                    ref={comparedScrollRef}
                    onScroll={compareViewMode === "text" ? onComparedScroll : undefined}
                    className={
                      compareViewMode === "text"
                        ? "flex-1 overflow-y-auto p-8"
                        : "flex-1 overflow-hidden p-3"
                    }
                  >
                    {compareViewMode === "text" ? (
                      selectedSection ? (
                        selectedSection.baseSectionTextPreserved ||
                        selectedSection.comparedSectionTextPreserved ? (
                          <RedlineText tokens={sectionTokens} side="compared" />
                        ) : (
                          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-tertiary)]">
                            This section is missing in the compared document.
                          </div>
                        )
                      ) : matchedOnlySections.length === 0 ? (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          No fully matched sections.
                        </p>
                      ) : (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          Select a matched section to compare.
                        </p>
                      )
                    ) : selectedSection ? (
                      <PdfComparePane
                        side="compared"
                        comparisonId={comparisonId}
                        sectionAnchors={matchedSectionAnchors}
                        highlightSnippets={matchedPdfHighlightSnippets.compared}
                        jumpTarget={matchedPdfJumpTargets.compared}
                        syncViewport={
                          activeTopTab === "matched" &&
                          compareViewMode === "pdf" &&
                          pdfSyncLeader === "base"
                            ? pdfSyncViewport
                            : null
                        }
                        onViewportChange={onPdfViewportChange}
                        emptyMessage="Compare files first to render PDFs."
                      />
                    ) : matchedOnlySections.length === 0 ? (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        No fully matched sections.
                      </p>
                    ) : (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Select a matched section to compare.
                      </p>
                    )}
                  </div>
                </article>
              </div>
            </main>
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex h-[var(--panel-header-height)] shrink-0 border-b border-[var(--color-border)] bg-white">
              <div className="flex flex-1 items-center gap-3 border-r border-[var(--color-border)] px-6">
                <span className="rounded bg-[var(--color-bg-secondary)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--color-text-tertiary)]">
                  Base
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {result?.baseFileName ?? "No file compared yet"}
                  </span>
                  {baseOcrUsed ? (
                    <span className="rounded bg-[var(--color-accent-subtle)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                      OCR
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-1 items-center gap-3 px-6">
                <span className="rounded bg-[var(--color-accent-subtle)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.5px] text-[var(--color-accent)]">
                  Compared
                </span>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                    {result?.comparedFileName ?? "No file compared yet"}
                  </span>
                  {comparedOcrUsed ? (
                    <span className="rounded bg-[var(--color-accent-subtle)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">
                      OCR
                    </span>
                  ) : null}
                </div>
                {hasProcessingWarnings ? (
                  <div className="relative ml-auto">
                    <button
                      ref={warningButtonRef}
                      type="button"
                      aria-expanded={warningPopover.open}
                      aria-controls="comparison-warnings-popover"
                      onClick={() =>
                        setWarningPopover((previous) => ({ open: !previous.open }))
                      }
                      className="h-6 w-6 rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[12px] font-semibold text-[var(--color-text-secondary)] transition hover:border-[var(--color-charcoal)]"
                      title="View OCR and processing warnings"
                    >
                      !
                    </button>
                    {warningPopover.open ? (
                      <div
                        id="comparison-warnings-popover"
                        ref={warningPopoverRef}
                        tabIndex={-1}
                        className="absolute right-0 top-8 z-20 w-[min(88vw,420px)] rounded-md border border-[var(--color-border)] bg-white p-3 shadow-lg"
                      >
                        {ocrUsedSummary ? (
                          <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                            {ocrUsedSummary}
                          </p>
                        ) : null}
                        {processingWarnings.length > 0 ? (
                          <ul className="mt-2 space-y-1 text-xs text-[var(--color-text-tertiary)]">
                            {processingWarnings.map((warning, index) => (
                              <li key={`compact-warning-${index}`}>{warning}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="shrink-0 border-b border-[var(--color-border)] bg-white px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-[var(--color-text-tertiary)]">
                  Unmatched Sections
                </span>
                {unmatchedSectionHeaders.length > 0 ? (
                  <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-1">
                    {unmatchedSectionHeaders.map((header) => {
                      const isSelected = header === selectedUnmatchedSectionHeader;
                      return (
                        <button
                          key={`unmatched-section-pill-${header}`}
                          type="button"
                          onClick={() => onToggleUnmatchedSection(header)}
                          className={`shrink-0 rounded-full border px-2 py-1 text-xs transition ${
                            isSelected
                              ? "border-[var(--color-charcoal)] bg-[var(--color-charcoal)] text-white"
                              : "border-[var(--color-border)] bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)] hover:border-[var(--color-charcoal)]"
                          }`}
                        >
                          {normalizeSectionDisplayLabel(header)}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    No unmatched sections/issues.
                  </span>
                )}
              </div>
            </div>
            <div className="hidden flex-1 gap-2 overflow-hidden p-2 xl:flex">
              {unmatchedExplorer.baseCollapsed ? (
                <section
                  className="flex w-[44px] shrink-0 flex-col items-center justify-between rounded-lg border border-[var(--color-border)] bg-white py-2"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setUnmatchedExplorer((previous) => ({
                        ...previous,
                        baseCollapsed: false,
                      }))
                    }
                    className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-1 text-[11px] text-[var(--color-text-secondary)]"
                    title="Expand base explorer"
                  >
                    &gt;
                  </button>
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
                    style={{ writingMode: "vertical-rl" }}
                  >
                    Base ({unmatchedSelectableBaseIssues.length})
                  </div>
                  <span className="text-[10px] text-[var(--color-text-muted)]">B</span>
                </section>
              ) : (
                <section className="flex min-h-0 w-[min(300px,26vw)] min-w-[220px] max-w-[300px] flex-col rounded-lg border border-[var(--color-border)] bg-white">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">
                      Base Explorer
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setUnmatchedExplorer((previous) => ({
                          ...previous,
                          baseCollapsed: true,
                        }))
                      }
                      className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-1.5 text-[11px] text-[var(--color-text-secondary)]"
                      title="Collapse base explorer"
                    >
                      &lt;
                    </button>
                  </div>
                  <ul className="flex-1 space-y-2 overflow-y-auto p-3">
                    {unmatchedSelectableBaseIssues.length === 0 ? (
                      <li className="text-xs text-[var(--color-text-muted)]">
                        {selectedUnmatchedSectionHeader
                          ? "No issues for this side in selected section."
                          : "Select an unmatched section to view issues."}
                      </li>
                    ) : (
                      unmatchedSelectableBaseIssues.map((issue) => {
                        const flags = formatFlags(issue.extractionFlags);
                        const issueType = resolveIssueDisplayType(issue);
                        const isSelected = selectedIssuePair.base?.key === issue.key;

                        return (
                          <li
                            key={`desktop-base-issue-${issue.key}`}
                            onClick={() => assignIssueToPair("base", issue)}
                            className={`cursor-pointer rounded-md border bg-[var(--color-bg-secondary)] px-3 py-2 transition ${
                              isSelected
                                ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent-subtle)]"
                                : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                                {formatPageRange(issue)} |{" "}
                                {normalizeIssueDisplayLabel(issue.originalLabel)}
                              </p>
                              {issueType ? (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                                    issueType === "EXTRACTION ISSUE"
                                      ? "bg-[var(--color-changed-bg)] text-[var(--color-changed-text)]"
                                      : "bg-[var(--color-removed-bg)] text-[var(--color-removed-text)]"
                                  }`}
                                >
                                  {issueType}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 break-words text-xs text-[var(--color-text-primary)]">
                              {truncateIssueText(issue.text)}
                            </p>
                            {flags ? (
                              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                {flags}
                              </p>
                            ) : null}
                          </li>
                        );
                      })
                    )}
                  </ul>
                </section>
              )}

              <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border border-[var(--color-border)] bg-white">
                <div className="border-b border-[var(--color-border)] px-4 py-2.5">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Compare
                  </p>
                </div>
                <div className="flex min-h-0 flex-1 overflow-hidden">
                  <article className="flex flex-1 flex-col overflow-hidden border-r border-[var(--color-border)] bg-white">
                    <div
                      ref={unmatchedBaseScrollRef}
                      onScroll={
                        compareViewMode === "text" ? onUnmatchedBaseScroll : undefined
                      }
                      className={
                        compareViewMode === "text"
                          ? "flex-1 overflow-y-auto p-8"
                          : "flex-1 overflow-hidden p-3"
                      }
                    >
                      {compareViewMode === "text" ? (
                        selectedUnmatchedSection ? (
                          selectedUnmatchedSection.baseSectionTextPreserved ? (
                            <pre
                              className="whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.8]"
                              style={{ color: "var(--color-text-secondary)" }}
                            >
                              {selectedUnmatchedSection.baseSectionTextPreserved}
                            </pre>
                          ) : (
                            <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-tertiary)]">
                              This section is missing in the base document.
                            </div>
                          )
                        ) : (
                          <p className="text-sm text-[var(--color-text-muted)]">
                            Select an unmatched section to compare full section content.
                          </p>
                        )
                      ) : selectedUnmatchedSection ? (
                        <PdfComparePane
                          side="base"
                          comparisonId={comparisonId}
                          sectionAnchors={unmatchedSectionAnchors}
                          highlightSnippets={unmatchedPdfHighlightSnippets.base}
                          jumpTarget={unmatchedPdfJumpTargets.base}
                          syncViewport={
                            activeTopTab === "unmatched" &&
                            compareViewMode === "pdf" &&
                            pdfSyncLeader === "compared"
                              ? pdfSyncViewport
                              : null
                          }
                          onViewportChange={onPdfViewportChange}
                          emptyMessage="Compare files first to render PDFs."
                        />
                      ) : (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          Select an unmatched section to compare full section content.
                        </p>
                      )}
                    </div>
                  </article>

                  <article className="flex flex-1 flex-col overflow-hidden bg-white">
                    <div
                      ref={unmatchedComparedScrollRef}
                      onScroll={
                        compareViewMode === "text"
                          ? onUnmatchedComparedScroll
                          : undefined
                      }
                      className={
                        compareViewMode === "text"
                          ? "flex-1 overflow-y-auto p-8"
                          : "flex-1 overflow-hidden p-3"
                      }
                    >
                      {compareViewMode === "text" ? (
                        selectedUnmatchedSection ? (
                          selectedUnmatchedSection.baseSectionTextPreserved ||
                          selectedUnmatchedSection.comparedSectionTextPreserved ? (
                            <RedlineText tokens={unmatchedSectionTokens} side="compared" />
                          ) : (
                            <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-tertiary)]">
                              This section is missing in the compared document.
                            </div>
                          )
                        ) : (
                          <p className="text-sm text-[var(--color-text-muted)]">
                            Select an unmatched section to render full section compare output.
                          </p>
                        )
                      ) : selectedUnmatchedSection ? (
                        <PdfComparePane
                          side="compared"
                          comparisonId={comparisonId}
                          sectionAnchors={unmatchedSectionAnchors}
                          highlightSnippets={unmatchedPdfHighlightSnippets.compared}
                          jumpTarget={unmatchedPdfJumpTargets.compared}
                          syncViewport={
                            activeTopTab === "unmatched" &&
                            compareViewMode === "pdf" &&
                            pdfSyncLeader === "base"
                              ? pdfSyncViewport
                              : null
                          }
                          onViewportChange={onPdfViewportChange}
                          emptyMessage="Compare files first to render PDFs."
                        />
                      ) : (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          Select an unmatched section to render full section compare output.
                        </p>
                      )}
                    </div>
                  </article>
                </div>
              </section>

              {unmatchedExplorer.comparedCollapsed ? (
                <section
                  className="flex w-[44px] shrink-0 flex-col items-center justify-between rounded-lg border border-[var(--color-border)] bg-white py-2"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setUnmatchedExplorer((previous) => ({
                        ...previous,
                        comparedCollapsed: false,
                      }))
                    }
                    className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-1 text-[11px] text-[var(--color-text-secondary)]"
                    title="Expand compared explorer"
                  >
                    &lt;
                  </button>
                  <div
                    className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]"
                    style={{ writingMode: "vertical-rl" }}
                  >
                    Compared ({unmatchedSelectableComparedIssues.length})
                  </div>
                  <span className="text-[10px] text-[var(--color-text-muted)]">C</span>
                </section>
              ) : (
                <section className="flex min-h-0 w-[min(300px,26vw)] min-w-[220px] max-w-[300px] flex-col rounded-lg border border-[var(--color-border)] bg-white">
                  <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2.5">
                    <p className="text-xs font-semibold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">
                      Compared Explorer
                    </p>
                    <button
                      type="button"
                      onClick={() =>
                        setUnmatchedExplorer((previous) => ({
                          ...previous,
                          comparedCollapsed: true,
                        }))
                      }
                      className="rounded border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-1.5 text-[11px] text-[var(--color-text-secondary)]"
                      title="Collapse compared explorer"
                    >
                      &gt;
                    </button>
                  </div>
                  <ul className="flex-1 space-y-2 overflow-y-auto p-3">
                    {unmatchedSelectableComparedIssues.length === 0 ? (
                      <li className="text-xs text-[var(--color-text-muted)]">
                        {selectedUnmatchedSectionHeader
                          ? "No issues for this side in selected section."
                          : "Select an unmatched section to view issues."}
                      </li>
                    ) : (
                      unmatchedSelectableComparedIssues.map((issue) => {
                        const flags = formatFlags(issue.extractionFlags);
                        const issueType = resolveIssueDisplayType(issue);
                        const isSelected = selectedIssuePair.compared?.key === issue.key;

                        return (
                          <li
                            key={`desktop-compared-issue-${issue.key}`}
                            onClick={() => assignIssueToPair("compared", issue)}
                            className={`cursor-pointer rounded-md border bg-[var(--color-bg-secondary)] px-3 py-2 transition ${
                              isSelected
                                ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent-subtle)]"
                                : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                                {formatPageRange(issue)} |{" "}
                                {normalizeIssueDisplayLabel(issue.originalLabel)}
                              </p>
                              {issueType ? (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                                    issueType === "EXTRACTION ISSUE"
                                      ? "bg-[var(--color-changed-bg)] text-[var(--color-changed-text)]"
                                      : "bg-[var(--color-removed-bg)] text-[var(--color-removed-text)]"
                                  }`}
                                >
                                  {issueType}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 break-words text-xs text-[var(--color-text-primary)]">
                              {truncateIssueText(issue.text)}
                            </p>
                            {flags ? (
                              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                {flags}
                              </p>
                            ) : null}
                          </li>
                        );
                      })
                    )}
                  </ul>
                </section>
              )}
            </div>

            <div className="flex flex-1 flex-col gap-3 overflow-hidden p-3 xl:hidden">
              <section className="flex min-h-0 flex-1 flex-col rounded-lg border border-[var(--color-border)] bg-white">
                <div className="border-b border-[var(--color-border)] px-4 py-2.5">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Compare
                  </p>
                </div>
                <div className="flex min-h-0 flex-1 overflow-x-auto">
                  <article className="min-w-[320px] flex-1 border-r border-[var(--color-border)] bg-white p-6">
                    {compareViewMode === "text" ? (
                      selectedUnmatchedSection ? (
                        selectedUnmatchedSection.baseSectionTextPreserved ? (
                          <pre
                            className="whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.8]"
                            style={{ color: "var(--color-text-secondary)" }}
                          >
                            {selectedUnmatchedSection.baseSectionTextPreserved}
                          </pre>
                        ) : (
                          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-tertiary)]">
                            This section is missing in the base document.
                          </div>
                        )
                      ) : (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          Select an unmatched section to compare full section content.
                        </p>
                      )
                    ) : selectedUnmatchedSection ? (
                      <div className="min-h-[360px]">
                        <PdfComparePane
                          side="base"
                          comparisonId={comparisonId}
                          sectionAnchors={unmatchedSectionAnchors}
                          highlightSnippets={unmatchedPdfHighlightSnippets.base}
                          jumpTarget={unmatchedPdfJumpTargets.base}
                          syncViewport={
                            activeTopTab === "unmatched" &&
                            compareViewMode === "pdf" &&
                            pdfSyncLeader === "compared"
                              ? pdfSyncViewport
                              : null
                          }
                          onViewportChange={onPdfViewportChange}
                          emptyMessage="Compare files first to render PDFs."
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Select an unmatched section to compare full section content.
                      </p>
                    )}
                  </article>
                  <article className="min-w-[320px] flex-1 bg-white p-6">
                    {compareViewMode === "text" ? (
                      selectedUnmatchedSection ? (
                        selectedUnmatchedSection.baseSectionTextPreserved ||
                        selectedUnmatchedSection.comparedSectionTextPreserved ? (
                          <RedlineText tokens={unmatchedSectionTokens} side="compared" />
                        ) : (
                          <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-tertiary)]">
                            This section is missing in the compared document.
                          </div>
                        )
                      ) : (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          Select an unmatched section to render full section compare output.
                        </p>
                      )
                    ) : selectedUnmatchedSection ? (
                      <div className="min-h-[360px]">
                        <PdfComparePane
                          side="compared"
                          comparisonId={comparisonId}
                          sectionAnchors={unmatchedSectionAnchors}
                          highlightSnippets={unmatchedPdfHighlightSnippets.compared}
                          jumpTarget={unmatchedPdfJumpTargets.compared}
                          syncViewport={
                            activeTopTab === "unmatched" &&
                            compareViewMode === "pdf" &&
                            pdfSyncLeader === "base"
                              ? pdfSyncViewport
                              : null
                          }
                          onViewportChange={onPdfViewportChange}
                          emptyMessage="Compare files first to render PDFs."
                        />
                      </div>
                    ) : (
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Select an unmatched section to render full section compare output.
                      </p>
                    )}
                  </article>
                </div>
              </section>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setUnmatchedExplorer((previous) => ({
                      ...previous,
                      baseCollapsed: !previous.baseCollapsed,
                    }))
                  }
                  className="rounded border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-text-secondary)]"
                >
                  {unmatchedExplorer.baseCollapsed ? "Show" : "Hide"} Base issues (
                  {unmatchedSelectableBaseIssues.length})
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setUnmatchedExplorer((previous) => ({
                      ...previous,
                      comparedCollapsed: !previous.comparedCollapsed,
                    }))
                  }
                  className="rounded border border-[var(--color-border)] bg-white px-3 py-2 text-xs text-[var(--color-text-secondary)]"
                >
                  {unmatchedExplorer.comparedCollapsed ? "Show" : "Hide"} Compared issues (
                  {unmatchedSelectableComparedIssues.length})
                </button>
              </div>

              {!unmatchedExplorer.baseCollapsed ? (
                <section className="rounded-lg border border-[var(--color-border)] bg-white">
                  <div className="border-b border-[var(--color-border)] px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">
                      Base Explorer
                    </p>
                  </div>
                  <ul className="max-h-56 space-y-2 overflow-y-auto p-3">
                    {unmatchedSelectableBaseIssues.length === 0 ? (
                      <li className="text-xs text-[var(--color-text-muted)]">
                        {selectedUnmatchedSectionHeader
                          ? "No issues for this side in selected section."
                          : "Select an unmatched section to view issues."}
                      </li>
                    ) : (
                      unmatchedSelectableBaseIssues.map((issue) => {
                        const flags = formatFlags(issue.extractionFlags);
                        const issueType = resolveIssueDisplayType(issue);
                        const isSelected = selectedIssuePair.base?.key === issue.key;

                        return (
                          <li
                            key={`mobile-base-issue-${issue.key}`}
                            onClick={() => assignIssueToPair("base", issue)}
                            className={`cursor-pointer rounded-md border bg-[var(--color-bg-secondary)] px-3 py-2 transition ${
                              isSelected
                                ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent-subtle)]"
                                : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                                {formatPageRange(issue)} |{" "}
                                {normalizeIssueDisplayLabel(issue.originalLabel)}
                              </p>
                              {issueType ? (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                                    issueType === "EXTRACTION ISSUE"
                                      ? "bg-[var(--color-changed-bg)] text-[var(--color-changed-text)]"
                                      : "bg-[var(--color-removed-bg)] text-[var(--color-removed-text)]"
                                  }`}
                                >
                                  {issueType}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 break-words text-xs text-[var(--color-text-primary)]">
                              {truncateIssueText(issue.text)}
                            </p>
                            {flags ? (
                              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                {flags}
                              </p>
                            ) : null}
                          </li>
                        );
                      })
                    )}
                  </ul>
                </section>
              ) : null}

              {!unmatchedExplorer.comparedCollapsed ? (
                <section className="rounded-lg border border-[var(--color-border)] bg-white">
                  <div className="border-b border-[var(--color-border)] px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.5px] text-[var(--color-text-secondary)]">
                      Compared Explorer
                    </p>
                  </div>
                  <ul className="max-h-56 space-y-2 overflow-y-auto p-3">
                    {unmatchedSelectableComparedIssues.length === 0 ? (
                      <li className="text-xs text-[var(--color-text-muted)]">
                        {selectedUnmatchedSectionHeader
                          ? "No issues for this side in selected section."
                          : "Select an unmatched section to view issues."}
                      </li>
                    ) : (
                      unmatchedSelectableComparedIssues.map((issue) => {
                        const flags = formatFlags(issue.extractionFlags);
                        const issueType = resolveIssueDisplayType(issue);
                        const isSelected = selectedIssuePair.compared?.key === issue.key;

                        return (
                          <li
                            key={`mobile-compared-issue-${issue.key}`}
                            onClick={() => assignIssueToPair("compared", issue)}
                            className={`cursor-pointer rounded-md border bg-[var(--color-bg-secondary)] px-3 py-2 transition ${
                              isSelected
                                ? "border-[var(--color-accent)] ring-1 ring-[var(--color-accent-subtle)]"
                                : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-medium text-[var(--color-text-secondary)]">
                                {formatPageRange(issue)} |{" "}
                                {normalizeIssueDisplayLabel(issue.originalLabel)}
                              </p>
                              {issueType ? (
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${
                                    issueType === "EXTRACTION ISSUE"
                                      ? "bg-[var(--color-changed-bg)] text-[var(--color-changed-text)]"
                                      : "bg-[var(--color-removed-bg)] text-[var(--color-removed-text)]"
                                  }`}
                                >
                                  {issueType}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 break-words text-xs text-[var(--color-text-primary)]">
                              {truncateIssueText(issue.text)}
                            </p>
                            {flags ? (
                              <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                {flags}
                              </p>
                            ) : null}
                          </li>
                        );
                      })
                    )}
                  </ul>
                </section>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {result && (
        <div
          className="fixed bottom-5 left-1/2 flex -translate-x-1/2 gap-5 rounded-lg px-4 py-2.5 text-xs"
          style={{
            background: "var(--color-charcoal)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-added)" }} />
            <span className="text-[var(--color-pure-white)]">Added</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: "var(--color-removed)" }} />
            <span className="text-[var(--color-pure-white)]">Removed</span>
          </div>
        </div>
      )}

      {isBusy ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(45, 45, 45, 0.5)", backdropFilter: "blur(4px)" }}
        >
          <div className="w-[min(92vw,480px)] rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  {isBootstrapping
                    ? "Preparing your comparison workspace"
                    : "Comparing uploaded PDFs"}
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  {isBootstrapping
                    ? "Loading default IFRS vs AASB documents"
                    : "Extracting sections and building redlines (OCR fallback may add time)."}
                </p>
              </div>
            </div>
            <LoadingProgress percent={progressPercent} label={progressLabel} />
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="fixed bottom-5 right-5 max-w-md rounded-lg border border-[var(--color-removed)] bg-[var(--color-removed-bg)] px-4 py-3 text-sm text-[var(--color-removed-text)] shadow-lg">
          {error}
        </div>
      ) : null}
    </div>
  );
};
