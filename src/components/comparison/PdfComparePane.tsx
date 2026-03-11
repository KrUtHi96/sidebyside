"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SectionAnchor } from "@/types/comparison";

type PdfSide = "base" | "compared";
type HighlightKind = "added" | "removed";

export type PdfJumpTargetWithNonce = {
  page: number;
  y?: number;
  source: "section" | "issue";
  nonce: number;
};

export type PdfSyncViewport = {
  pageIndex: number;
  pageProgress: number;
  containerScrollRatio: number;
  nonce: number;
};

export type PdfHighlightSnippet = {
  id: string;
  kind: HighlightKind;
  text: string;
  anchorPage?: number;
  anchorY?: number;
};

type TextBox = {
  normalized: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

type SearchRange = {
  start: number;
  end: number;
  boxIndex: number;
};

type PageRender = {
  pageNumber: number;
  imageUrl: string;
  width: number;
  height: number;
  pointsHeight: number;
  textBoxes: TextBox[];
  searchText: string;
  searchRanges: SearchRange[];
};

type HighlightRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  kind: HighlightKind;
};

type HighlightBand = {
  top: number;
  height: number;
  kind: HighlightKind;
};

type PageHighlights = {
  exact: HighlightRect[];
  fallback: HighlightBand[];
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const normalizeForMatch = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toJsonErrorMessage = async (response: Response): Promise<string> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { error?: string };
    if (payload.error?.trim()) {
      return payload.error;
    }
  }
  const text = await response.text();
  if (text.trim()) {
    return text.slice(0, 220);
  }
  return `Request failed (${response.status}).`;
};

