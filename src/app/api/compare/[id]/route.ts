import { NextResponse } from "next/server";
import { getStoredComparisonState } from "@/lib/store/comparisonStore";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
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

  return NextResponse.json(state.record.result);
}
