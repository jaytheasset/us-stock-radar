import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { SecRequestPolicy } from "../sec-structured-data/secRequestPolicy.ts";

export const SEC_13F_2025Q3_PDF_URL = "https://www.sec.gov/files/investment/13flist2025q3.pdf";
export const SEC_13F_2025Q3_PDF_PARSER_VERSION = "sec-13f-official-list-2025q3-pdf-v1";
const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

type PdfTextCell = { x: number; text: string };

export type Sec13f2025Q3PdfEntry = Readonly<{
  lineNumber: number;
  sourcePage: number;
  cusip: string;
  optionIndicator: " " | "*";
  issuerName: string;
  securityDescription: string;
  statusRaw: "" | "ADDED" | "DELETED";
  status: "unchanged" | "added" | "deleted";
  rawLine: string;
}>;

export type Sec13f2025Q3PdfSnapshot = Readonly<{
  quarter: "2025Q3";
  quarterEnd: "2025-09-30";
  sourceFormat: "pdf";
  sourceUrl: typeof SEC_13F_2025Q3_PDF_URL;
  sourceSha256: string;
  sourceBytes: Uint8Array;
  fetchedAt: string;
  parserVersion: typeof SEC_13F_2025Q3_PDF_PARSER_VERSION;
  entries: readonly Sec13f2025Q3PdfEntry[];
}>;

/** The PDF has four fixed-position columns; its text is not an 80-column TXT line. */
export function parseSec13f2025Q3PdfRow(
  cells: readonly PdfTextCell[], sourcePage: number, lineNumber: number,
): Sec13f2025Q3PdfEntry {
  const columns: string[][] = [[], [], [], []];
  for (const cell of [...cells].sort((a, b) => a.x - b.x)) {
    if (!cell.text.trim()) continue;
    const column = cell.x < 160 ? 0 : cell.x < 345 ? 1 : cell.x < 480 ? 2 : 3;
    columns[column].push(cell.text.trim());
  }
  const [cusipText, issuerName, securityDescription, statusText] = columns.map((column) => column.join(" "));
  const cusipMatch = /^([A-Z0-9]{6}) ([A-Z0-9]{2}) ([A-Z0-9])( \*)?$/.exec(cusipText);
  if (!cusipMatch || !issuerName || !securityDescription
    || !["", "ADDED", "DELETED"].includes(statusText)) {
    throw new Error(`Invalid SEC 2025 Q3 PDF row on page ${sourcePage}, entry ${lineNumber}`);
  }
  const statusRaw = statusText as Sec13f2025Q3PdfEntry["statusRaw"];
  return {
    lineNumber, sourcePage,
    cusip: cusipMatch.slice(1, 4).join(""),
    optionIndicator: cusipMatch[4] ? "*" : " ",
    issuerName, securityDescription, statusRaw,
    status: statusRaw === "ADDED" ? "added" : statusRaw === "DELETED" ? "deleted" : "unchanged",
    rawLine: [cusipText, issuerName, securityDescription, statusText].filter(Boolean).join(" "),
  };
}

export async function parseSec13f2025Q3Pdf(input: {
  sourceBytes: Uint8Array;
  fetchedAt: string;
}): Promise<Sec13f2025Q3PdfSnapshot> {
  const sourceBytes = Uint8Array.from(input.sourceBytes);
  if (sourceBytes.length < 5 || sourceBytes.length > MAX_SOURCE_BYTES
    || Buffer.from(sourceBytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    throw new Error("SEC 2025 Q3 Official List source must be a PDF within the size limit");
  }
  if (!Number.isFinite(Date.parse(input.fetchedAt))) throw new Error("Invalid SEC PDF fetch time");

  const loadingTask = getDocument({ data: Uint8Array.from(sourceBytes), useSystemFonts: true });
  try {
    const document = await loadingTask.promise;
    if (document.numPages < 3) throw new Error("SEC 2025 Q3 PDF has no table pages");
    const cover = await (await document.getPage(1)).getTextContent();
    const introduction = await (await document.getPage(2)).getTextContent();
    const coverText = cover.items.map((item) => "str" in item ? item.str : "").join(" ");
    const introductionText = introduction.items.map((item) => "str" in item ? item.str : "")
      .join(" ").replace(/\s+/g, " ");
    if (!coverText.includes("List of Section 13F Securities") || !coverText.includes("Third")
      || !introductionText.includes("September 30, 2025")) {
      throw new Error("SEC PDF title or report quarter does not identify 2025 Q3");
    }

    const entries: Sec13f2025Q3PdfEntry[] = [];
    let declaredTotal: number | null = null;
    for (let sourcePage = 3; sourcePage <= document.numPages; sourcePage += 1) {
      const page = await document.getPage(sourcePage);
      const content = await page.getTextContent();
      const rows = new Map<number, PdfTextCell[]>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] * 10) / 10;
        const row = rows.get(y) ?? [];
        row.push({ x: item.transform[4], text: item.str });
        rows.set(y, row);
      }
      const orderedRows = [...rows.entries()].sort((a, b) => b[0] - a[0]);
      const rowText = (cells: readonly PdfTextCell[]) => cells.map((cell) => cell.text).join(" ");
      if (!orderedRows[0] || !rowText(orderedRows[0][1]).includes(`Page ${sourcePage - 2}`)
        || !orderedRows[1] || !rowText(orderedRows[1][1]).includes("Year: 2025 Qtr: 3")
        || !orderedRows[2] || !rowText(orderedRows[2][1]).includes("CUSIP NO")
        || !rowText(orderedRows[2][1]).includes("ISSUER DESCRIPTION")) {
        throw new Error(`SEC 2025 Q3 PDF table header mismatch on page ${sourcePage}`);
      }
      for (const [, cells] of orderedRows.slice(3)) {
        const text = rowText(cells);
        const total = /^Total Count: ([\d,]+)$/.exec(text.trim());
        if (total) {
          if (sourcePage !== document.numPages || declaredTotal !== null) {
            throw new Error("SEC 2025 Q3 PDF total count is misplaced or repeated");
          }
          declaredTotal = Number(total[1].replaceAll(",", ""));
          continue;
        }
        entries.push(parseSec13f2025Q3PdfRow(cells, sourcePage, entries.length + 1));
      }
      page.cleanup();
    }
    if (declaredTotal === null || declaredTotal !== entries.length) {
      throw new Error(`SEC 2025 Q3 PDF row count differs from printed total: ${entries.length} / ${declaredTotal}`);
    }
    return {
      quarter: "2025Q3", quarterEnd: "2025-09-30", sourceFormat: "pdf",
      sourceUrl: SEC_13F_2025Q3_PDF_URL,
      sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
      sourceBytes, fetchedAt: new Date(input.fetchedAt).toISOString(),
      parserVersion: SEC_13F_2025Q3_PDF_PARSER_VERSION, entries,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function fetchSec13f2025Q3Pdf(input: {
  userAgent: string;
  requestPolicy?: SecRequestPolicy;
}): Promise<Sec13f2025Q3PdfSnapshot> {
  const policy = input.requestPolicy ?? new SecRequestPolicy(input.userAgent);
  const response = await policy.fetch(SEC_13F_2025Q3_PDF_URL, { headers: { Accept: "application/pdf" } });
  if (!response.ok) throw new Error(`SEC 2025 Q3 PDF request failed (${response.status})`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    await response.body?.cancel();
    throw new Error("SEC 2025 Q3 PDF source is unexpectedly large");
  }
  const sourceBytes = new Uint8Array(await response.arrayBuffer());
  return parseSec13f2025Q3Pdf({ sourceBytes, fetchedAt: new Date().toISOString() });
}
