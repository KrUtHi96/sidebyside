import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { getStoredComparisonState } from "@/lib/store/comparisonStore";

export const runtime = "nodejs";

type Side = "base" | "compared";

const isSide = (value: string): value is Side =>
  value === "base" || value === "compared";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; side: string }> },
) {
  const { id, side } = await context.params;

  if (!isSide(side)) {
    return NextResponse.json({ error: "Invalid side." }, { status: 400 });
  }

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

  const filePath =
    side === "base"
      ? state.record.basePdfTempPath
      : state.record.comparedPdfTempPath;

  try {
    const pdfBuffer = await fs.readFile(filePath);
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Source PDF is unavailable; please re-upload." },
      { status: 410 },
    );
  }
}
