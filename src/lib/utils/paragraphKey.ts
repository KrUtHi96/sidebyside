export const PARAGRAPH_START_REGEX =
  /^\s*((?:\d+(?:\.\d+)*)(?:\([A-Za-z0-9ivxIVX]+\))*)[.)]?\s*(.*)$/;

export const normalizeParagraphKey = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, "")
    .replace(/\.$/, "")
    .toLowerCase();

export const naturalParagraphSort = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
