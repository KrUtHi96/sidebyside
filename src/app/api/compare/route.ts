import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertPdfRuntimeCompatible } from "@/lib/runtime/pdfRuntime";
import {
  getDefaultExpiryMs,
  saveComparison,
} from "@/lib/store/comparisonStore";
import type { ComparisonResult } from "@/types/comparison";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TEMP_ROOT = path.join(os.tmpdir(), "sidebyside-comparisons");

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

const asUint8Array = async (file: File): Promise<Uint8Array> => {
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer.slice(0));
};

const methodNotAllowedResponse = () =>
  NextResponse.json(
    { error: "Method not allowed. Use POST /api/compare with basePdf and comparePdf files." },
    {
      status: 405,
      headers: { Allow: "POST, OPTIONS" },
    },
  );

export async function GET() {
  return methodNotAllowedResponse();
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      Allow: "POST, OPTIONS",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

export async function POST(request: Request) {
  try {
    assertPdfRuntimeCompatible();

    const [{ buildSectionComparisons }, { extractDocumentStructure }] = await Promise.all([
      import("@/lib/compare/buildComparison"),
      import("@/lib/pdf/extractParagraphs"),
    ]);

    const formData = await request.formData();
    const basePdf = formData.get("basePdf");
    const comparePdf = formData.get("comparePdf");

    if (!(basePdf instanceof File) || !(comparePdf instanceof File)) {
      return NextResponse.json(
        { error: "Both base and compared PDF files are required." },
        { status: 400 },
      );
    }

    const baseBuffer = await asUint8Array(basePdf);
    const compareBuffer = await asUint8Array(comparePdf);

    const [baseExtracted, comparedExtracted] = await Promise.all([
      extractDocumentStructure(baseBuffer.slice(), "base"),
      extractDocumentStructure(compareBuffer.slice(), "compared"),
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
      baseFileName: basePdf.name,
      comparedFileName: comparePdf.name,
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
      writeUploadToTempFile(comparisonId, "base", basePdf.name, baseBuffer),
      writeUploadToTempFile(comparisonId, "compared", comparePdf.name, compareBuffer),
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
    console.error("Failed to compare PDFs", error);
    return NextResponse.json(
      { error: "Unable to process the PDF comparison." },
      { status: 500 },
    );
  }
}
