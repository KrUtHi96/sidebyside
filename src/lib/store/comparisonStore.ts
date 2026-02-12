import fs from "node:fs";
import path from "node:path";
import type { ComparisonResult } from "@/types/comparison";

const GLOBAL_KEY = "__sidebysideComparisonStore__";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

type StoredComparison = {
  result: ComparisonResult;
  basePdfTempPath: string;
  comparedPdfTempPath: string;
  expiresAtMs: number;
};

type StoredComparisonState =
  | { state: "ok"; record: StoredComparison }
  | { state: "expired" }
  | { state: "missing" };

type ComparisonStore = Map<string, StoredComparison>;

type StoreContainer = {
  [GLOBAL_KEY]?: ComparisonStore;
};

const globalContainer = globalThis as typeof globalThis & StoreContainer;

if (!globalContainer[GLOBAL_KEY]) {
  globalContainer[GLOBAL_KEY] = new Map<string, StoredComparison>();
}

const store = globalContainer[GLOBAL_KEY] as ComparisonStore;

const removeFileSafe = (filePath: string) => {
  try {
    fs.rmSync(filePath, { force: true, recursive: true });
  } catch {
    // Ignore cleanup errors.
  }
};

const cleanupRecord = (record: StoredComparison) => {
  removeFileSafe(record.basePdfTempPath);
  removeFileSafe(record.comparedPdfTempPath);
  removeFileSafe(path.dirname(record.basePdfTempPath));
};

const isExpired = (record: StoredComparison): boolean => Date.now() >= record.expiresAtMs;

const resolveComparisonState = (id: string): StoredComparisonState => {
  const record = store.get(id);
  if (!record) {
    purgeExpiredComparisons();
    return { state: "missing" };
  }

  if (isExpired(record)) {
    cleanupRecord(record);
    store.delete(id);
    purgeExpiredComparisons();
    return { state: "expired" };
  }

  purgeExpiredComparisons();
  return { state: "ok", record };
};

export const purgeExpiredComparisons = (): void => {
  for (const [id, record] of store.entries()) {
    if (!isExpired(record)) {
      continue;
    }

    cleanupRecord(record);
    store.delete(id);
  }
};

export const getDefaultExpiryMs = (): number => Date.now() + TWO_HOURS_MS;

export const saveComparison = ({
  result,
  basePdfTempPath,
  comparedPdfTempPath,
  expiresAtMs,
}: StoredComparison): void => {
  purgeExpiredComparisons();
  store.set(result.id, {
    result,
    basePdfTempPath,
    comparedPdfTempPath,
    expiresAtMs,
  });
};

export const getStoredComparison = (id: string): StoredComparison | undefined => {
  const state = resolveComparisonState(id);
  return state.state === "ok" ? state.record : undefined;
};

export const getComparison = (id: string): ComparisonResult | undefined =>
  getStoredComparison(id)?.result;

export const getStoredComparisonState = (id: string): StoredComparisonState =>
  resolveComparisonState(id);
