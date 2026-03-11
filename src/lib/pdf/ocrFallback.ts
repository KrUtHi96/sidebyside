import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OCR_TEMP_ROOT = path.join(os.tmpdir(), "sidebyside-ocr");

export type OcrPageText = {
  page: number;
  text: string;
};

export type OcrFallbackResult = {
  available: boolean;
  pages: OcrPageText[];
  warnings: string[];
};

type ExecErrorWithCode = Error & { code?: string };

let missingBinaryPromise: Promise<string[]> | null = null;

const isMissingBinaryError = (error: unknown): error is ExecErrorWithCode =>
  error instanceof Error && (error as ExecErrorWithCode).code === "ENOENT";

const probeBinary = async (binary: string): Promise<boolean> => {
  try {
    await execFileAsync(binary, ["--version"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return true;
  } catch (error) {
    return !isMissingBinaryError(error);
  }
};

const getMissingBinaries = async (): Promise<string[]> => {
  if (!missingBinaryPromise) {
    missingBinaryPromise = (async () => {
      const [hasPdftoppm, hasTesseract] = await Promise.all([
        probeBinary("pdftoppm"),
        probeBinary("tesseract"),
      ]);

      const missing: string[] = [];
      if (!hasPdftoppm) {
        missing.push("pdftoppm");
      }
      if (!hasTesseract) {
        missing.push("tesseract");
      }
      return missing;
    })();
  }

  return missingBinaryPromise;
};

const extractPageNumber = (fileName: string): number => {
  const match = fileName.match(/-(\d+)\.png$/i);
  if (!match) {
    return Number.POSITIVE_INFINITY;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const cleanupDir = async (dirPath: string): Promise<void> => {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors in OCR temp dir.
  }
};

export const runOcrFallback = async (
  pdfBuffer: Uint8Array,
  language = "eng",
): Promise<OcrFallbackResult> => {
  const missingBinaries = await getMissingBinaries();
  if (missingBinaries.length > 0) {
    return {
      available: false,
      pages: [],
      warnings: [
        `OCR fallback unavailable: missing ${missingBinaries.join(", ")}. Install OCR tools (macOS: brew install poppler tesseract).`,
      ],
    };
  }

  const workDir = path.join(OCR_TEMP_ROOT, crypto.randomUUID());
  const inputPath = path.join(workDir, "input.pdf");
  const outputPrefix = path.join(workDir, "page");

  try {
    await fs.mkdir(workDir, { recursive: true });
    await fs.writeFile(inputPath, pdfBuffer);

    await execFileAsync("pdftoppm", ["-r", "200", "-png", inputPath, outputPrefix], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });

    const files = await fs.readdir(workDir);
    const imageFiles = files
      .filter((fileName) => /^page-\d+\.png$/i.test(fileName))
      .sort((left, right) => extractPageNumber(left) - extractPageNumber(right));

    if (imageFiles.length === 0) {
      return {
        available: true,
        pages: [],
        warnings: ["OCR fallback ran, but no rasterized page images were generated."],
      };
    }

    const pages: OcrPageText[] = [];
    for (const imageFile of imageFiles) {
      const page = extractPageNumber(imageFile);
      if (!Number.isFinite(page)) {
        continue;
      }

      const { stdout } = await execFileAsync(
        "tesseract",
        [path.join(workDir, imageFile), "stdout", "-l", language, "--psm", "6"],
        {
          encoding: "utf8",
          maxBuffer: 64 * 1024 * 1024,
        },
      );

      const text = typeof stdout === "string" ? stdout : String(stdout);
      pages.push({ page, text });
    }

    return {
      available: true,
      pages,
      warnings: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OCR failure.";
    return {
      available: true,
      pages: [],
      warnings: [`OCR fallback failed: ${message}`],
    };
  } finally {
    await cleanupDir(workDir);
  }
};
