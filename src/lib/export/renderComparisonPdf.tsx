import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type {
  ComparisonResult,
  DiffGranularity,
  DiffToken,
  SectionComparison,
} from "@/types/comparison";

type RenderComparisonPdfInput = {
  comparison: ComparisonResult;
  granularity: DiffGranularity;
  basePdfPath: string;
  comparedPdfPath: string;
};

type FontKind = "regular" | "bold";

type StyledRun = {
  value: string;
  color: ReturnType<typeof rgb>;
  strike?: boolean;
  font: FontKind;
};

type CursorState = {
  runIndex: number;
  charIndex: number;
};

const PAGE_WIDTH = 1400;
const PAGE_HEIGHT = 900;
const PAGE_MARGIN = 24;
const HEADER_HEIGHT = 56;
const COLUMN_GAP = 18;
const PANEL_HEADER_HEIGHT = 28;
const BODY_PADDING = 10;
const FONT_SIZE = 11.5;
const LINE_HEIGHT = 17;

const COLOR_TEXT = rgb(0.19, 0.24, 0.31);
const COLOR_MUTED = rgb(0.44, 0.5, 0.58);
const COLOR_BORDER = rgb(0.85, 0.89, 0.94);
const COLOR_REMOVED = rgb(0.74, 0.12, 0.12);
const COLOR_ADDED = rgb(0.08, 0.5, 0.24);

const getSectionTokens = (
  section: SectionComparison,
  granularity: DiffGranularity,
): DiffToken[] => {
  if (granularity === "sentence") {
    return section.sectionDiffSentence;
  }

  if (granularity === "paragraph") {
    return section.sectionDiffParagraph;
  }

  return section.sectionDiffWord;
};

const normalizeRunText = (value: string): string =>
  value.replace(/\t/g, "    ").replace(/\r/g, "");

const buildBaseRuns = (value: string): StyledRun[] => [
  {
    value: normalizeRunText(value),
    color: COLOR_TEXT,
    font: "regular",
  },
];

const buildComparedRuns = (tokens: DiffToken[]): StyledRun[] =>
  tokens.map((token) => {
    if (token.kind === "removed") {
      return {
        value: normalizeRunText(token.value),
        color: COLOR_REMOVED,
        strike: true,
        font: "regular",
      } satisfies StyledRun;
    }

    if (token.kind === "added") {
      return {
        value: normalizeRunText(token.value),
        color: COLOR_ADDED,
        font: "bold",
      } satisfies StyledRun;
    }

    return {
      value: normalizeRunText(token.value),
      color: COLOR_TEXT,
      font: "regular",
    } satisfies StyledRun;
  });

const drawPanelFrame = (
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  fileName: string,
  boldFont: PDFFont,
  bodyFont: PDFFont,
) => {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: COLOR_BORDER,
    borderWidth: 0.9,
  });

  page.drawLine({
    start: { x, y: y + height - PANEL_HEADER_HEIGHT },
    end: { x: x + width, y: y + height - PANEL_HEADER_HEIGHT },
    thickness: 0.8,
    color: COLOR_BORDER,
  });

  page.drawText(title, {
    x: x + 8,
    y: y + height - 19,
    font: boldFont,
    size: 10.5,
    color: COLOR_TEXT,
  });
  page.drawText(fileName, {
    x: x + 90,
    y: y + height - 19,
    font: bodyFont,
    size: 9,
    color: COLOR_MUTED,
  });
};

const drawRunSlice = (
  page: PDFPage,
  value: string,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  strike: boolean | undefined,
  x: number,
  y: number,
) => {
  if (!value) {
    return 0;
  }

  page.drawText(value, {
    x,
    y,
    font,
    size: FONT_SIZE,
    color,
  });

  const width = font.widthOfTextAtSize(value, FONT_SIZE);
  if (strike) {
    page.drawLine({
      start: { x, y: y + FONT_SIZE * 0.43 },
      end: { x: x + width, y: y + FONT_SIZE * 0.43 },
      thickness: 0.8,
      color,
    });
  }

  return width;
};

const drawStyledRunsPage = ({
  page,
  runs,
  state,
  x,
  yTop,
  yBottom,
  maxWidth,
  regularFont,
  boldFont,
}: {
  page: PDFPage;
  runs: StyledRun[];
  state: CursorState;
  x: number;
  yTop: number;
  yBottom: number;
  maxWidth: number;
  regularFont: PDFFont;
  boldFont: PDFFont;
}): { state: CursorState; done: boolean } => {
  let cursorX = x;
  let cursorY = yTop;
  let runIndex = state.runIndex;
  let charIndex = state.charIndex;
  const maxX = x + maxWidth;

  while (runIndex < runs.length) {
    const run = runs[runIndex];
    const font = run.font === "bold" ? boldFont : regularFont;

    while (charIndex < run.value.length) {
      const char = run.value[charIndex];

      if (char === "\n") {
        cursorX = x;
        cursorY -= LINE_HEIGHT;
        charIndex += 1;
        if (cursorY < yBottom) {
          return { state: { runIndex, charIndex }, done: false };
        }
        continue;
      }

      const width = font.widthOfTextAtSize(char, FONT_SIZE);
      if (cursorX + width > maxX) {
        cursorX = x;
        cursorY -= LINE_HEIGHT;
        if (cursorY < yBottom) {
          return { state: { runIndex, charIndex }, done: false };
        }

        if (char === " ") {
          charIndex += 1;
          continue;
        }
      }

      drawRunSlice(page, char, font, run.color, run.strike, cursorX, cursorY);
      cursorX += width;
      charIndex += 1;
    }

    runIndex += 1;
    charIndex = 0;
  }

  return { state: { runIndex, charIndex }, done: true };
};

