import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  getDocument,
  GlobalWorkerOptions,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  ClauseNode,
  ExtractedDocument,
  ExtractedSection,
  ParagraphRecord,
} from "@/types/comparison";
import { normalizeParagraphKey } from "@/lib/utils/paragraphKey";

type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type PageLine = {
  page: number;
  text: string;
  x: number;
  y: number;
  height: number;
  pageHeight: number;
};

const SECTION_HEADERS = [
  "Objective",
  "Scope",
  "Core content",
  "Governance",
  "Strategy",
  "Risk management",
  "Metrics and targets",
];

const ROOT_CLAUSE_REGEX =
  /^(\d+(?:\.\d+)*(?:\([A-Za-z0-9ivxlcdmIVXLCDM]+\))*)[.)]?\s+/;
const MARKER_CLAUSE_REGEX = /^\(([A-Za-z0-9ivxlcdmIVXLCDM]+)\)\s+/;
const ROOT_LABEL_ONLY_REGEX =
  /^(\d+(?:\.\d+)*(?:\([A-Za-z0-9ivxlcdmIVXLCDM]+\))*)[.)]?$/;
const MARKER_LABEL_ONLY_REGEX = /^\(([A-Za-z0-9ivxlcdmIVXLCDM]+)\)$/;
const INVALID_PAGE_REQUEST_PATTERN = /invalid page request/i;
const APPENDIX_HEADER_PREFIX = /^appendix(?:es)?\b/i;
const MIN_ROOT_CLAUSES_BEFORE_APPENDIX_CUTOFF = 3;
const MAX_APPENDIX_HEADER_WORDS = 10;
const MAX_APPENDIX_HEADER_LENGTH = 90;

const Y_BUCKET_TOLERANCE = 2;
const X_GAP_SPACE_THRESHOLD = 1.2;
const INDENT_SPACE_STEP = 8;
const FOOTER_REGION_RATIO = 0.14;
const MAX_REPEAT_FOOTER_LENGTH = 140;
const MIN_REPEAT_SIGNATURE_LENGTH = 12;
const MIN_REPEAT_SIGNATURE_TOKENS = 2;
const PARAGRAPH_GAP_MULTIPLIER = 1.55;
const SUPERSCRIPT_HEIGHT_RATIO = 0.82;
const SUPERSCRIPT_MAX_Y_DELTA = 9;
const SUPERSCRIPT_MAX_LENGTH = 2;

const SUPERSCRIPT_CHAR_MAP: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  "n": "ⁿ",
  "i": "ⁱ",
};

const HEADER_LOOKUP = new Map<string, string>(
  SECTION_HEADERS.map((header) => [header.toLowerCase(), header]),
);

const normalizeHeader = (value: string): string =>
  value.replace(/\s+/g, " ").trim().toLowerCase();

const configurePdfJsWorker = () => {
  const candidatePaths = [
    path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
    path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.mjs"),
  ];

  const resolvedPath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (resolvedPath) {
    GlobalWorkerOptions.workerSrc = pathToFileURL(resolvedPath).href;
  }
};

configurePdfJsWorker();

const isInvalidPageRequestError = (error: unknown): boolean =>
  error instanceof Error && INVALID_PAGE_REQUEST_PATTERN.test(error.message);

const collapseSpaces = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeFooterText = (value: string): string =>
  collapseSpaces(
    value
      .normalize("NFKC")
      .replace(/[‐‑‒–—]/g, "-")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[•·]/g, " "),
  );

const looksLikeClauseLine = (value: string): boolean => {
  const normalized = collapseSpaces(value);
  if (!normalized) {
    return false;
  }

  return (
    /^(\d+(?:\.\d+)*(?:\([A-Za-z0-9ivxlcdmIVXLCDM]+\))*)[.)]?\s+\S+/.test(normalized) ||
    /^\(([A-Za-z0-9ivxlcdmIVXLCDM]+)\)\s+\S+/.test(normalized) ||
    /^(\d+(?:\.\d+)*(?:\([A-Za-z0-9ivxlcdmIVXLCDM]+\))*)[.)]?$/.test(normalized) ||
    /^\(([A-Za-z0-9ivxlcdmIVXLCDM]+)\)$/.test(normalized)
  );
};

