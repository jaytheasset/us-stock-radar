import { createHash } from "node:crypto";

export const SEC_13F_OFFICIAL_LIST_PARSER_VERSION = "sec-13f-official-list-fixed-width-v1";
export const SEC_13F_OFFICIAL_LIST_INDEX_URL =
  "https://www.sec.gov/rules-regulations/staff-guidance/official-list-section-13f-securities";

export type Sec13fOfficialListEntry = Readonly<{
  lineNumber: number;
  cusip: string;
  optionIndicator: " " | "*";
  issuerName: string;
  securityDescription: string;
  statusRaw: "   " | "*A*" | "*D*";
  status: "unchanged" | "added" | "deleted";
  rawLine: string;
}>;

export type Sec13fOfficialListSnapshot = Readonly<{
  quarter: string;
  quarterEnd: string;
  sourceUrl: string;
  sourceSha256: string;
  sourceBytes: Uint8Array;
  fetchedAt: string;
  parserVersion: typeof SEC_13F_OFFICIAL_LIST_PARSER_VERSION;
  entries: readonly Sec13fOfficialListEntry[];
}>;

const OFFICIAL_TXT_URL = /^https:\/\/www\.sec\.gov\/files\/investment\/13flist(\d{4})q([1-4])(?:-txt)?\.txt$/;

export function officialListQuarterFromUrl(sourceUrl: string): string {
  const match = OFFICIAL_TXT_URL.exec(sourceUrl);
  if (!match) throw new Error("Expected an SEC Official List quarterly TXT URL");
  return `${match[1]}Q${match[2]}`;
}

export function parseSec13fOfficialList(input: {
  sourceUrl: string;
  sourceBytes: Uint8Array;
  fetchedAt: string;
  expectedQuarter?: string;
}): Sec13fOfficialListSnapshot {
  const quarter = officialListQuarterFromUrl(input.sourceUrl);
  if (input.expectedQuarter && input.expectedQuarter !== quarter) {
    throw new Error(`SEC Official List quarter mismatch: expected ${input.expectedQuarter}, got ${quarter}`);
  }
  if (!Number.isFinite(Date.parse(input.fetchedAt))) throw new Error("Invalid SEC Official List fetch time");
  const sourceBytes = Uint8Array.from(input.sourceBytes);
  if (!sourceBytes.length || sourceBytes.some((byte) => byte > 127)) {
    throw new Error("SEC Official List source must be nonempty fixed-width ASCII");
  }
  const text = new TextDecoder("ascii").decode(sourceBytes);
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length) throw new Error("SEC Official List contains no entries");

  const entries = lines.map((rawLine, index): Sec13fOfficialListEntry => {
    const lineNumber = index + 1;
    if (rawLine.length !== 80) throw new Error(`Invalid SEC Official List line width at ${lineNumber}`);
    const cusip = rawLine.slice(0, 9);
    const optionIndicator = rawLine.slice(9, 10);
    const issuerName = rawLine.slice(10, 40).trim();
    const securityDescription = rawLine.slice(40, 67).trim();
    const statusRaw = rawLine.slice(67, 70);
    if (!/^[A-Z0-9]{9}$/.test(cusip) || (optionIndicator !== " " && optionIndicator !== "*")
      || !["   ", "*A*", "*D*"].includes(statusRaw)) {
      throw new Error(`Invalid SEC Official List fields at line ${lineNumber}`);
    }
    return {
      lineNumber, cusip, optionIndicator, issuerName, securityDescription,
      statusRaw: statusRaw as Sec13fOfficialListEntry["statusRaw"],
      status: statusRaw === "*A*" ? "added" : statusRaw === "*D*" ? "deleted" : "unchanged",
      rawLine,
    };
  });

  const year = Number(quarter.slice(0, 4));
  const quarterNumber = Number(quarter.slice(-1));
  const quarterEnd = new Date(Date.UTC(year, quarterNumber * 3, 0)).toISOString().slice(0, 10);
  return {
    quarter, quarterEnd, sourceUrl: input.sourceUrl,
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    sourceBytes, fetchedAt: new Date(input.fetchedAt).toISOString(),
    parserVersion: SEC_13F_OFFICIAL_LIST_PARSER_VERSION, entries,
  };
}
