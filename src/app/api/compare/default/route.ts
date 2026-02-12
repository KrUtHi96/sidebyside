import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSectionComparisons } from "@/lib/compare/buildComparison";
import { extractDocumentStructure } from "@/lib/pdf/extractParagraphs";
import {
  getDefaultExpiryMs,
  saveComparison,
} from "@/lib/store/comparisonStore";
import type { ComparisonResult } from "@/types/comparison";

export const runtime = "nodejs";

const TEMP_ROOT = path.join(os.tmpdir(), "sidebyside-comparisons");
const DEFAULT_BASE_PDF_PATH = path.join(
  process.cwd(),
  "public/samples/ifrs-base.pdf",
);
const DEFAULT_COMPARED_PDF_PATH = path.join(
  process.cwd(),
  "public/samples/aasb-compared.pdf",
);

const writeUploadToTempFile = async (
  comparisonId: string,
  side: "base" | "compared",
  originalName: string,
  data: Uint8Array,
): Promise<string> => {
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = path.join(TEMP_ROOT, comparisonId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${side}-${safeName}`);
  await fs.writeFile(filePath, data);
  return filePath;
};

const readDefaultPdf = async (filePath: string): Promise<Uint8Array> => {
  try {
    const data = await fs.readFile(filePath);
    return new Uint8Array(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      throw new Error(`Default PDF not found at path: ${filePath}`);
    }
    throw new Error(`Unable to read default PDF at path: ${filePath}`);
  }
};

export async function GET() {
  try {
    const [baseBuffer, comparedBuffer] = await Promise.all([
      readDefaultPdf(DEFAULT_BASE_PDF_PATH),
      readDefaultPdf(DEFAULT_COMPARED_PDF_PATH),
    ]);

    const [baseExtracted, comparedExtracted] = await Promise.all([
      extractDocumentStructure(baseBuffer.slice(), "base"),
      extractDocumentStructure(comparedBuffer.slice(), "compared"),
    ]);

    const comparisonId = crypto.randomUUID();
    const expiresAtMs = getDefaultExpiryMs();

    const {
      sections,
      sectionPageMap,
      sectionAnchors,
      rows,
      selectedSectionDefault,
    } = buildSectionComparisons(baseExtracted, comparedExtracted);

    const comparison: ComparisonResult = {
      id: comparisonId,
      renderMode: "exact_pdf",
      baseFileName: path.basename(DEFAULT_BASE_PDF_PATH),
      comparedFileName: path.basename(DEFAULT_COMPARED_PDF_PATH),
      expiresAt: new Date(expiresAtMs).toISOString(),
      sections,
      sectionPageMap,
      sectionAnchors,
      rows,
      selectedSectionDefault,
      extractionIssues: {
        base: baseExtracted.issues,
        compared: comparedExtracted.issues,
      },
      generatedAt: new Date().toISOString(),
    };

    const [basePdfTempPath, comparedPdfTempPath] = await Promise.all([
      writeUploadToTempFile(
        comparisonId,
        "base",
        path.basename(DEFAULT_BASE_PDF_PATH),
        baseBuffer,
      ),
      writeUploadToTempFile(
        comparisonId,
        "compared",
        path.basename(DEFAULT_COMPARED_PDF_PATH),
        comparedBuffer,
      ),
    ]);

    saveComparison({
      result: comparison,
      basePdfTempPath,
      comparedPdfTempPath,
      expiresAtMs,
    });

    return NextResponse.json({
      comparisonId,
      result: comparison,
      summary: {
        totalRows: comparison.rows.length,
        sections: comparison.sections.length,
        extractionIssues:
          comparison.extractionIssues.base.length +
          comparison.extractionIssues.compared.length,
      },
    });
  } catch (error) {
    console.error("Failed to load default PDF comparison", error);
    const message = error instanceof Error ? error.message : "Unable to load defaults.";
    const status = message.includes("Default PDF not found") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
