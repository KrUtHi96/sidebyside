import { NextResponse } from "next/server";
import { renderComparisonPdfBuffer } from "@/lib/export/renderComparisonPdf";
import { getStoredComparisonState } from "@/lib/store/comparisonStore";
import type { DiffGranularity } from "@/types/comparison";

export const runtime = "nodejs";
export const maxDuration = 60;

const isDiffGranularity = (value: string): value is DiffGranularity =>
  value === "word" || value === "sentence" || value === "paragraph";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const state = getStoredComparisonState(id);
  if (state.state === "expired") {
    return NextResponse.json(
      { error: "Comparison files expired after 2 hours; please re-upload." },
      { status: 410 },
    );
  }

  if (state.state === "missing") {
    return NextResponse.json(
      { error: "Comparison not found or expired." },
      { status: 404 },
    );
  }

  const { result: comparison } = state.record;

  try {
    const { searchParams } = new URL(request.url);
    const granularityParam = searchParams.get("granularity") ?? "word";
    const granularity = isDiffGranularity(granularityParam)
      ? granularityParam
      : "word";

    const buffer = await renderComparisonPdfBuffer({
      comparison,
      granularity,
      basePdfPath: state.record.basePdfTempPath,
      comparedPdfPath: state.record.comparedPdfTempPath,
    });
    const sanitizedBaseName = comparison.baseFileName.replace(/\.pdf$/i, "");
    const fileName = `${sanitizedBaseName}-comparison-report.pdf`;

    const body = new Uint8Array(buffer);

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename=\"${fileName}\"`,
      },
    });
  } catch (error) {
    console.error("PDF export failed", error);
    return NextResponse.json(
      { error: "Failed to generate export PDF." },
      { status: 500 },
    );
  }
}
