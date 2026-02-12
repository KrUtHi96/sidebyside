"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LoadingProgress } from "@/components/comparison/LoadingProgress";
import { RedlineText } from "@/components/comparison/RedlineText";
import { SectionSelector } from "@/components/comparison/SectionSelector";
import type {
  ComparisonResult,
  DiffToken,
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

type LoadingMode = "idle" | "bootstrapping";

export const ComparisonWorkspace = () => {
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const [comparisonId, setComparisonId] = useState<string | null>(null);
  const [loadingMode, setLoadingMode] = useState<LoadingMode>("idle");
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedSectionHeader, setSelectedSectionHeader] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const didBootstrapDefaults = useRef(false);
  const progressIntervalRef = useRef<number | null>(null);
  const progressCompletionRef = useRef<number | null>(null);
  const baseScrollRef = useRef<HTMLDivElement | null>(null);
  const comparedScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingFromRef = useRef<"base" | "compared" | null>(null);

  const isBootstrapping = loadingMode === "bootstrapping";

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
    (mode: "bootstrapping", label: string) => {
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

  const selectedSection = useMemo(
    () => result?.sections.find((section) => section.header === selectedSectionHeader) ?? null,
    [result, selectedSectionHeader],
  );

  const sectionTokens = useMemo<DiffToken[]>(
    () => selectedSection?.sectionDiffWord ?? [],
    [selectedSection],
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

      setResult(nextResult);
      setComparisonId(payload?.comparisonId as string);
      setSelectedSectionHeader(
        nextResult.selectedSectionDefault ?? nextResult.sections[0]?.header ?? null,
      );
      await completeProgress();
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Unable to load default comparison.";
      setError(`${message} Refresh the page to retry default loading. If it persists, redeploy.`);
      stopProgress();
    }
  }, [completeProgress, startProgress, stopProgress]);

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

  const onSelectSection = useCallback((header: string) => {
    setSelectedSectionHeader(header);
  }, []);

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

  useEffect(() => {
    const base = baseScrollRef.current;
    const compared = comparedScrollRef.current;
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
  }, [selectedSectionHeader]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[var(--color-bg-secondary)]">
      {/* Header Navigation Bar */}
      <header 
        className="flex h-[var(--header-height)] shrink-0 items-center gap-4 border-b border-[var(--color-border)] bg-white px-5"
        style={{ height: 56 }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2">
          <div 
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{ 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' 
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
              <rect x="3" y="3" width="8" height="8" rx="1" />
              <rect x="13" y="3" width="8" height="8" rx="1" />
              <rect x="3" y="13" width="8" height="8" rx="1" />
              <rect x="13" y="13" width="8" height="8" rx="1" />
            </svg>
          </div>
          <span className="text-lg font-bold text-[var(--color-text-primary)]">SideBySide</span>
        </div>

        {/* Divider */}
        <div className="h-6 w-px bg-[var(--color-border)]" />

        {/* File Upload Area */}
        <div className="flex flex-1 items-center gap-3">
          <label
            aria-disabled="true"
            title="Default files are preselected; upload is locked."
            className="flex cursor-not-allowed items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-tertiary)] opacity-90"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="font-medium text-[var(--color-text-primary)]">Base PDF</span>
            <span className="truncate max-w-[140px] text-xs">
              {result?.baseFileName ?? "IFRS base document"}
            </span>
            <input className="hidden" type="file" accept="application/pdf" disabled />
          </label>

          <span className="text-sm text-[var(--color-text-muted)]">vs</span>

          <label
            aria-disabled="true"
            title="Default files are preselected; upload is locked."
            className="flex cursor-not-allowed items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-tertiary)] opacity-90"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span className="font-medium text-[var(--color-text-primary)]">Compared PDF</span>
            <span className="truncate max-w-[140px] text-xs">
              {result?.comparedFileName ?? "AASB compared document"}
            </span>
            <input className="hidden" type="file" accept="application/pdf" disabled />
          </label>

          <button
            type="button"
            disabled
            title="Default files are preselected; manual compare is locked."
            className="rounded-md px-4 py-1.5 text-sm font-medium text-white transition disabled:cursor-not-allowed"
            style={{ 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              opacity: 0.5 
            }}
          >
            Compare
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <select
            disabled
            title="Diff mode is fixed to word in read-only compare mode."
            className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1.5 text-sm text-[var(--color-text-tertiary)] disabled:cursor-not-allowed"
            value="word"
            onChange={() => undefined}
          >
            <option value="word">All Changes</option>
            <option value="added">Added Only</option>
            <option value="removed">Removed Only</option>
            <option value="modified">Modified Only</option>
          </select>

          <button
            type="button"
            onClick={exportPdf}
            disabled={!comparisonId}
            className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-white px-3 py-1.5 text-sm text-[var(--color-text-secondary)] transition hover:bg-[var(--color-bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
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

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Collapsible Sidebar */}
        <aside 
          className="flex shrink-0 flex-col border-r border-[var(--color-border)] bg-white transition-all duration-300"
          style={{ 
            width: railCollapsed ? 48 : 280 
          }}
        >
          {/* Sidebar Header */}
          <div className="flex items-center justify-between border-b border-[var(--color-border)] p-3">
            {!railCollapsed && (
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">Sections</span>
            )}
            <button
              type="button"
              onClick={() => setRailCollapsed((value) => !value)}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--color-bg-secondary)] text-[var(--color-text-tertiary)] transition hover:bg-[var(--color-bg-tertiary)]"
              title={railCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg 
                width="14" 
                height="14" 
                viewBox="0 0 24 24" 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="2"
                style={{ transform: railCollapsed ? 'rotate(180deg)' : 'none' }}
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>

          {/* Section Tree */}
          <SectionSelector
            compact={railCollapsed}
            sections={result?.sections ?? []}
            selectedHeader={selectedSectionHeader}
            onSelect={onSelectSection}
          />
        </aside>

        {/* Comparison Panels */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {/* Panel Headers */}
          <div className="flex h-[var(--panel-header-height)] shrink-0 border-b border-[var(--color-border)] bg-white">
            <div className="flex flex-1 items-center gap-3 border-r border-[var(--color-border)] px-5">
              <span 
                className="rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide"
                style={{ 
                  background: 'var(--color-bg-tertiary)', 
                  color: 'var(--color-text-tertiary)' 
                }}
              >
                Base
              </span>
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                {result?.baseFileName ?? "No file compared yet"}
              </span>
            </div>
            <div className="flex flex-1 items-center gap-3 px-5">
              <span 
                className="rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide"
                style={{ 
                  background: 'rgba(102, 126, 234, 0.15)', 
                  color: '#667eea' 
                }}
              >
                Compared
              </span>
              <span className="text-sm font-medium text-[var(--color-text-primary)]">
                {result?.comparedFileName ?? "No file compared yet"}
              </span>
            </div>
          </div>

          {/* Coverage Warning */}
          {selectedSection && selectedSection.coverage.percent < 100 ? (
            <div 
              className="shrink-0 px-5 py-2 text-sm"
              style={{ 
                background: 'var(--color-changed-subtle)', 
                color: 'var(--color-changed-text)' 
              }}
            >
              Coverage warning: {selectedSection.coverage.percent.toFixed(1)}% of lines were mapped in this section. 
              Unmapped text is included as synthetic rows and listed in extraction issues.
            </div>
          ) : null}

          {/* Split Panels */}
          <div className="flex flex-1 overflow-hidden">
            {/* Base Panel */}
            <article className="flex flex-1 flex-col overflow-hidden border-r border-[var(--color-border)] bg-white">
              <div
                ref={baseScrollRef}
                onScroll={onBaseScroll}
                className="flex-1 overflow-y-auto p-6"
              >
                {selectedSection ? (
                  selectedSection.baseSectionTextPreserved ? (
                    <pre 
                      className="whitespace-pre-wrap break-words font-sans text-sm leading-7"
                      style={{ color: 'var(--color-text-secondary)' }}
                    >
                      {selectedSection.baseSectionTextPreserved}
                    </pre>
                  ) : (
                    <div 
                      className="rounded-lg border border-dashed p-4 text-sm"
                      style={{ 
                        borderColor: 'var(--color-border)', 
                        background: 'var(--color-bg-secondary)',
                        color: 'var(--color-text-tertiary)'
                      }}
                    >
                      This section is missing in the base document.
                    </div>
                  )
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">Select a section to compare.</p>
                )}
              </div>
            </article>

            {/* Compared Panel */}
            <article className="flex flex-1 flex-col overflow-hidden bg-white">
              <div
                ref={comparedScrollRef}
                onScroll={onComparedScroll}
                className="flex-1 overflow-y-auto p-6"
              >
                {selectedSection ? (
                  selectedSection.baseSectionTextPreserved || selectedSection.comparedSectionTextPreserved ? (
                    <RedlineText tokens={sectionTokens} side="compared" />
                  ) : (
                    <div 
                      className="rounded-lg border border-dashed p-4 text-sm"
                      style={{ 
                        borderColor: 'var(--color-border)', 
                        background: 'var(--color-bg-secondary)',
                        color: 'var(--color-text-tertiary)'
                      }}
                    >
                      This section is missing in the compared document.
                    </div>
                  )
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">Select a section to compare.</p>
                )}
              </div>
            </article>
          </div>
        </main>
      </div>

      {/* Legend */}
      {result && (
        <div 
          className="fixed bottom-5 left-1/2 flex -translate-x-1/2 gap-5 rounded-lg px-4 py-2.5 text-xs shadow-md"
          style={{ 
            background: "rgba(0, 0, 0, 0.65)",
            border: "1px solid rgba(255, 255, 255, 0.18)",
            boxShadow: "0 10px 26px rgba(0,0,0,0.35)"
          }}
        >
          <div className="flex items-center gap-2">
            <span 
              className="h-3 w-3 rounded-sm" 
              style={{ background: 'var(--color-added)' }}
            />
            <span style={{ color: 'rgba(255,255,255,0.94)' }}>Added</span>
          </div>
          <div className="flex items-center gap-2">
            <span 
              className="h-3 w-3 rounded-sm" 
              style={{ background: 'var(--color-removed)' }}
            />
            <span style={{ color: 'rgba(255,255,255,0.94)' }}>Removed</span>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isBootstrapping ? (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(26, 26, 26, 0.5)', backdropFilter: 'blur(4px)' }}
        >
          <div 
            className="w-[min(92vw,480px)] rounded-lg border border-[var(--color-border)] bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex items-center gap-3">
              <span 
                className="inline-flex h-10 w-10 items-center justify-center rounded-full"
                style={{ 
                  background: 'var(--color-primary-subtle)', 
                  color: 'var(--color-primary)' 
                }}
              >
                <span 
                  className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" 
                />
              </span>
              <div>
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Preparing your comparison workspace
                </p>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Loading default IFRS vs AASB documents
                </p>
              </div>
            </div>
            <LoadingProgress percent={progressPercent} label={progressLabel} />
          </div>
        </div>
      ) : null}

      {/* Error Toast */}
      {error ? (
        <div 
          className="fixed bottom-5 right-5 max-w-md rounded-lg border px-4 py-3 text-sm shadow-lg"
          style={{ 
            background: 'var(--color-removed-bg)', 
            borderColor: 'var(--color-removed)',
            color: 'var(--color-removed-text)'
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
};
