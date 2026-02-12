import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";

const PORT = Number(process.env.PDF_SMOKE_PORT ?? 4311);
const START_TIMEOUT_MS = 90_000;
const ROOT_URL = `http://127.0.0.1:${PORT}`;

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const collapseWhitespace = (value) => value.replace(/\s+/g, " ").trim();

const escapePdfText = (value) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");

const buildSimplePdfBuffer = (
  lines,
  {
    fontSize = 12,
    lineHeight = 14,
    originX = 72,
    originY = 760,
  } = {},
) => {
  const content = ["BT", `/F1 ${fontSize} Tf`, `${lineHeight} TL`, `${originX} ${originY} Td`];

  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0) {
      content.push("T*");
    }

    content.push(`(${escapePdfText(lines[index])}) Tj`);
  }

  content.push("ET");
  const stream = Buffer.from(content.join("\n"), "latin1");

  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "ascii"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "ascii"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
      "ascii",
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, "ascii"),
      stream,
      Buffer.from("\nendstream", "ascii"),
    ]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", "ascii"),
  ];

  let output = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary");
  const offsets = [0];

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(output.length);
    output = Buffer.concat([
      output,
      Buffer.from(`${index + 1} 0 obj\n`, "ascii"),
      objects[index],
      Buffer.from("\nendobj\n", "ascii"),
    ]);
  }

  const xrefOffset = output.length;
  output = Buffer.concat([
    output,
    Buffer.from(`xref\n0 ${objects.length + 1}\n`, "ascii"),
    Buffer.from("0000000000 65535 f \n", "ascii"),
  ]);

  for (let index = 1; index < offsets.length; index += 1) {
    output = Buffer.concat([
      output,
      Buffer.from(`${offsets[index].toString().padStart(10, "0")} 00000 n \n`, "ascii"),
    ]);
  }

  output = Buffer.concat([
    output,
    Buffer.from("trailer\n", "ascii"),
    Buffer.from(`<< /Size ${objects.length + 1} /Root 1 0 R >>\n`, "ascii"),
    Buffer.from("startxref\n", "ascii"),
    Buffer.from(`${xrefOffset}\n`, "ascii"),
    Buffer.from("%%EOF\n", "ascii"),
  ]);

  return output;
};

const configurePdfJsWorker = () => {
  const candidatePaths = [
    path.join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
    path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.mjs"),
  ];

  const workerPath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (workerPath) {
    GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }
};

const extractPdfText = async (buffer) => {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    disableFontFace: true,
  });
  const document = await loadingTask.promise;
  const pageTexts = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = await page.getTextContent();
      const pageText = text.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");

      pageTexts.push(collapseWhitespace(pageText));
    }
  } finally {
    await loadingTask.destroy();
  }

  return collapseWhitespace(pageTexts.join(" "));
};

