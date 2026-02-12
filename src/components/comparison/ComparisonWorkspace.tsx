"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { RedlineText } from "@/components/comparison/RedlineText";
import { SectionSelector } from "@/components/comparison/SectionSelector";
import type {
  ComparisonResult,
  DiffGranularity,
  DiffToken,
  SectionComparison,
} from "@/types/comparison";

const getSectionTokensByGranularity = (
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

export const ComparisonWorkspace = () => {
  const [basePdf, setBasePdf] = useState<File | null>(null);
  const [comparedPdf, setComparedPdf] = useState<File | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSectionHeader, setSelectedSectionHeader] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [granularity, setGranularity] = useState<DiffGranularity>("word");
  const didBootstrapDefaults = useRef(false);

  const selectedSection = useMemo(
    () => result?.sections.find((section) => section.header === selectedSectionHeader) ?? null,
    [result, selectedSectionHeader],
  );

  const sectionTokens = useMemo(
    () => (selectedSection ? getSectionTokensByGranularity(selectedSection, granularity) : []),
    [selectedSection, granularity],
  );

  const compareFiles = useCallback(async () => {
    if (!basePdf || !comparedPdf) {
      setError("Upload both PDFs to run comparison.");
      return;
    }

    setError(null);
    setLoading(true);

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

      setResult(nextResult);
      setComparisonId(payload?.comparisonId as string);
      setSelectedSectionHeader(
        nextResult.selectedSectionDefault ?? nextResult.sections[0]?.header ?? null,
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to compare files.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [basePdf, comparedPdf]);

  const loadDefaultComparison = useCallback(async () => {
    setError(null);
    setLoading(true);

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

      setResult(nextResult);
      setComparisonId(payload?.comparisonId as string);
      setSelectedSectionHeader(
        nextResult.selectedSectionDefault ?? nextResult.sections[0]?.header ?? null,
      );
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to load default comparison.";
      setError(`${message} Upload PDFs manually to continue.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (didBootstrapDefaults.current) {
      return;
    }

    didBootstrapDefaults.current = true;
    void loadDefaultComparison();
  }, [loadDefaultComparison]);

  const exportPdf = useCallback(() => {
    if (!comparisonId) {
      return;
    }

    window.open(
      `/api/compare/${comparisonId}/export?granularity=${granularity}`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [comparisonId, granularity]);

  const onSelectSection = useCallback((header: string) => {
    setSelectedSectionHeader(header);
  }, []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1900px] flex-col gap-4 px-4 py-5 md:px-6">
      <header className="rounded-2xl border border-slate-200 bg-white/80 p-4 backdrop-blur-sm shadow-[0_5px_20px_rgba(15,23,42,0.08)]">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-[230px] flex-1 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
            <span className="font-semibold text-slate-900">Base PDF</span>
            <span className="truncate text-xs text-slate-500">
              {basePdf?.name ?? result?.baseFileName ?? "Upload base framework"}
            </span>
            <input
              className="hidden"
              type="file"
              accept="application/pdf"
              onChange={(event) => setBasePdf(event.target.files?.[0] ?? null)}
            />
          </label>

          <label className="flex min-w-[230px] flex-1 cursor-pointer items-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
            <span className="font-semibold text-slate-900">Compared PDF</span>
            <span className="truncate text-xs text-slate-500">
              {comparedPdf?.name ?? result?.comparedFileName ?? "Upload target framework"}
            </span>
            <input
              className="hidden"
              type="file"
              accept="application/pdf"
              onChange={(event) => setComparedPdf(event.target.files?.[0] ?? null)}
            />
          </label>

          <button
            type="button"
            onClick={compareFiles}
            disabled={loading}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? "Comparing..." : "Compare"}
          </button>

          <button
            type="button"
            onClick={exportPdf}
            disabled={!comparisonId}
            className="rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:bg-teal-300"
          >
            Export Full PDF
          </button>

          <select
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            value={granularity}
            onChange={(event) => setGranularity(event.target.value as DiffGranularity)}
          >
            <option value="word">Word diff (default)</option>
            <option value="sentence">Sentence diff</option>
            <option value="paragraph">Paragraph diff</option>
          </select>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">
            Text dump comparison view
          </span>
          <span className="rounded-full bg-rose-50 px-2 py-1 text-rose-700">
            Removed (A-only) in compared panel
          </span>
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">
            Added (B-only) in compared panel
          </span>
          {result ? (
            <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">
              Expires: {new Date(result.expiresAt).toLocaleTimeString()}
            </span>
          ) : null}
          {error ? <span className="text-rose-700">{error}</span> : null}
        </div>
      </header>

      <section
        className={clsx(
          "grid flex-1 grid-cols-1 gap-4",
          railCollapsed ? "xl:grid-cols-[72px_1fr]" : "xl:grid-cols-[320px_1fr]",
        )}
      >
        <aside className="rounded-2xl border border-slate-200 bg-white shadow-[0_5px_20px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between border-b border-slate-200 p-2">
            {!railCollapsed ? (
              <p className="px-1 text-sm font-semibold text-slate-900">Sections</p>
            ) : null}

            <button
              type="button"
              onClick={() => setRailCollapsed((value) => !value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              title={railCollapsed ? "Expand rail" : "Collapse rail"}
            >
              {railCollapsed ? ">" : "<"}
            </button>
          </div>

          <SectionSelector
            compact={railCollapsed}
            sections={result?.sections ?? []}
            selectedHeader={selectedSectionHeader}
            onSelect={onSelectSection}
          />
        </aside>

        <section className="grid min-h-[76vh] grid-cols-1 gap-4 xl:grid-cols-2">
          {selectedSection && selectedSection.coverage.percent < 100 ? (
            <div className="xl:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Coverage warning: {selectedSection.coverage.percent.toFixed(1)}% of lines were mapped in this
              section. Unmapped text is included as synthetic rows and listed in extraction issues.
            </div>
          ) : null}

          <article className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-[0_5px_20px_rgba(15,23,42,0.06)]">
            <header className="border-b border-slate-200 px-4 py-3">
              <h2 className="font-semibold text-slate-900">Base Framework</h2>
              <p className="text-xs text-slate-500">{result?.baseFileName ?? "No file compared yet"}</p>
              {selectedSection ? (
                <p className="mt-1 text-xs text-slate-600">
                  Section: <span className="font-semibold">{selectedSection.header}</span>
                </p>
              ) : null}
            </header>

            <div className="flex-1 overflow-auto p-4">
              {selectedSection ? (
                selectedSection.baseSectionTextPreserved ? (
                  <pre className="text-[15px] leading-7 whitespace-pre-wrap break-words font-serif text-slate-800">
                    {selectedSection.baseSectionTextPreserved}
                  </pre>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
                    This section is missing in the base document.
                  </div>
                )
              ) : (
                <p className="text-sm text-slate-500">Select a section to compare.</p>
              )}
            </div>
          </article>

          <article className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-[0_5px_20px_rgba(15,23,42,0.06)]">
            <header className="border-b border-slate-200 px-4 py-3">
              <h2 className="font-semibold text-slate-900">Compared Framework</h2>
              <p className="text-xs text-slate-500">{result?.comparedFileName ?? "No file compared yet"}</p>
              {selectedSection ? (
                <p className="mt-1 text-xs text-slate-600">
                  Section: <span className="font-semibold">{selectedSection.header}</span>
                </p>
              ) : null}
            </header>

            <div className="flex-1 overflow-auto p-4">
              {selectedSection ? (
                selectedSection.baseSectionTextPreserved || selectedSection.comparedSectionTextPreserved ? (
                  <RedlineText tokens={sectionTokens} side="compared" />
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">
                    This section is missing in the compared document.
                  </div>
                )
              ) : (
                <p className="text-sm text-slate-500">Select a section to compare.</p>
              )}
            </div>
          </article>
        </section>
      </section>

      {result ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_5px_20px_rgba(15,23,42,0.06)]">
          <h2 className="mb-2 font-semibold text-slate-900">Unmatched / Unextractable Sections</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Base document issues</p>
              <ul className="space-y-1 text-xs text-slate-600">
                {result.extractionIssues.base.length === 0 ? (
                  <li className="text-slate-500">No extraction issues.</li>
                ) : (
                  result.extractionIssues.base.map((issue) => (
                    <li
                      key={`base-issue-${issue.key}`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1"
                    >
                      p.{issue.pageStart} | {issue.originalLabel} | {issue.text.slice(0, 140)}
                    </li>
                  ))
                )}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Compared document issues</p>
              <ul className="space-y-1 text-xs text-slate-600">
                {result.extractionIssues.compared.length === 0 ? (
                  <li className="text-slate-500">No extraction issues.</li>
                ) : (
                  result.extractionIssues.compared.map((issue) => (
                    <li
                      key={`compared-issue-${issue.key}`}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1"
                    >
                      p.{issue.pageStart} | {issue.originalLabel} | {issue.text.slice(0, 140)}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};
