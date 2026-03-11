export type DiffGranularity = "word" | "sentence" | "paragraph";

export type ExtractionFlag = "duplicate" | "malformed" | "unextractable" | "unmatched";

export type ExtractionQuality = {
  visibleChars: number;
  alnumRatio: number;
  symbolRatio: number;
  wordCount: number;
  poor: boolean;
};

export type ExtractionProcessing = {
  mode: "pdf_text" | "ocr";
  ocrAttempted: boolean;
  ocrUsed: boolean;
  ocrReason?: "low_text_quality";
  warnings: string[];
  quality: ExtractionQuality;
};

export type ComparisonProcessing = {
  base: ExtractionProcessing;
  compared: ExtractionProcessing;
  warnings: string[];
};

export type ParagraphRecord = {
  key: string;
  originalLabel: string;
  sectionHeader?: string;
  text: string;
  pageStart: number;
  pageEnd: number;
  extractionFlags: ExtractionFlag[];
};

export type ClauseNode = {
  id: string;
  rawLabel: string;
  parentId?: string;
  level: number;
  textPreserved: string;
  pageStart: number;
  pageEnd: number;
  anchorPage: number;
  anchorY: number;
  synthetic?: boolean;
  sourceLineCount?: number;
};

export type RenderMode = "exact_pdf";

export type PageRange = {
  pageStart: number;
  pageEnd: number;
};

export type SectionPageMap = {
  header: string;
  base?: PageRange;
  compared?: PageRange;
};

export type AnchorPoint = {
  page: number;
  y: number;
};

export type SectionMatchStatus =
  | "matched"
  | "missing_in_base"
  | "missing_in_compared";

export type SectionRecord = {
  header: string;
  normalizedHeader: string;
  status: SectionMatchStatus;
  startParagraph?: string;
  endParagraph?: string;
};

export type SectionCoverage = {
  totalLines: number;
  mappedLines: number;
  unmatchedLines: number;
  percent: number;
};

export type ComparisonRowStatus =
  | "unchanged"
  | "changed"
  | "added"
  | "removed"
  | "ambiguous";

export type SectionAnchor = {
  sectionHeader: string;
  anchorId: string;
  label: string;
  base?: AnchorPoint;
  compared?: AnchorPoint;
  status: ComparisonRowStatus;
  removedSnippet?: string;
  addedSnippet?: string;
};

export type DiffToken = {
  value: string;
  kind: "equal" | "added" | "removed";
};

export type ComparisonRow = {
  key: string;
  labelBase?: string;
  labelCompared?: string;
  displayLabel: string;
  inBase: boolean;
  inCompared: boolean;
  base?: ClauseNode;
  compared?: ClauseNode;
  status: ComparisonRowStatus;
  diffWord: DiffToken[];
  diffSentence: DiffToken[];
  diffParagraph: DiffToken[];
};

export type SectionComparison = {
  header: string;
  status: SectionMatchStatus;
  baseClauses: ClauseNode[];
  comparedClauses: ClauseNode[];
  baseSectionTextPreserved: string;
  comparedSectionTextPreserved: string;
  sectionDiffWord: DiffToken[];
  sectionDiffSentence: DiffToken[];
  sectionDiffParagraph: DiffToken[];
  rows: ComparisonRow[];
  coverage: SectionCoverage;
  coverageBySide: {
    base: SectionCoverage;
    compared: SectionCoverage;
  };
  startParagraph?: string;
  endParagraph?: string;
};

export type ComparisonResult = {
  id: string;
  renderMode: RenderMode;
  baseFileName: string;
  comparedFileName: string;
  expiresAt: string;
  sections: SectionComparison[];
  sectionPageMap: SectionPageMap[];
  sectionAnchors: SectionAnchor[];
  rows: ComparisonRow[];
  selectedSectionDefault?: string;
  extractionIssues: {
    base: ParagraphRecord[];
    compared: ParagraphRecord[];
  };
  processing?: ComparisonProcessing;
  generatedAt: string;
};

export type ExtractedSection = {
  header: string;
  normalizedHeader: string;
  clauses: ClauseNode[];
  coverage: SectionCoverage;
  startParagraph?: string;
  endParagraph?: string;
};

export type ExtractedDocument = {
  sections: ExtractedSection[];
  issues: ParagraphRecord[];
  processing: ExtractionProcessing;
};