const waitForServer = async (child) => {
  const start = Date.now();
  while (Date.now() - start < START_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(`${ROOT_URL}/`);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry while server is starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for server on ${ROOT_URL}.`);
};

const postCompare = async (basePath, comparedPath) => {
  const baseBuffer = await readFile(basePath);
  const comparedBuffer = await readFile(comparedPath);
  const formData = new FormData();

  formData.set(
    "basePdf",
    new File([baseBuffer], path.basename(basePath), { type: "application/pdf" }),
  );
  formData.set(
    "comparePdf",
    new File([comparedBuffer], path.basename(comparedPath), { type: "application/pdf" }),
  );

  const response = await fetch(`${ROOT_URL}/api/compare`, {
    method: "POST",
    body: formData,
  });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(`Compare request failed (${response.status}): ${payload.error ?? "unknown error"}`);
  }

  return payload;
};

const exportPdf = async (comparisonId, granularity = "word") => {
  const response = await fetch(
    `${ROOT_URL}/api/compare/${comparisonId}/export?granularity=${granularity}`,
  );

  if (!response.ok) {
    let body = "";
    try {
      body = JSON.stringify(await response.json());
    } catch {
      body = await response.text();
    }

    throw new Error(`Export request failed (${response.status}): ${body}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  assert(contentType.includes("application/pdf"), "Export response is not a PDF.");

  return Buffer.from(await response.arrayBuffer());
};

const getPrimaryRows = (result) =>
  result.sections.find((section) => section.header === result.selectedSectionDefault)?.rows
  ?? result.sections[0]?.rows
  ?? [];

const run = async () => {
  configurePdfJsWorker();

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "sidebyside-pdf-smoke-"));
  const server = spawn("npm", ["run", "start", "--", "--port", String(PORT)], {
    stdio: "pipe",
    env: process.env,
  });

  server.stdout.on("data", (chunk) => process.stdout.write(chunk));
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForServer(server);

    const baseStandardPath = path.join(tempDir, "base-standard.pdf");
    const comparedStandardPath = path.join(tempDir, "compared-standard.pdf");
    await writeFile(
      baseStandardPath,
      buildSimplePdfBuffer([
        "1. Base framework applies to consumer credit products.",
        "2(a) Institutions must retain records for five years.",
        "3. Notices must be delivered in writing.",
      ]),
    );
    await writeFile(
      comparedStandardPath,
      buildSimplePdfBuffer([
        "1. Base framework applies to consumer lending products.",
        "2(a) Institutions must retain records for seven years.",
        "4. Digital notices are permitted with consent.",
      ]),
    );

    const standard = await postCompare(baseStandardPath, comparedStandardPath);
    assert(standard.summary.totalRows === 4, "Standard scenario should produce 4 rows.");

    const standardRows = getPrimaryRows(standard.result);
    const statusByKey = Object.fromEntries(
      standardRows.map((row) => [row.key, row.status]),
    );
    assert(statusByKey["1"] === "changed", "Paragraph 1 should be changed.");
    assert(statusByKey["2(a)"] === "changed", "Paragraph 2(a) should be changed.");
    assert(statusByKey["3"] === "removed", "Paragraph 3 should be removed.");
    assert(statusByKey["4"] === "added", "Paragraph 4 should be added.");

    const standardPdf = await exportPdf(standard.comparisonId, "word");
    const standardText = await extractPdfText(standardPdf);
    assert(
      standardText.includes("Framework Comparison Report"),
      "Export missing summary report title.",
    );

    const invalidGranularityPdf = await exportPdf(standard.comparisonId, "invalid");
    const invalidGranularityText = await extractPdfText(invalidGranularityPdf);
    assert(
      invalidGranularityText.includes("Framework Comparison Report"),
      "Invalid granularity fallback did not return report PDF.",
    );

    const baseDuplicatePath = path.join(tempDir, "base-duplicate.pdf");
    const comparedDuplicatePath = path.join(tempDir, "compared-duplicate.pdf");
    await writeFile(
      baseDuplicatePath,
      buildSimplePdfBuffer([
        "Preface line without paragraph key.",
        "1. First version text.",
        "1. Duplicate first paragraph in base.",
        "2) Shared section text.",
      ]),
    );
    await writeFile(
      comparedDuplicatePath,
      buildSimplePdfBuffer([
        "1. Updated first section text.",
        "2) Shared section text.",
      ]),
    );

    const duplicate = await postCompare(baseDuplicatePath, comparedDuplicatePath);
    const duplicateRows = getPrimaryRows(duplicate.result);
    const paragraphOne = duplicateRows.find((row) => row.key === "1");
    assert(paragraphOne?.status === "ambiguous", "Duplicate key scenario should be ambiguous.");

    const duplicatePdf = await exportPdf(duplicate.comparisonId, "sentence");
    const duplicateText = await extractPdfText(duplicatePdf);
    assert(
      duplicateText.includes("Framework Comparison Report"),
      "Duplicate export missing summary title.",
    );
    assert(
      duplicatePdf.byteLength > 1_000,
      "Duplicate export appears unexpectedly small.",
    );

    const baseLongPath = path.join(tempDir, "base-long.pdf");
    const comparedLongPath = path.join(tempDir, "compared-long.pdf");
    const baseLongLines = ["1. Long-form paragraph content starts here."];
    const comparedLongLines = ["1. Long-form paragraph content starts here."];

    for (let line = 1; line <= 70; line += 1) {
      baseLongLines.push(
        `continuation base line ${line} with compliance obligations and disclosures.`,
      );
      comparedLongLines.push(
        `continuation compared line ${line} with compliance obligations and disclosures.`,
      );
    }

    await writeFile(
      baseLongPath,
      buildSimplePdfBuffer(baseLongLines, { fontSize: 8, lineHeight: 8 }),
    );
    await writeFile(
      comparedLongPath,
      buildSimplePdfBuffer(comparedLongLines, { fontSize: 8, lineHeight: 8 }),
    );

    const longCase = await postCompare(baseLongPath, comparedLongPath);
    const longRows = getPrimaryRows(longCase.result);
    const longRow = longRows.find((row) => row.key === "1");
    assert(longRow, "Long scenario should include paragraph 1.");
    assert(
      longRow.base?.textPreserved.includes("line 60"),
      "Long scenario setup failed: base compare payload missing expected tail text.",
    );

    const longPdf = await exportPdf(longCase.comparisonId, "word");
    const longText = await extractPdfText(longPdf);
    assert(
      longText.includes("Framework Comparison Report"),
      "Long-case export missing summary title.",
    );
    assert(longPdf.byteLength > 1_000, "Long-case export appears unexpectedly small.");

    console.log("PDF export smoke test passed.");
  } finally {
    server.kill("SIGTERM");
    await rm(tempDir, { recursive: true, force: true });
  }
};

run().catch((error) => {
  console.error(`PDF export smoke test failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