const buildFooterSignature = (value: string): string => {
  const normalized = normalizeFooterText(value).toLowerCase();
  if (!normalized) {
    return "";
  }

  const withoutPageTokens = normalized
    .replace(/\bpage\s+\d+(?:\s*(?:of|\/)\s*\d+)?\b/g, " ")
    .replace(/\bp\.?\s*\d+(?:\s*(?:of|\/)\s*\d+)?\b/g, " ")
    .replace(/\b\d+\s*(?:of|\/)\s*\d+\b/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ");

  return collapseSpaces(withoutPageTokens);
};

const isRepeatFooterCandidate = (signature: string): boolean =>
  signature.length >= MIN_REPEAT_SIGNATURE_LENGTH &&
  signature.split(" ").filter(Boolean).length >= MIN_REPEAT_SIGNATURE_TOKENS;

const normalizeInlineToken = (value: string): string =>
  value.replace(/\s+/g, " ").trim();

const shouldAttachWithoutSpace = (current: string, token: string): boolean => {
  if (!current) {
    return true;
  }

  // Keep punctuation and hyphenated words tight.
  if (/^[,.;:!?)\]}%]/.test(token)) {
    return true;
  }

  if (/[-–—/]$/.test(current) || /^[-–—/]/.test(token)) {
    return true;
  }

  if (/[([{]$/.test(current)) {
    return true;
  }

  return false;
};

const isAppendixHeadingLine = (lineText: string): boolean => {
  const normalized = collapseSpaces(lineText);
  if (!normalized) {
    return false;
  }

  if (!APPENDIX_HEADER_PREFIX.test(normalized)) {
    return false;
  }

  if (normalized.length > MAX_APPENDIX_HEADER_LENGTH) {
    return false;
  }

  if (normalized.split(" ").length > MAX_APPENDIX_HEADER_WORDS) {
    return false;
  }

  if (/[.!?]$/.test(normalized)) {
    return false;
  }

  return true;
};

const joinLineFragments = (
  fragments: PositionedText[],
): { text: string; x: number; y: number; height: number } => {
  const sorted = fragments.toSorted((a, b) => a.x - b.x);
  let result = "";
  let previousRightEdge = 0;
  let firstX = sorted[0]?.x ?? 0;
  const y = sorted[0]?.y ?? 0;
  let maxHeight = 0;

  for (const fragment of sorted) {
    const token = normalizeInlineToken(fragment.text);
    if (!token) {
      continue;
    }

    if (!result) {
      firstX = fragment.x;
      result = token;
      previousRightEdge = fragment.x + fragment.width;
      maxHeight = Math.max(maxHeight, fragment.height);
      continue;
    }

    const gap = fragment.x - previousRightEdge;
    if (!shouldAttachWithoutSpace(result, token)) {
      if (gap > X_GAP_SPACE_THRESHOLD) {
        const extraSpaces = Math.max(1, Math.round(gap / 3.4));
        result += " ".repeat(extraSpaces);
      } else if (/[A-Za-z0-9]$/.test(result) && /^[A-Za-z0-9]/.test(token)) {
        result += " ";
      }
    }

    result += token;
    previousRightEdge = fragment.x + fragment.width;
    maxHeight = Math.max(maxHeight, fragment.height);
  }

  return {
    text: result.trim(),
    x: firstX,
    y,
    height: maxHeight,
  };
};

const extractLines = async (buffer: Uint8Array): Promise<PageLine[]> => {
  const loadingTask = getDocument({
    data: buffer,
    useSystemFonts: true,
    disableFontFace: true,
  });

  const document = await loadingTask.promise;
  const allLines: PageLine[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      let page;
      try {
        page = await document.getPage(pageNumber);
      } catch (error) {
        if (isInvalidPageRequestError(error)) {
          break;
        }

        console.warn("Skipping page during PDF extraction.", {
          pageNumber,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      let textContent;
      try {
        textContent = await page.getTextContent();
      } catch (error) {
        console.warn("Skipping text extraction for page.", {
          pageNumber,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
      const viewport = page.getViewport({ scale: 1 });

      const fragments: PositionedText[] = [];
      for (const item of textContent.items) {
        if (!("str" in item) || !("transform" in item) || !("width" in item)) {
          continue;
        }

        const raw = item.str ?? "";
        if (!raw.trim()) {
          continue;
        }

        fragments.push({
          text: raw,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width,
          height: "height" in item && typeof item.height === "number" ? item.height : 0,
        });
      }

      const buckets = new Map<number, PositionedText[]>();
      for (const fragment of fragments) {
        const key = Math.round(fragment.y / Y_BUCKET_TOLERANCE);
        if (!buckets.has(key)) {
          buckets.set(key, []);
        }

        buckets.get(key)?.push(fragment);
      }

      const orderedBuckets = [...buckets.entries()].toSorted((a, b) => b[0] - a[0]);
      for (const [, bucketFragments] of orderedBuckets) {
        const { text, x, y, height } = joinLineFragments(bucketFragments);
        if (!text) {
          continue;
        }

        allLines.push({
          page: pageNumber,
          text,
          x,
          y,
          height,
          pageHeight: viewport.height,
        });
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  return allLines;
};

const isLikelySectionStart = (lines: PageLine[], index: number): boolean => {
  for (let offset = 1; offset <= 20; offset += 1) {
    const line = lines[index + offset];
    if (!line) {
      break;
    }

    if (ROOT_CLAUSE_REGEX.test(line.text) || ROOT_LABEL_ONLY_REGEX.test(line.text.trim())) {
      return true;
    }
  }

  return false;
};

const findSectionBoundaries = (lines: PageLine[]): Array<{ header: string; index: number }> => {
  const discovered = new Map<string, number>();

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const header = HEADER_LOOKUP.get(normalizeHeader(line.text));

    if (!header) {
      continue;
    }

    if (!isLikelySectionStart(lines, index)) {
      continue;
    }

    if (!discovered.has(header)) {
      discovered.set(header, index);
    }
  }

  return [...discovered.entries()]
    .map(([header, index]) => ({ header, index }))
    .toSorted((a, b) => a.index - b.index);
};

const likelyFooterLine = (text: string): boolean => {
  const normalized = normalizeFooterText(text);
  if (!normalized) {
    return false;
  }

  if (/^\d{1,4}$/.test(normalized)) {
    return true;
  }

  if (
    /^(?:page|p\.?)\s*\d+(?:\s*(?:of|\/)\s*\d+)?$/i.test(normalized) ||
    /^\d+\s*(?:of|\/)\s*\d+$/i.test(normalized)
  ) {
    return true;
  }

  return /(?:copyright|all rights reserved|ifrs foundation|issb|ifrs s2|climate-related disclosures|australian accounting standards board|aasb s2|aasb|exposure draft|issued)/i.test(
    normalized,
  );
};

const filterFooterLines = (lines: PageLine[]): PageLine[] => {
  const repeatedBottomSignatures = new Map<string, Set<number>>();

  for (const line of lines) {
    if (line.y > line.pageHeight * FOOTER_REGION_RATIO) {
      continue;
    }

    const normalized = normalizeFooterText(line.text);
    if (!normalized || normalized.length > MAX_REPEAT_FOOTER_LENGTH) {
      continue;
    }

    if (looksLikeClauseLine(normalized)) {
      continue;
    }

    const signature = buildFooterSignature(normalized);
    if (!isRepeatFooterCandidate(signature)) {
      continue;
    }

    if (!repeatedBottomSignatures.has(signature)) {
      repeatedBottomSignatures.set(signature, new Set<number>());
    }

    repeatedBottomSignatures.get(signature)?.add(line.page);
  }

  const repeatedFooterSignatureSet = new Set(
    [...repeatedBottomSignatures.entries()]
      .filter(([, pages]) => pages.size >= 2)
      .map(([signature]) => signature),
  );

  return lines.filter((line) => {
    const inFooterRegion = line.y <= line.pageHeight * FOOTER_REGION_RATIO;
    if (!inFooterRegion) {
      return true;
    }

    const normalized = normalizeFooterText(line.text);
    if (!normalized) {
      return true;
    }

    if (HEADER_LOOKUP.has(normalizeHeader(normalized))) {
      return true;
    }

    if (likelyFooterLine(normalized)) {
      return false;
    }

    if (looksLikeClauseLine(normalized)) {
      return true;
    }

    const signature = buildFooterSignature(normalized);
    if (
      isRepeatFooterCandidate(signature) &&
      repeatedFooterSignatureSet.has(signature)
    ) {
      return false;
    }

    return true;
  });
};

const countRootClausesBefore = (lines: PageLine[], endExclusive: number): number => {
  let count = 0;
  for (let index = 0; index < endExclusive; index += 1) {
    const text = lines[index].text.trim();
    if (ROOT_CLAUSE_REGEX.test(text) || ROOT_LABEL_ONLY_REGEX.test(text)) {
      count += 1;
    }
  }
  return count;
};

const findAppendixStartIndex = (
  lines: PageLine[],
  boundaries: Array<{ header: string; index: number }>,
): number => {
  const lastBoundaryIndex = boundaries[boundaries.length - 1]?.index ?? -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (!isAppendixHeadingLine(lines[index].text)) {
      continue;
    }

    if (lastBoundaryIndex >= 0) {
      if (index <= lastBoundaryIndex) {
        continue;
      }
      return index;
    }

    if (
      countRootClausesBefore(lines, index) >=
      MIN_ROOT_CLAUSES_BEFORE_APPENDIX_CUTOFF
    ) {
      return index;
    }
  }

  return -1;
};

const calculateIndentPrefix = (lineX: number, baseX: number): string => {
  const delta = Math.max(0, lineX - baseX);
  const spaces = Math.max(0, Math.round(delta / INDENT_SPACE_STEP));
  return " ".repeat(Math.min(24, spaces));
};

const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
};

const buildPageSpacingMap = (lines: PageLine[]): Map<number, number> => {
  const deltasByPage = new Map<number, number[]>();

  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    if (previous.page !== current.page) {
      continue;
    }

    const deltaY = previous.y - current.y;
    if (deltaY <= 0 || deltaY > 60) {
      continue;
    }

    if (!deltasByPage.has(current.page)) {
      deltasByPage.set(current.page, []);
    }
    deltasByPage.get(current.page)?.push(deltaY);
  }

  const result = new Map<number, number>();
  for (const [page, values] of deltasByPage.entries()) {
    const value = median(values);
    if (value > 0) {
      result.set(page, value);
    }
  }

  return result;
};

const chooseContinuationSeparator = (
  previousLine: PageLine,
  nextLine: PageLine,
  _clauseBaseX: number,
  pageSpacingMap: Map<number, number>,
): " " | "\n" => {
  if (previousLine.page !== nextLine.page) {
    return "\n";
  }

  const previousText = previousLine.text.trim();
  if (
    ROOT_LABEL_ONLY_REGEX.test(previousText) ||
    MARKER_LABEL_ONLY_REGEX.test(previousText)
  ) {
    return "\n";
  }

  if (ROOT_CLAUSE_REGEX.test(previousText) || MARKER_CLAUSE_REGEX.test(previousText)) {
    return " ";
  }

  const deltaY = previousLine.y - nextLine.y;
  const spacing = pageSpacingMap.get(nextLine.page) ?? 11;
  if (deltaY > spacing * PARAGRAPH_GAP_MULTIPLIER) {
    return "\n";
  }

  if (Math.abs(nextLine.x - previousLine.x) >= INDENT_SPACE_STEP * 1.5) {
    return "\n";
  }

  return " ";
};

const appendLineWithStructure = (
  clause: ClauseNode,
  previousLine: PageLine,
  nextLine: PageLine,
  clauseBaseX: number,
  pageSpacingMap: Map<number, number>,
) => {
  const separator = chooseContinuationSeparator(
    previousLine,
    nextLine,
    clauseBaseX,
    pageSpacingMap,
  );

  if (separator === "\n") {
    const indentPrefix = calculateIndentPrefix(nextLine.x, clauseBaseX);
    clause.textPreserved += `\n${indentPrefix}${nextLine.text}`;
  } else if (/[-‐‑‒–—]$/.test(clause.textPreserved)) {
    clause.textPreserved += nextLine.text;
  } else {
    clause.textPreserved += ` ${nextLine.text}`;
  }

  clause.pageEnd = nextLine.page;
  clause.sourceLineCount = (clause.sourceLineCount ?? 1) + 1;
};

const finalizeClause = (clauses: ClauseNode[], clause: ClauseNode | null) => {
  if (!clause) {
    return;
  }

  clause.textPreserved = clause.textPreserved.trimEnd();
  clauses.push(clause);
};

const isRootStartLine = (text: string): boolean =>
  ROOT_CLAUSE_REGEX.test(text) || ROOT_LABEL_ONLY_REGEX.test(text.trim());

const isMarkerStartLine = (text: string): boolean =>
  MARKER_CLAUSE_REGEX.test(text) || MARKER_LABEL_ONLY_REGEX.test(text.trim());

const isClauseStartLine = (text: string): boolean =>
  isRootStartLine(text) || isMarkerStartLine(text);

const toSuperscript = (value: string): string => {
  const collapsed = value.replace(/\s+/g, "");
  if (!collapsed) {
    return collapsed;
  }

  let converted = "";
  for (const char of collapsed) {
    const mapped = SUPERSCRIPT_CHAR_MAP[char];
    if (!mapped) {
      return `^${collapsed}`;
    }
    converted += mapped;
  }

  return converted;
};

const isSuperscriptCandidate = (
  line: PageLine,
  pageMedianHeight: number,
): boolean => {
  const candidate = line.text.replace(/\s+/g, "");
  if (!candidate || candidate.length > SUPERSCRIPT_MAX_LENGTH) {
    return false;
  }

  if (!/^[0-9()+\-=\sni]+$/i.test(candidate)) {
    return false;
  }

  if (pageMedianHeight <= 0 || line.height <= 0) {
    return false;
  }

  return line.height < pageMedianHeight * SUPERSCRIPT_HEIGHT_RATIO;
};

const attachSuperscripts = (lines: PageLine[]): PageLine[] => {
  const pageHeights = new Map<number, number[]>();
  for (const line of lines) {
    if (line.height <= 0) {
      continue;
    }

    if (!pageHeights.has(line.page)) {
      pageHeights.set(line.page, []);
    }
    pageHeights.get(line.page)?.push(line.height);
  }

  const pageMedianHeights = new Map<number, number>();
  for (const [page, heights] of pageHeights.entries()) {
    const value = median(heights);
    if (value > 0) {
      pageMedianHeights.set(page, value);
    }
  }

  const mutable = lines.map((line) => ({ ...line }));
  const skipIndices = new Set<number>();

  for (let index = 0; index < mutable.length; index += 1) {
    const line = mutable[index];
    const pageMedianHeight = pageMedianHeights.get(line.page) ?? 0;
    if (!isSuperscriptCandidate(line, pageMedianHeight)) {
      continue;
    }

    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    const neighbors = [index - 2, index - 1, index + 1, index + 2];
    for (const neighborIndex of neighbors) {
      const neighbor = mutable[neighborIndex];
      if (!neighbor || neighbor.page !== line.page || skipIndices.has(neighborIndex)) {
        continue;
      }

      if (isSuperscriptCandidate(neighbor, pageMedianHeight)) {
        continue;
      }

      const yDelta = Math.abs(neighbor.y - line.y);
      if (yDelta > SUPERSCRIPT_MAX_Y_DELTA) {
        continue;
      }

      const xBias = Math.abs(line.x - neighbor.x) / 140;
      const score = yDelta + xBias;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = neighborIndex;
      }
    }

    if (bestIndex < 0) {
      continue;
    }

    mutable[bestIndex].text = `${mutable[bestIndex].text}${toSuperscript(line.text)}`;
    skipIndices.add(index);
  }

  return mutable.filter((_, index) => !skipIndices.has(index));
};

type ParsedSectionResult = {
  clauses: ClauseNode[];
  coverage: ExtractedSection["coverage"];
  issues: ParagraphRecord[];
};

const parseSectionClauses = (
  sectionHeader: string,
  sectionLines: PageLine[],
  side: "base" | "compared",
): ParsedSectionResult => {
  const clauses: ClauseNode[] = [];
  const issues: ParagraphRecord[] = [];
  const lineMapped = sectionLines.map(() => false);
  const pageSpacingMap = buildPageSpacingMap(sectionLines);

  let currentClause: ClauseNode | null = null;
  let currentClauseBaseX = 0;
  let currentClauseLastLine: PageLine | null = null;
  let currentRootId: string | null = null;
  let currentLevel2Id: string | null = null;
  let currentLevel3Id: string | null = null;

  let unmatchedLines: PageLine[] = [];
  let unmatchedIndex = 0;

  const flushUnmatched = () => {
    if (unmatchedLines.length === 0) {
      return;
    }

    unmatchedIndex += 1;
    const first = unmatchedLines[0];
    const baseX = first.x;
    const syntheticClause: ClauseNode = {
      id: `__unmatched_${unmatchedIndex}`,
      rawLabel: `Unmatched ${unmatchedIndex}`,
      level: 1,
      textPreserved: first.text,
      pageStart: first.page,
      pageEnd: first.page,
      anchorPage: first.page,
      anchorY: first.y,
      synthetic: true,
      sourceLineCount: 1,
    };

    let previousLine = first;
    for (let offset = 1; offset < unmatchedLines.length; offset += 1) {
      const line = unmatchedLines[offset];
      appendLineWithStructure(
        syntheticClause,
        previousLine,
        line,
        baseX,
        pageSpacingMap,
      );
      previousLine = line;
    }

    finalizeClause(clauses, syntheticClause);
    issues.push(
      toIssueRecord(
        side,
        `${sectionHeader}-unmatched-${unmatchedIndex}`,
        syntheticClause.textPreserved,
        syntheticClause.pageStart,
        "unmatched",
      ),
    );
    unmatchedLines = [];
  };

  const finalizeCurrentClause = () => {
    finalizeClause(clauses, currentClause);
    currentClause = null;
    currentClauseLastLine = null;
  };

  const markMapped = (lineIndex: number) => {
    lineMapped[lineIndex] = true;
  };

  const startClause = (
    clause: ClauseNode,
    line: PageLine,
    lineIndex: number,
  ) => {
    finalizeCurrentClause();
    flushUnmatched();
    currentClause = clause;
    currentClauseBaseX = line.x;
    currentClauseLastLine = line;
    markMapped(lineIndex);
  };

  const appendToCurrentClause = (line: PageLine, lineIndex: number) => {
    if (!currentClause || !currentClauseLastLine) {
      return;
    }

    appendLineWithStructure(
      currentClause,
      currentClauseLastLine,
      line,
      currentClauseBaseX,
      pageSpacingMap,
    );
    currentClauseLastLine = line;
    markMapped(lineIndex);
  };

  for (let index = 0; index < sectionLines.length; index += 1) {
    const line = sectionLines[index];
    const trimmedText = line.text.trim();
    if (!trimmedText) {
      continue;
    }

    const rootMatch = trimmedText.match(ROOT_CLAUSE_REGEX);
    if (rootMatch) {
      const rootLabel = rootMatch[1].trim();
      const rootId = normalizeParagraphKey(rootLabel);
      if (!rootId) {
        unmatchedLines.push(line);
        continue;
      }

      startClause(
        {
          id: rootId,
          rawLabel: rootLabel,
          level: 1,
          textPreserved: line.text,
          pageStart: line.page,
          pageEnd: line.page,
          anchorPage: line.page,
          anchorY: line.y,
          sourceLineCount: 1,
        },
        line,
        index,
      );
      currentRootId = rootId;
      currentLevel2Id = null;
      currentLevel3Id = null;
      continue;
    }

    const rootLabelOnlyMatch = trimmedText.match(ROOT_LABEL_ONLY_REGEX);
    if (rootLabelOnlyMatch) {
      const rootLabel = rootLabelOnlyMatch[1].trim();
      const rootId = normalizeParagraphKey(rootLabel);
      if (!rootId) {
        unmatchedLines.push(line);
        continue;
      }

      startClause(
        {
          id: rootId,
          rawLabel: rootLabel,
          level: 1,
          textPreserved: rootLabel,
          pageStart: line.page,
          pageEnd: line.page,
          anchorPage: line.page,
          anchorY: line.y,
          sourceLineCount: 1,
        },
        line,
        index,
      );
      currentRootId = rootId;
      currentLevel2Id = null;
      currentLevel3Id = null;

      const next = sectionLines[index + 1];
      if (next && !isClauseStartLine(next.text.trim())) {
        appendToCurrentClause(next, index + 1);
        index += 1;
      }
      continue;
    }

    const markerMatch = trimmedText.match(MARKER_CLAUSE_REGEX);
    if (markerMatch && currentRootId) {
      const rawToken = markerMatch[1].trim();
      const normalizedToken = rawToken.toLowerCase();
      const isRoman = /^[ivxlcdm]+$/i.test(rawToken);
      const isNumeric = /^\d+$/.test(rawToken);

      let level = 2;
      let parentId = currentRootId;

      if (currentLevel3Id && isNumeric) {
        level = 4;
        parentId = currentLevel3Id;
      } else if (currentLevel2Id && isRoman) {
        level = 3;
        parentId = currentLevel2Id;
      }

      const id = `${parentId}(${normalizedToken})`;
      startClause(
        {
          id,
          rawLabel: `(${rawToken})`,
          parentId,
          level,
          textPreserved: line.text,
          pageStart: line.page,
          pageEnd: line.page,
          anchorPage: line.page,
          anchorY: line.y,
          sourceLineCount: 1,
        },
        line,
        index,
      );
      if (level === 2) {
        currentLevel2Id = id;
        currentLevel3Id = null;
      } else if (level === 3) {
        currentLevel3Id = id;
      }

      continue;
    }

    const markerLabelOnlyMatch = trimmedText.match(MARKER_LABEL_ONLY_REGEX);
    if (markerLabelOnlyMatch && currentRootId) {
      const rawToken = markerLabelOnlyMatch[1].trim();
      const normalizedToken = rawToken.toLowerCase();
      const isRoman = /^[ivxlcdm]+$/i.test(rawToken);
      const isNumeric = /^\d+$/.test(rawToken);

      let level = 2;
      let parentId = currentRootId;

      if (currentLevel3Id && isNumeric) {
        level = 4;
        parentId = currentLevel3Id;
      } else if (currentLevel2Id && isRoman) {
        level = 3;
        parentId = currentLevel2Id;
      }

      const id = `${parentId}(${normalizedToken})`;
      startClause(
        {
          id,
          rawLabel: `(${rawToken})`,
          parentId,
          level,
          textPreserved: `(${rawToken})`,
          pageStart: line.page,
          pageEnd: line.page,
          anchorPage: line.page,
          anchorY: line.y,
          sourceLineCount: 1,
        },
        line,
        index,
      );
      const next = sectionLines[index + 1];
      if (next && !isClauseStartLine(next.text.trim())) {
        appendToCurrentClause(next, index + 1);
        index += 1;
      }

      if (level === 2) {
        currentLevel2Id = id;
        currentLevel3Id = null;
      } else if (level === 3) {
        currentLevel3Id = id;
      }

      continue;
    }

    if (currentClause) {
      appendToCurrentClause(line, index);
      continue;
    }

    unmatchedLines.push(line);
  }

  finalizeCurrentClause();
  flushUnmatched();

  const mappedLines = lineMapped.filter(Boolean).length;
  const totalLines = sectionLines.length;
  const unmatchedLineCount = Math.max(0, totalLines - mappedLines);

  return {
    clauses,
    coverage: {
      totalLines,
      mappedLines,
      unmatchedLines: unmatchedLineCount,
      percent:
        totalLines === 0
          ? 100
          : Math.round((mappedLines / totalLines) * 1000) / 10,
    },
    issues,
  };
};

const toIssueRecord = (
  side: "base" | "compared",
  key: string,
  text: string,
  page: number,
  flag: ParagraphRecord["extractionFlags"][number],
): ParagraphRecord => ({
  key: `${side}-${key}-${flag}`,
  originalLabel: key,
  text,
  pageStart: page,
  pageEnd: page,
  extractionFlags: [flag],
});

const detectDuplicateClauseIssues = (
  side: "base" | "compared",
  section: ExtractedSection,
): ParagraphRecord[] => {
  const grouped = new Map<string, ClauseNode[]>();

  for (const clause of section.clauses) {
    if (!grouped.has(clause.id)) {
      grouped.set(clause.id, []);
    }
    grouped.get(clause.id)?.push(clause);
  }

  const issues: ParagraphRecord[] = [];
  for (const [clauseId, group] of grouped) {
    if (group.length < 2) {
      continue;
    }

    for (const clause of group) {
      issues.push(
        toIssueRecord(
          side,
          `${section.header}-${clauseId}`,
          clause.textPreserved,
          clause.pageStart,
          "duplicate",
        ),
      );
    }
  }

  return issues;
};

const extractSections = (
  lines: PageLine[],
  side: "base" | "compared",
): { sections: ExtractedSection[]; issues: ParagraphRecord[] } => {
  const boundaries = findSectionBoundaries(lines);
  const appendixStartIndex = findAppendixStartIndex(lines, boundaries);
  const effectiveLines =
    appendixStartIndex >= 0 ? lines.slice(0, appendixStartIndex) : lines;
  const effectiveBoundaries = boundaries.filter(
    (boundary) => boundary.index < effectiveLines.length,
  );

  if (effectiveBoundaries.length === 0) {
    const parsed = parseSectionClauses("Unsectioned", effectiveLines, side);
    return {
      sections: [
        {
          header: "Unsectioned",
          normalizedHeader: normalizeHeader("Unsectioned"),
          clauses: parsed.clauses,
          coverage: parsed.coverage,
          startParagraph: parsed.clauses.find(
            (clause) => clause.level === 1 && !clause.synthetic,
          )?.id,
          endParagraph: [...parsed.clauses]
            .reverse()
            .find((clause) => clause.level === 1 && !clause.synthetic)?.id,
        },
      ],
      issues: parsed.issues,
    };
  }

  const sections: ExtractedSection[] = [];
  const issues: ParagraphRecord[] = [];
  for (let index = 0; index < effectiveBoundaries.length; index += 1) {
    const boundary = effectiveBoundaries[index];
    const next = effectiveBoundaries[index + 1];
    const sectionLines = effectiveLines.slice(
      boundary.index + 1,
      next ? next.index : effectiveLines.length,
    );
    const parsed = parseSectionClauses(boundary.header, sectionLines, side);
    issues.push(...parsed.issues);

    sections.push({
      header: boundary.header,
      normalizedHeader: normalizeHeader(boundary.header),
      clauses: parsed.clauses,
      coverage: parsed.coverage,
      startParagraph: parsed.clauses.find(
        (clause) => clause.level === 1 && !clause.synthetic,
      )?.id,
      endParagraph: [...parsed.clauses]
        .reverse()
        .find((clause) => clause.level === 1 && !clause.synthetic)?.id,
    });
  }

  return {
    sections,
    issues,
  };
};

export const extractDocumentStructure = async (
  buffer: Uint8Array,
  side: "base" | "compared",
): Promise<ExtractedDocument> => {
  const lines = attachSuperscripts(filterFooterLines(await extractLines(buffer)));
  const extracted = extractSections(lines, side);

  const duplicateIssues = extracted.sections.flatMap((section) =>
    detectDuplicateClauseIssues(side, section),
  );

  return {
    sections: extracted.sections,
    issues: [...extracted.issues, ...duplicateIssues],
  };
};