const ensureWorkerSource = (pdfModule: {
  GlobalWorkerOptions?: { workerSrc?: string };
  version?: string;
}) => {
  if (!pdfModule.GlobalWorkerOptions) {
    return;
  }

  if (pdfModule.GlobalWorkerOptions.workerSrc) {
    return;
  }

  const version = pdfModule.version ?? "5.4.624";
  pdfModule.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/legacy/build/pdf.worker.min.mjs`;
};

const pickBestTopRatio = (anchorY: number, pointsHeight: number): number => {
  if (!Number.isFinite(anchorY) || !Number.isFinite(pointsHeight) || pointsHeight <= 0) {
    return 0.1;
  }

  const fromPdfBottom = clamp((pointsHeight - anchorY) / pointsHeight, 0, 1);
  const fromTop = clamp(anchorY / pointsHeight, 0, 1);
  if (fromPdfBottom >= 0.02 && fromPdfBottom <= 0.98) {
    return fromPdfBottom;
  }
  return fromTop;
};

const orderPagesForSnippet = (
  totalPages: number,
  anchorPage?: number,
): number[] => {
  const ordered: number[] = [];
  const seen = new Set<number>();

  if (anchorPage && anchorPage >= 1 && anchorPage <= totalPages) {
    const preferred = [anchorPage, anchorPage - 1, anchorPage + 1];
    for (const page of preferred) {
      if (page >= 1 && page <= totalPages && !seen.has(page)) {
        ordered.push(page);
        seen.add(page);
      }
    }
  }

  for (let page = 1; page <= totalPages; page += 1) {
    if (!seen.has(page)) {
      ordered.push(page);
    }
  }

  return ordered;
};

const findExactRects = (
  page: PageRender,
  normalizedSnippet: string,
  kind: HighlightKind,
): HighlightRect[] | null => {
  if (!normalizedSnippet || !page.searchText) {
    return null;
  }

  const foundIndex = page.searchText.indexOf(normalizedSnippet);
  if (foundIndex < 0) {
    return null;
  }

  const foundEnd = foundIndex + normalizedSnippet.length;
  const matchedBoxIndexes: number[] = [];
  for (const range of page.searchRanges) {
    if (range.end <= foundIndex || range.start >= foundEnd) {
      continue;
    }
    matchedBoxIndexes.push(range.boxIndex);
  }

  if (matchedBoxIndexes.length === 0) {
    return null;
  }

  const uniqueIndexes = [...new Set(matchedBoxIndexes)];
  const matchedBoxes = uniqueIndexes
    .map((index) => page.textBoxes[index])
    .filter(Boolean)
    .sort((left, right) =>
      Math.abs(left.top - right.top) <= 0.012
        ? left.left - right.left
        : left.top - right.top,
    );

  if (matchedBoxes.length === 0) {
    return null;
  }

  const lineGroups: TextBox[][] = [];
  for (const box of matchedBoxes) {
    const lastGroup = lineGroups[lineGroups.length - 1];
    if (!lastGroup) {
      lineGroups.push([box]);
      continue;
    }
    const lastTop = lastGroup[lastGroup.length - 1].top;
    if (Math.abs(lastTop - box.top) <= 0.012) {
      lastGroup.push(box);
      continue;
    }
    lineGroups.push([box]);
  }

  return lineGroups.map((group) => {
    const left = Math.min(...group.map((box) => box.left));
    const top = Math.min(...group.map((box) => box.top));
    const right = Math.max(...group.map((box) => box.left + box.width));
    const bottom = Math.max(...group.map((box) => box.top + box.height));
    return {
      left,
      top,
      width: right - left,
      height: bottom - top,
      kind,
    };
  });
};

export const PdfComparePane = ({
  side,
  comparisonId,
  sectionAnchors,
  highlightSnippets,
  jumpTarget,
  syncViewport,
  onViewportChange,
  emptyMessage,
}: {
  side: PdfSide;
  comparisonId: string | null;
  sectionAnchors: SectionAnchor[];
  highlightSnippets: PdfHighlightSnippet[];
  jumpTarget: PdfJumpTargetWithNonce | null;
  syncViewport: PdfSyncViewport | null;
  onViewportChange: (
    side: PdfSide,
    viewport: Omit<PdfSyncViewport, "nonce">,
  ) => void;
  emptyMessage: string;
}) => {
  const [pages, setPages] = useState<PageRender[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const objectUrlsRef = useRef<string[]>([]);
  const isApplyingExternalScrollRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current = [];
    setPages([]);
    setError(null);

    if (!comparisonId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/compare/${comparisonId}/source/${side}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(await toJsonErrorMessage(response));
        }
        const arrayBuffer = await response.arrayBuffer();
        const pdfModule = await import("pdfjs-dist/legacy/build/pdf.mjs");
        ensureWorkerSource(pdfModule);

        const loadingTask = pdfModule.getDocument({
          data: new Uint8Array(arrayBuffer),
        });
        const pdfDocument = await loadingTask.promise;
        const nextPages: PageRender[] = [];
        const nextUrls: string[] = [];

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber);
          const displayViewport = page.getViewport({ scale: 1.25 });
          const textViewport = page.getViewport({ scale: 1 });
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d");
          if (!context) {
            throw new Error("Unable to initialize PDF canvas.");
          }
          canvas.width = Math.ceil(displayViewport.width);
          canvas.height = Math.ceil(displayViewport.height);
          await page.render({
            canvas,
            canvasContext: context,
            viewport: displayViewport,
          }).promise;
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/png"),
          );
          if (!blob) {
            throw new Error("Unable to serialize rendered PDF page.");
          }
          const imageUrl = URL.createObjectURL(blob);
          nextUrls.push(imageUrl);

          const textContent = await page.getTextContent();
          const textBoxes: TextBox[] = [];
          for (const item of textContent.items) {
            if (!("str" in item)) {
              continue;
            }
            const normalized = normalizeForMatch(item.str);
            if (!normalized) {
              continue;
            }
            const width = Math.max(1, item.width);
            const height = Math.max(
              8,
              Number.isFinite(item.height) ? item.height : Math.abs(item.transform[3]),
            );
            const left = clamp(item.transform[4] / textViewport.width, 0, 1);
            const top = clamp(
              (textViewport.height - item.transform[5] - height) / textViewport.height,
              0,
              1,
            );
            const widthRatio = clamp(width / textViewport.width, 0.002, 1);
            const heightRatio = clamp(height / textViewport.height, 0.008, 1);

            textBoxes.push({
              normalized,
              left,
              top,
              width: widthRatio,
              height: heightRatio,
            });
          }

          let searchText = "";
          const searchRanges: SearchRange[] = [];
          let cursor = 0;
          textBoxes.forEach((box, boxIndex) => {
            if (searchText.length > 0) {
              searchText += " ";
              cursor += 1;
            }
            const start = cursor;
            searchText += box.normalized;
            cursor += box.normalized.length;
            searchRanges.push({
              start,
              end: cursor,
              boxIndex,
            });
          });

          nextPages.push({
            pageNumber,
            imageUrl,
            width: displayViewport.width,
            height: displayViewport.height,
            pointsHeight: textViewport.height,
            textBoxes,
            searchText,
            searchRanges,
          });
        }

        if (!cancelled) {
          objectUrlsRef.current = nextUrls;
          setPages(nextPages);
        } else {
          for (const url of nextUrls) {
            URL.revokeObjectURL(url);
          }
        }
      } catch (errorCandidate) {
        if (!cancelled) {
          setError(
            errorCandidate instanceof Error
              ? errorCandidate.message
              : "Unable to load PDF render.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
      for (const url of objectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      objectUrlsRef.current = [];
    };
  }, [comparisonId, side]);

  const highlightsByPage = useMemo(() => {
    const pageMap = new Map<number, PageHighlights>();
    for (const page of pages) {
      pageMap.set(page.pageNumber, { exact: [], fallback: [] });
    }

    for (const snippet of highlightSnippets) {
      const normalizedSnippet = normalizeForMatch(snippet.text);
      if (!normalizedSnippet) {
        continue;
      }

      const orderedPages = orderPagesForSnippet(
        pages.length,
        snippet.anchorPage,
      );
      let found = false;

      for (const pageNumber of orderedPages) {
        const page = pages[pageNumber - 1];
        if (!page) {
          continue;
        }
        const exact = findExactRects(page, normalizedSnippet, snippet.kind);
        if (!exact || exact.length === 0) {
          continue;
        }
        pageMap.get(pageNumber)?.exact.push(...exact);
        found = true;
        break;
      }

      if (!found && snippet.anchorPage && snippet.anchorY !== undefined) {
        const page = pages[snippet.anchorPage - 1];
        if (!page) {
          continue;
        }
        const topRatio = pickBestTopRatio(snippet.anchorY, page.pointsHeight);
        pageMap.get(page.pageNumber)?.fallback.push({
          top: clamp(topRatio - 0.012, 0, 0.98),
          height: 0.024,
          kind: snippet.kind,
        });
      }
    }

    // Preserve a visible fallback band around known anchor points even if text matching fails completely.
    for (const anchor of sectionAnchors) {
      const point = side === "base" ? anchor.base : anchor.compared;
      if (!point) {
        continue;
      }
      const page = pages[point.page - 1];
      if (!page) {
        continue;
      }
      const topRatio = pickBestTopRatio(point.y, page.pointsHeight);
      const hasExistingBand = pageMap
        .get(page.pageNumber)
        ?.fallback.some((band) => Math.abs(band.top - topRatio) <= 0.02);
      if (hasExistingBand) {
        continue;
      }
      const kind: HighlightKind =
        anchor.status === "added" ? "added" : "removed";
      pageMap.get(page.pageNumber)?.fallback.push({
        top: clamp(topRatio - 0.01, 0, 0.98),
        height: 0.02,
        kind,
      });
    }

    return pageMap;
  }, [highlightSnippets, pages, sectionAnchors, side]);

  const emitViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container || pages.length === 0) {
      return;
    }

    const maxScroll = Math.max(1, container.scrollHeight - container.clientHeight);
    const ratio = clamp(container.scrollTop / maxScroll, 0, 1);
    const viewportMid = container.scrollTop + container.clientHeight / 2;
    const pageNumber = pages.find((page) => {
      const pageEl = pageRefs.current[page.pageNumber];
      if (!pageEl) {
        return false;
      }
      const pageTop = pageEl.offsetTop;
      const pageBottom = pageTop + pageEl.clientHeight;
      return viewportMid >= pageTop && viewportMid <= pageBottom;
    })?.pageNumber ?? 1;

    const currentPageEl = pageRefs.current[pageNumber];
    let pageProgress = 0;
    if (currentPageEl) {
      const topWithinPage = viewportMid - currentPageEl.offsetTop;
      pageProgress = clamp(topWithinPage / Math.max(1, currentPageEl.clientHeight), 0, 1);
    }

    onViewportChange(side, {
      pageIndex: pageNumber,
      pageProgress,
      containerScrollRatio: ratio,
    });
  }, [onViewportChange, pages, side]);

  const onScroll = useCallback(() => {
    if (isApplyingExternalScrollRef.current) {
      return;
    }

    if (scrollRafRef.current) {
      window.cancelAnimationFrame(scrollRafRef.current);
    }

    scrollRafRef.current = window.requestAnimationFrame(() => {
      emitViewport();
    });
  }, [emitViewport]);

  useEffect(() => {
    if (!syncViewport) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    let nextTop = 0;
    const targetPageEl = pageRefs.current[syncViewport.pageIndex];
    if (targetPageEl) {
      nextTop =
        targetPageEl.offsetTop +
        syncViewport.pageProgress * targetPageEl.clientHeight -
        container.clientHeight / 2;
    } else {
      const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
      nextTop = syncViewport.containerScrollRatio * maxScroll;
    }

    isApplyingExternalScrollRef.current = true;
    container.scrollTop = clamp(
      nextTop,
      0,
      Math.max(0, container.scrollHeight - container.clientHeight),
    );
    const clearRefId = window.requestAnimationFrame(() => {
      isApplyingExternalScrollRef.current = false;
    });

    return () => {
      window.cancelAnimationFrame(clearRefId);
    };
  }, [syncViewport]);

  useEffect(() => {
    if (!jumpTarget) {
      return;
    }

    const container = containerRef.current;
    const pageElement = pageRefs.current[jumpTarget.page];
    if (!container || !pageElement) {
      return;
    }

    let targetTop = pageElement.offsetTop;
    if (jumpTarget.y !== undefined) {
      const page = pages.find((entry) => entry.pageNumber === jumpTarget.page);
      if (page) {
        const topRatio = pickBestTopRatio(jumpTarget.y, page.pointsHeight);
        targetTop = pageElement.offsetTop + topRatio * pageElement.clientHeight;
      }
    }

    targetTop -= container.clientHeight * 0.18;
    isApplyingExternalScrollRef.current = true;
    container.scrollTop = clamp(
      targetTop,
      0,
      Math.max(0, container.scrollHeight - container.clientHeight),
    );
    const clearRefId = window.requestAnimationFrame(() => {
      isApplyingExternalScrollRef.current = false;
      emitViewport();
    });

    return () => {
      window.cancelAnimationFrame(clearRefId);
    };
  }, [emitViewport, jumpTarget, pages]);

  if (!comparisonId) {
    return <p className="text-sm text-[var(--color-text-muted)]">{emptyMessage}</p>;
  }

  if (loading) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading source PDF...</p>;
  }

  if (error) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-tertiary)]">
        {error}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={onScroll}
      className="h-full overflow-y-auto rounded-md border border-[var(--color-border)] bg-white p-3"
    >
      {pages.map((page) => {
        const pageHighlights = highlightsByPage.get(page.pageNumber);
        return (
          <div
            key={`pdf-page-${side}-${page.pageNumber}`}
            ref={(node) => {
              pageRefs.current[page.pageNumber] = node;
            }}
            className="relative mx-auto mb-4 last:mb-0"
            style={{ maxWidth: `${page.width}px` }}
          >
            <img
              src={page.imageUrl}
              alt={`PDF page ${page.pageNumber}`}
              className="h-auto w-full rounded-sm border border-[var(--color-border)] bg-white"
              draggable={false}
            />

            <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-sm">
              {pageHighlights?.exact.map((highlight, index) => (
                <div
                  key={`exact-${page.pageNumber}-${index}`}
                  className="absolute rounded-[2px]"
                  style={{
                    left: `${highlight.left * 100}%`,
                    top: `${highlight.top * 100}%`,
                    width: `${highlight.width * 100}%`,
                    height: `${highlight.height * 100}%`,
                    background:
                      highlight.kind === "added"
                        ? "var(--color-added-bg)"
                        : "var(--color-removed-bg)",
                    outline:
                      highlight.kind === "added"
                        ? "1px solid var(--color-added)"
                        : "1px solid var(--color-removed)",
                  }}
                />
              ))}
              {pageHighlights?.fallback.map((band, index) => (
                <div
                  key={`fallback-${page.pageNumber}-${index}`}
                  className="absolute left-0 right-0"
                  style={{
                    top: `${band.top * 100}%`,
                    height: `${band.height * 100}%`,
                    background:
                      band.kind === "added"
                        ? "color-mix(in srgb, var(--color-added) 16%, transparent)"
                        : "color-mix(in srgb, var(--color-removed) 16%, transparent)",
                    borderTop:
                      band.kind === "added"
                        ? "1px solid color-mix(in srgb, var(--color-added) 70%, transparent)"
                        : "1px solid color-mix(in srgb, var(--color-removed) 70%, transparent)",
                    borderBottom:
                      band.kind === "added"
                        ? "1px solid color-mix(in srgb, var(--color-added) 70%, transparent)"
                        : "1px solid color-mix(in srgb, var(--color-removed) 70%, transparent)",
                  }}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
