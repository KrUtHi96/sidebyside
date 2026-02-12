import {
  diffSentences,
  diffTrimmedLines,
  diffWordsWithSpace,
  type Change,
} from "diff";
import type { DiffToken } from "@/types/comparison";

const mapChanges = (changes: Change[]): DiffToken[] =>
  changes.map((change) => ({
    value: change.value,
    kind: change.added ? "added" : change.removed ? "removed" : "equal",
  }));

const normalizeHorizontalWhitespace = (value: string): string =>
  value.replace(/[ \t]+/g, " ");

const isWhitespaceNoiseOnly = (a: string, b: string): boolean =>
  a !== b &&
  normalizeHorizontalWhitespace(a) === normalizeHorizontalWhitespace(b);

const collapseWhitespaceNoiseTokens = (tokens: DiffToken[]): DiffToken[] => {
  const normalizedTokens = tokens.map((token) => {
    if (token.kind !== "equal" && /^[ \t]+$/.test(token.value)) {
      return { ...token, kind: "equal" as const };
    }

    return token;
  });

  const merged: DiffToken[] = [];

  for (let index = 0; index < normalizedTokens.length; index += 1) {
    const current = normalizedTokens[index];
    const next = normalizedTokens[index + 1];

    if (current.kind === "removed" && next?.kind === "added") {
      if (isWhitespaceNoiseOnly(current.value, next.value)) {
        merged.push({ kind: "equal", value: next.value });
        index += 1;
        continue;
      }
    }

    if (current.kind === "added" && next?.kind === "removed") {
      if (isWhitespaceNoiseOnly(next.value, current.value)) {
        merged.push({ kind: "equal", value: current.value });
        index += 1;
        continue;
      }
    }

    merged.push(current);
  }

  const collapsed: DiffToken[] = [];
  for (const token of merged) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.kind === token.kind) {
      previous.value += token.value;
      continue;
    }
    collapsed.push({ ...token });
  }

  return collapsed;
};

export const buildWordDiff = (base: string, compared: string): DiffToken[] =>
  collapseWhitespaceNoiseTokens(mapChanges(diffWordsWithSpace(base, compared)));

export const buildSentenceDiff = (base: string, compared: string): DiffToken[] =>
  isWhitespaceNoiseOnly(base, compared)
    ? [{ value: compared, kind: "equal" }]
    : mapChanges(diffSentences(base, compared));

export const buildParagraphDiff = (base: string, compared: string): DiffToken[] => {
  if (isWhitespaceNoiseOnly(base, compared)) {
    return [{ value: compared, kind: "equal" }];
  }

  if (base.trim() === compared.trim()) {
    return [{ value: base, kind: "equal" }];
  }

  const changes = diffTrimmedLines(base, compared);
  if (changes.length > 0) {
    return mapChanges(changes);
  }

  return [
    { value: base, kind: "removed" },
    { value: compared, kind: "added" },
  ];
};