const ensurePanelText = (value: string, fallback: string): string =>
  value.trim().length > 0 ? value : fallback;

export const renderComparisonPdfBuffer = async ({
  comparison,
  granularity,
  basePdfPath,
  comparedPdfPath,
}: RenderComparisonPdfInput): Promise<Buffer> => {
  // Retained in signature for endpoint compatibility with stored-source exports.
  void basePdfPath;
  void comparedPdfPath;

  const output = await PDFDocument.create();
  const [bodyFont, boldFont] = await Promise.all([
    output.embedFont(StandardFonts.TimesRoman),
    output.embedFont(StandardFonts.TimesRomanBold),
  ]);

  if (comparison.sections.length === 0) {
    const page = output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawText("Framework Comparison Report", {
      x: PAGE_MARGIN,
      y: PAGE_HEIGHT - PAGE_MARGIN - 24,
      font: boldFont,
      size: 16,
      color: COLOR_TEXT,
    });
    page.drawText("No comparable sections available.", {
      x: PAGE_MARGIN,
      y: PAGE_HEIGHT - PAGE_MARGIN - 44,
      font: boldFont,
      size: 13,
      color: COLOR_TEXT,
    });
    page.drawText(`Generated ${new Date(comparison.generatedAt).toLocaleString()}`, {
      x: PAGE_MARGIN,
      y: PAGE_HEIGHT - PAGE_MARGIN - 62,
      font: bodyFont,
      size: 10,
      color: COLOR_MUTED,
    });
  }

  for (const section of comparison.sections) {
    const sectionLabel = section.header;
    const baseText = ensurePanelText(
      section.baseSectionTextPreserved,
      "This section is missing in the base document.",
    );
    const comparedTokens = getSectionTokens(section, granularity);
    const comparedHasText = comparedTokens.some((token) => token.value.trim().length > 0);
    const comparedRuns = comparedHasText
      ? buildComparedRuns(comparedTokens)
      : buildComparedRuns([
          {
            kind: "equal",
            value: "This section is missing in the compared document.",
          },
        ]);
    const baseRuns = buildBaseRuns(baseText);

    let baseState: CursorState = { runIndex: 0, charIndex: 0 };
    let comparedState: CursorState = { runIndex: 0, charIndex: 0 };
    let pagePart = 1;

    while (true) {
      const page = output.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

      const columnWidth = (PAGE_WIDTH - PAGE_MARGIN * 2 - COLUMN_GAP) / 2;
      const panelHeight = PAGE_HEIGHT - PAGE_MARGIN * 2 - HEADER_HEIGHT;
      const panelY = PAGE_MARGIN;
      const baseX = PAGE_MARGIN;
      const comparedX = PAGE_MARGIN + columnWidth + COLUMN_GAP;

      page.drawText("Framework Comparison Report", {
        x: PAGE_MARGIN,
        y: PAGE_HEIGHT - PAGE_MARGIN - 18,
        font: boldFont,
        size: 14,
        color: COLOR_TEXT,
      });
      page.drawText(
        pagePart === 1 ? sectionLabel : `${sectionLabel} (cont. ${pagePart})`,
        {
          x: PAGE_MARGIN,
          y: PAGE_HEIGHT - PAGE_MARGIN - 37,
          font: boldFont,
          size: 16,
          color: COLOR_TEXT,
        },
      );
      page.drawText(`Generated ${new Date(comparison.generatedAt).toLocaleString()}`, {
        x: PAGE_MARGIN,
        y: PAGE_HEIGHT - PAGE_MARGIN - 55,
        font: bodyFont,
        size: 9.5,
        color: COLOR_MUTED,
      });

      drawPanelFrame(
        page,
        baseX,
        panelY,
        columnWidth,
        panelHeight,
        "Base Framework",
        comparison.baseFileName,
        boldFont,
        bodyFont,
      );
      drawPanelFrame(
        page,
        comparedX,
        panelY,
        columnWidth,
        panelHeight,
        "Compared Framework",
        comparison.comparedFileName,
        boldFont,
        bodyFont,
      );

      const textTop = panelY + panelHeight - PANEL_HEADER_HEIGHT - BODY_PADDING - FONT_SIZE;
      const textBottom = panelY + BODY_PADDING;
      const textWidth = columnWidth - BODY_PADDING * 2;

      const baseDraw = drawStyledRunsPage({
        page,
        runs: baseRuns,
        state: baseState,
        x: baseX + BODY_PADDING,
        yTop: textTop,
        yBottom: textBottom,
        maxWidth: textWidth,
        regularFont: bodyFont,
        boldFont,
      });
      const comparedDraw = drawStyledRunsPage({
        page,
        runs: comparedRuns,
        state: comparedState,
        x: comparedX + BODY_PADDING,
        yTop: textTop,
        yBottom: textBottom,
        maxWidth: textWidth,
        regularFont: bodyFont,
        boldFont,
      });

      baseState = baseDraw.state;
      comparedState = comparedDraw.state;
      pagePart += 1;

      if (baseDraw.done && comparedDraw.done) {
        break;
      }
    }
  }

  const bytes = await output.save();
  return Buffer.from(bytes);
};
