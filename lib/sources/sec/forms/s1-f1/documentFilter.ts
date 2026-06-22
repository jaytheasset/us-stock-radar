import {
  type ConfidenceLevel,
  type S1F1DocumentBlock,
  type S1F1DocumentBucket,
  type S1F1DocumentFilterItem,
  type S1F1DocumentFilterSummary,
  type S1F1DocumentKind,
  type S1F1DocumentTable,
  type S1F1MainDocumentSelection,
} from "./types.ts";

const BODY_TYPES = new Set(["S-1", "S-1/A", "F-1", "F-1/A", "POS AM", "S-1MEF", "F-1MEF"]);
const NOISE_TYPES = [/^GRAPHIC$/i, /^XML$/i, /^JSON$/i, /^ZIP$/i, /^EX-101/i, /^EX-23/i, /^EX-24/i, /^EX-21/i];
const NOISE_EXTENSIONS = /\.(jpg|jpeg|png|gif|css|js|zip|xsd)$/i;

const IMPORTANT_TYPES = [/^EX-FILING FEES$/i, /^EX-107$/i, /^EX-1\.1/i, /^EX-4/i, /^EX-5/i];
const IMPORTANT_TEXT_HINTS =
  /underwriting|filing fee|fee table|warrant|rights agreement|registration rights|lock-?up|depositary|indenture|convertible|preferred stock|ordinary shares?|purchase agreement|merger agreement|business combination/i;
const EX_3_IMPORTANT_HINTS =
  /authorized (?:capital )?(?:stock|shares)|blank check preferred|preferred stock|class [ab] (?:common )?stock|ordinary shares?|voting rights?|conversion rights?|rights, preferences|reverse split|share capital|memorandum and articles|articles of association/i;
const EX_10_IMPORTANT_HINTS =
  /lock-?up|registration rights|investors?' rights|stockholders?' agreement|shareholders?' agreement|voting agreement|support agreement|subscription agreement|securities purchase|share purchase|stock purchase|warrant|convertible (?:note|security|securities)|note purchase|private placement|PIPE|forward purchase|resale rights|selling (?:stockholder|shareholder)/i;
const EX_10_NOISE_HINTS =
  /employment agreement|offer letter|consulting agreement|indemnification agreement|incentive plan|stock option plan|restricted stock unit|rsu|lease agreement|credit agreement|loan agreement|promissory note|tax receivable agreement/i;
const MAIN_DOCUMENT_TEXT_HINTS =
  /registration statement|prospectus|risk factors|use of proceeds|description of securities|underwriting|plan of distribution/i;

interface SubmissionDocument {
  sequence: number | null;
  type: string;
  filename: string | null;
  description: string | null;
  sourceText: string;
  text: string;
}

export interface S1F1DocumentFilterResult {
  text: string;
  summary: S1F1DocumentFilterSummary;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;|&#8217;|&#x2019;/gi, "'")
    .replace(/&lsquo;|&#8216;|&#x2018;/gi, "'")
    .replace(/&ldquo;|&#8220;|&#x201c;/gi, '"')
    .replace(/&rdquo;|&#8221;|&#x201d;/gi, '"')
    .replace(/&mdash;|&#8212;|&#x2014;/gi, "-")
    .replace(/&ndash;|&#8211;|&#x2013;/gi, "-")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeLines(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function removeHiddenHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<([a-z][\w:-]*)(?=[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all))[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<input[^>]*type\s*=\s*['"]?hidden['"]?[^>]*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ");
}

function inlineText(value: string): string {
  return compact(
    decodeEntities(
      removeHiddenHtml(value)
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<\/(p|div|section|article|h[1-6]|li|tr)>/gi, " ")
        .replace(/<\/(td|th)>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function parseTableRows(tableHtml: string): string[][] {
  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((rowMatch) =>
      [...rowMatch[1].matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
        .map((cellMatch) => inlineText(cellMatch[2]))
        .filter((cell) => cell.length > 0),
    )
    .filter((row) => row.length > 0);

  if (rows.length > 0) return rows;

  const cells = [...tableHtml.matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    .map((cellMatch) => inlineText(cellMatch[2]))
    .filter((cell) => cell.length > 0);
  return cells.length ? [cells] : [];
}

function tableToText(tableHtml: string): string {
  return parseTableRows(tableHtml)
    .map((row) => row.join(" | "))
    .join("\n");
}

function toPlainText(value: string): string {
  const hiddenRemoved = removeHiddenHtml(value).replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (tableHtml) => {
    const tableText = tableToText(tableHtml);
    return tableText ? `\n${tableText}\n` : " ";
  });
  const withBreaks = hiddenRemoved
    .replace(/<\/(p|div|section|article|h[1-6]|li|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, " ");

  return normalizeLines(decodeEntities(withBreaks));
}

function attrValue(attrs: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = attrs.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function isAllCapsText(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters === letters.toUpperCase();
}

function isTitleCaseText(text: string): boolean {
  const words = text.split(/\s+/).filter((word) => /[A-Za-z]/.test(word));
  if (words.length === 0 || words.length > 16) return false;
  const titleWords = words.filter((word) => /^[A-Z][a-z0-9,'&-]*$/.test(word) || /^(of|and|or|the|to|for|in|with|a|an)$/i.test(word));
  return titleWords.length / words.length >= 0.8;
}

function styleHints(attrs: string, innerHtml = ""): string[] {
  const hints = new Set<string>();
  const style = `${attrValue(attrs, "style") ?? ""} ${innerHtml}`.toLowerCase();
  if (/font-weight\s*:\s*(bold|[6-9]00)|<(b|strong)\b/i.test(style)) hints.add("bold");
  if (/font-style\s*:\s*italic|<(i|em)\b/i.test(style)) hints.add("italic");
  if (/text-align\s*:\s*center|align\s*=\s*['"]?center/i.test(`${attrs} ${innerHtml}`)) hints.add("centered");
  if (/font-size\s*:\s*[^;]+/.test(style)) hints.add("font-size");
  if (/text-transform\s*:\s*uppercase/.test(style)) hints.add("uppercase");
  return [...hints];
}

function anchorHint(attrs: string, innerHtml: string): string | null {
  return (
    attrValue(attrs, "id") ??
    attrValue(attrs, "name") ??
    innerHtml.match(/<a\b[^>]*(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[1] ??
    innerHtml.match(/<a\b[^>]*(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[2] ??
    innerHtml.match(/<a\b[^>]*(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i)?.[3] ??
    null
  );
}

function hasHtmlTags(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

function makeBlock(params: {
  order: number;
  document: Pick<SubmissionDocument, "sequence" | "type" | "filename">;
  tag: string;
  attrs?: string;
  innerHtml?: string;
  text: string;
  insideTable?: boolean;
  isTableHeaderCell?: boolean;
  isTableRowLabel?: boolean;
  tableId?: number | null;
  rowIndex?: number | null;
  cellIndex?: number | null;
}): S1F1DocumentBlock {
  const attrs = params.attrs ?? "";
  const innerHtml = params.innerHtml ?? "";
  const hints = styleHints(attrs, innerHtml);
  const tag = params.tag.toLowerCase();
  const isHeadingTag = /^h[1-4]$/.test(tag);
  const text = compact(params.text);
  const centered = tag === "center" || hints.includes("centered");
  const bold = isHeadingTag || tag === "b" || tag === "strong" || hints.includes("bold");
  const italic = tag === "i" || tag === "em" || hints.includes("italic");

  return {
    order: params.order,
    documentSequence: params.document.sequence,
    documentType: params.document.type,
    filename: params.document.filename,
    tag,
    text,
    isBold: bold,
    isItalic: italic,
    isCentered: centered,
    isAllCaps: isAllCapsText(text) || hints.includes("uppercase"),
    isTitleCase: isTitleCaseText(text),
    isStandalone: text.length <= 220,
    insideTable: Boolean(params.insideTable),
    isTableHeaderCell: Boolean(params.isTableHeaderCell),
    isTableRowLabel: Boolean(params.isTableRowLabel),
    anchorHint: anchorHint(attrs, innerHtml),
    styleHints: hints,
    tableId: params.tableId ?? null,
    rowIndex: params.rowIndex ?? null,
    cellIndex: params.cellIndex ?? null,
  };
}

function parseTable(
  tableHtml: string,
  document: Pick<SubmissionDocument, "sequence" | "type" | "filename">,
  id: number,
  order: number,
): { table: S1F1DocumentTable | null; blocks: S1F1DocumentBlock[] } {
  const rows = parseTableRows(tableHtml);
  if (rows.length === 0) return { table: null, blocks: [] };

  const caption = inlineText(tableHtml.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i)?.[1] ?? "");
  const rowHtml = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  const headerRows = rowHtml
    .map((row, index) => ({ row, index }))
    .filter(({ row, index }) => index === 0 && /<th\b/i.test(row))
    .map(({ index }) => rows[index])
    .filter(Boolean);
  const tableText = rows.map((row) => row.join(" | ")).join("\n");
  const blocks: S1F1DocumentBlock[] = [
    makeBlock({
      order,
      document,
      tag: "table",
      text: tableText,
      insideTable: true,
      isTableHeaderCell: false,
      isTableRowLabel: false,
      tableId: id,
    }),
  ];

  rowHtml.forEach((row, rowIndex) => {
    const cells = [...row.matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)];
    cells.forEach((cell, cellIndex) => {
      const cellText = inlineText(cell[3]);
      if (!cellText) return;
      blocks.push(
        makeBlock({
          order: order + blocks.length,
          document,
          tag: `t${cell[1].toLowerCase()}`,
          attrs: cell[2],
          innerHtml: cell[3],
          text: cellText,
          insideTable: true,
          isTableHeaderCell: cell[1].toLowerCase() === "h" || rowIndex === 0,
          isTableRowLabel: cellIndex === 0 && rows[rowIndex]?.length > 1,
          tableId: id,
          rowIndex,
          cellIndex,
        }),
      );
    });
  });

  return {
    table: {
      id,
      order,
      documentSequence: document.sequence,
      documentType: document.type,
      filename: document.filename,
      caption: caption || null,
      headerRows,
      rows,
      text: tableText,
    },
    blocks,
  };
}

function extractDocumentBlocks(
  sourceHtml: string,
  document: Pick<SubmissionDocument, "sequence" | "type" | "filename">,
  startOrder: number,
  startTableId: number,
): {
  blocks: S1F1DocumentBlock[];
  tables: S1F1DocumentTable[];
  nextOrder: number;
  nextTableId: number;
} {
  if (!hasHtmlTags(sourceHtml)) {
    return { blocks: [], tables: [], nextOrder: startOrder, nextTableId: startTableId };
  }

  const blocks: S1F1DocumentBlock[] = [];
  const tables: S1F1DocumentTable[] = [];
  let order = startOrder;
  let tableId = startTableId;
  const html = removeHiddenHtml(sourceHtml);
  const pattern =
    /<table\b[^>]*>[\s\S]*?<\/table>|<(h[1-4]|p|div|span|font|center|li|b|strong|em|i)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

  for (const match of html.matchAll(pattern)) {
    const raw = match[0];
    if (/^<table\b/i.test(raw)) {
      const parsed = parseTable(raw, document, tableId, order);
      if (parsed.table) {
        tables.push(parsed.table);
        blocks.push(...parsed.blocks);
        order += parsed.blocks.length;
        tableId += 1;
      }
      continue;
    }

    const tag = match[1] ?? "";
    const attrs = match[2] ?? "";
    const inner = match[3] ?? "";
    const text = inlineText(inner);
    if (!text) continue;
    blocks.push(makeBlock({ order, document, tag, attrs, innerHtml: inner, text }));
    order += 1;
  }

  return { blocks, tables, nextOrder: order, nextTableId: tableId };
}

function field(block: string, name: string): string | null {
  return block.match(new RegExp(`<${name}>([^\\r\\n<]*)`, "i"))?.[1]?.trim() ?? null;
}

function extractText(block: string): string {
  return block.match(/<TEXT>([\s\S]*?)<\/TEXT>/i)?.[1] ?? block;
}

function parseSequence(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseSubmissionDocuments(sourceText: string): SubmissionDocument[] {
  return [...sourceText.matchAll(/<DOCUMENT>([\s\S]*?)<\/DOCUMENT>/gi)].map((match) => {
    const block = match[1];
    const textSource = extractText(block);
    return {
      sequence: parseSequence(field(block, "SEQUENCE")),
      type: (field(block, "TYPE") ?? "UNKNOWN").toUpperCase(),
      filename: field(block, "FILENAME"),
      description: field(block, "DESCRIPTION"),
      sourceText: textSource,
      text: toPlainText(textSource),
    };
  });
}

function normalizeFormType(value: string): string {
  return compact(value).toUpperCase();
}

function isHtmlFilename(filename: string | null): boolean {
  return Boolean(filename && /\.x?html?$/i.test(filename));
}

function formFamilyPattern(formType: string): RegExp {
  return normalizeFormType(formType).startsWith("F-1")
    ? /(?:^|[^a-z0-9])f-?1(?:a|_a|-a)?(?:[^a-z0-9]|$)|form\s*f-?1/i
    : /(?:^|[^a-z0-9])s-?1(?:a|_a|-a)?(?:[^a-z0-9]|$)|form\s*s-?1/i;
}

function scoreMainDocumentCandidate(
  document: SubmissionDocument,
  formType: string,
  primaryDocument: string | null | undefined,
): { score: number; reason: string; confidence: ConfidenceLevel } | null {
  const normalizedForm = normalizeFormType(formType);
  const type = document.type.toUpperCase();
  const filename = document.filename ?? "";
  const label = `${type} ${filename} ${document.description ?? ""}`;
  const formPattern = formFamilyPattern(formType);

  if (primaryDocument && filename === primaryDocument) {
    return { score: 115, reason: "primary document filename matched runtime metadata", confidence: "high" };
  }

  if (type === normalizedForm && BODY_TYPES.has(type)) {
    return { score: 110, reason: "document type exactly matches requested form", confidence: "high" };
  }

  if (BODY_TYPES.has(type)) {
    return { score: 100, reason: "document type is an S-1/F-1 family filing", confidence: "high" };
  }

  if (isHtmlFilename(document.filename) && formPattern.test(label)) {
    return { score: 80, reason: "HTML filename or description strongly indicates the target form", confidence: "medium" };
  }

  if (isHtmlFilename(document.filename) && MAIN_DOCUMENT_TEXT_HINTS.test(document.text)) {
    const lengthScore = Math.min(20, Math.floor(document.text.length / 25_000));
    return {
      score: 55 + lengthScore,
      reason: "largest plausible HTML document contains registration-statement or prospectus sections",
      confidence: "low",
    };
  }

  return null;
}

function selectMainDocument(
  documents: SubmissionDocument[],
  formType: string,
  primaryDocument: string | null | undefined,
): { selection: S1F1MainDocumentSelection | null; warnings: string[] } {
  const scored = documents
    .map((document) => {
      const score = scoreMainDocumentCandidate(document, formType, primaryDocument);
      return score ? { document, ...score } : null;
    })
    .filter((item): item is { document: SubmissionDocument; score: number; reason: string; confidence: ConfidenceLevel } =>
      Boolean(item),
    )
    .sort((a, b) => b.score - a.score || b.document.text.length - a.document.text.length);

  if (scored.length === 0) {
    return {
      selection: null,
      warnings: ["No plausible S-1/F-1 main document candidate was identified."],
    };
  }

  const best = scored[0];
  const closeCandidates = scored.filter((item) => item.score >= best.score - 5);
  const warnings =
    closeCandidates.length > 1
      ? [
          `Multiple plausible S-1/F-1 main document candidates found (${closeCandidates.length}); selected the highest-scoring/largest candidate and preserved candidate metadata.`,
        ]
      : [];

  return {
    selection: {
      sequence: best.document.sequence,
      type: best.document.type,
      filename: best.document.filename,
      description: best.document.description,
      reason: best.reason,
      confidence: closeCandidates.length > 1 ? "medium" : best.confidence,
      candidateCount: scored.length,
    },
    warnings,
  };
}

function isSelectedMainDocument(document: SubmissionDocument, mainDocument: S1F1MainDocumentSelection | null): boolean {
  if (!mainDocument) return false;
  if (document.sequence != null && mainDocument.sequence != null) return document.sequence === mainDocument.sequence;
  return Boolean(document.filename && document.filename === mainDocument.filename && document.type === mainDocument.type);
}

function classifyDocumentKind(document: SubmissionDocument, isMainDocument: boolean): S1F1DocumentKind {
  if (isMainDocument) return "main_filing";

  const type = document.type.toUpperCase();
  const haystack = `${type} ${document.filename ?? ""} ${document.description ?? ""} ${document.text.slice(0, 2_000)}`;

  if (/^EX-FILING FEES$/i.test(type) || /^EX-107(?:\.|\b)/i.test(type) || /filing fee|fee table/i.test(haystack)) {
    return "filing_fee_exhibit";
  }
  if (/^EX-8(?:\.|\b)/i.test(type) || /tax opinion|opinion as to tax|material tax consequences/i.test(haystack)) {
    return "tax_opinion";
  }
  if (/^EX-5(?:\.|\b)/i.test(type) || /legal opinion|opinion of counsel|validity of the securities/i.test(haystack)) {
    return "legal_opinion";
  }
  if (/^EX-23(?:\.|\b)/i.test(type) || /consent of independent|auditor consent|registered public accounting firm/i.test(haystack)) {
    return "auditor_consent";
  }
  if (/consent of counsel|legal consent/i.test(haystack)) {
    return "legal_consent";
  }
  if (/placement agency agreement|placement agent agreement/i.test(haystack)) {
    return "placement_agency_agreement";
  }
  if (/selling agency agreement|selling agent agreement/i.test(haystack)) {
    return "selling_agency_agreement";
  }
  if (/distribution agreement/i.test(haystack)) {
    return "distribution_agreement";
  }
  if (/^EX-1(?:\.|\b)/i.test(type) || /underwriting agreement|underwriter/i.test(haystack)) {
    return "underwriting_agreement";
  }
  if (/lock-?up/i.test(haystack)) {
    return "lock_up_agreement";
  }
  if (/registration rights agreement/i.test(haystack)) {
    return "registration_rights_agreement";
  }
  if (/pre-funded warrant agreement/i.test(haystack)) {
    return "pre_funded_warrant_agreement";
  }
  if (/warrant agreement/i.test(haystack)) {
    return "warrant_agreement";
  }
  if (/rights agreement/i.test(haystack)) {
    return "rights_agreement";
  }
  if (/indenture/i.test(haystack)) {
    return "indenture";
  }
  if (/note purchase agreement/i.test(haystack)) {
    return "note_purchase_agreement";
  }
  if (/convertible note/i.test(haystack)) {
    return "convertible_note_agreement";
  }
  if (/credit agreement/i.test(haystack)) {
    return "credit_agreement";
  }
  if (/loan agreement/i.test(haystack)) {
    return "loan_agreement";
  }
  if (/lease agreement/i.test(haystack)) {
    return "lease_agreement";
  }
  if (/employment agreement|offer letter/i.test(haystack)) {
    return "employment_agreement";
  }
  if (/consulting agreement/i.test(haystack)) {
    return "consulting_agreement";
  }
  if (/service agreement/i.test(haystack)) {
    return "service_agreement";
  }
  if (/acquisition agreement|asset purchase agreement|purchase agreement and plan of acquisition/i.test(haystack)) {
    return "acquisition_agreement";
  }
  if (/merger agreement|agreement and plan of merger/i.test(haystack)) {
    return "merger_agreement";
  }
  if (/deposit agreement|depositary agreement|american depositary/i.test(haystack)) {
    return "deposit_agreement";
  }
  if (/american depositary shares|\bADSs?\b/i.test(haystack)) {
    return "ads_related_exhibit";
  }
  if (/^EX-3(?:\.|\b)/i.test(type) || /certificate of incorporation|bylaws|articles of association|memorandum and articles/i.test(haystack)) {
    return "charter_bylaws";
  }
  if (/^EX-21(?:\.|\b)/i.test(type) || /subsidiar(?:y|ies)/i.test(haystack)) {
    return "subsidiary_list";
  }
  if (/^EX-24(?:\.|\b)/i.test(type) || /power of attorney/i.test(haystack)) {
    return "power_of_attorney";
  }
  if (/^EX-10(?:\.|\b)/i.test(type)) {
    return "material_contract";
  }
  if (/^EX-/i.test(type)) {
    return "other_exhibit";
  }
  return "other_document";
}

function classifyDocument(
  document: SubmissionDocument,
  formType: string,
  primaryDocument: string | null | undefined,
  mainDocument: S1F1MainDocumentSelection | null,
): { bucket: S1F1DocumentBucket; reason: string; documentKind: S1F1DocumentKind; confidence: ConfidenceLevel; isMainDocument: boolean } {
  const type = document.type.toUpperCase();
  const filename = document.filename ?? "";
  const haystack = `${type} ${filename} ${document.description ?? ""} ${document.text.slice(0, 2_000)}`;
  const isMainDocument = isSelectedMainDocument(document, mainDocument);
  const documentKind = classifyDocumentKind(document, isMainDocument);

  if (isMainDocument || type === normalizeFormType(formType) || BODY_TYPES.has(type) || filename === primaryDocument) {
    return { bucket: "body", reason: isMainDocument ? mainDocument?.reason ?? "main filing document" : "additional S-1/F-1 family filing document", documentKind, confidence: isMainDocument ? mainDocument?.confidence ?? "high" : "medium", isMainDocument };
  }

  if (/^EX-3(?:\.|\b)/i.test(type)) {
    if (EX_3_IMPORTANT_HINTS.test(haystack)) {
      return { bucket: "important_exhibit", reason: "charter or articles with share, voting, or capital-structure terms", documentKind, confidence: "medium", isMainDocument };
    }
    return { bucket: "noise", reason: "charter exhibit without detected S-1/F-1 share-rights terms", documentKind, confidence: "medium", isMainDocument };
  }

  if (/^EX-10(?:\.|\b)/i.test(type)) {
    if (EX_10_IMPORTANT_HINTS.test(haystack)) {
      return { bucket: "important_exhibit", reason: "material contract with securities, lock-up, voting, resale, or financing terms", documentKind, confidence: "medium", isMainDocument };
    }
    if (EX_10_NOISE_HINTS.test(haystack)) {
      return { bucket: "noise", reason: "employment, compensation, lease, indemnity, credit, or ordinary contract exhibit", documentKind, confidence: "medium", isMainDocument };
    }
    return { bucket: "noise", reason: "material-contract exhibit without detected S-1/F-1 securities terms", documentKind, confidence: "low", isMainDocument };
  }

  if (NOISE_TYPES.some((pattern) => pattern.test(type)) || NOISE_EXTENSIONS.test(filename)) {
    return { bucket: "noise", reason: `${documentKind.replace(/_/g, " ")} not needed for first-pass S-1/F-1 body parsing`, documentKind, confidence: "high", isMainDocument };
  }

  if (IMPORTANT_TYPES.some((pattern) => pattern.test(type)) || IMPORTANT_TEXT_HINTS.test(haystack)) {
    return { bucket: "important_exhibit", reason: "offering mechanics, securities terms, fee table, or underwriting exhibit", documentKind, confidence: "medium", isMainDocument };
  }

  return { bucket: "noise", reason: "supporting exhibit not needed for S-1/F-1 parser facts", documentKind, confidence: "low", isMainDocument };
}

function clipped(value: string, maxLength: number): string {
  const text = normalizeLines(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function findTableSnippet(text: string): string | null {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const start = lines.findIndex((line) => line.includes(" | ") || /fee table|offering price|shares offered|registration fee/i.test(line));
  if (start < 0) return null;
  return clipped(lines.slice(start, start + 8).join("\n"), 900);
}

function buildSnippets(document: SubmissionDocument, include: boolean): S1F1DocumentFilterItem["snippets"] {
  if (!include || !document.text) return [];
  const snippets: S1F1DocumentFilterItem["snippets"] = [
    {
      label: "document_start",
      text: clipped(document.text, 900),
    },
  ];
  const tableSnippet = findTableSnippet(document.text);
  if (tableSnippet) {
    snippets.push({
      label: "table_or_terms",
      text: tableSnippet,
    });
  }
  return snippets;
}

function summarize(
  sourceText: string,
  filteredText: string,
  documents: SubmissionDocument[],
  items: S1F1DocumentFilterItem[],
  detectedCompleteSubmission: boolean,
  mainDocument: S1F1MainDocumentSelection | null = null,
  warnings: string[] = [],
  blocks: S1F1DocumentBlock[] = [],
  tables: S1F1DocumentTable[] = [],
): S1F1DocumentFilterSummary {
  return {
    detectedCompleteSubmission,
    originalTextLength: sourceText.length,
    filteredTextLength: filteredText.length,
    documentCount: documents.length,
    bodyCount: items.filter((item) => item.bucket === "body").length,
    importantExhibitCount: items.filter((item) => item.bucket === "important_exhibit").length,
    noiseCount: items.filter((item) => item.bucket === "noise").length,
    mainDocument,
    warnings,
    blocks,
    tables,
    items,
  };
}

export function filterS1F1SubmissionText(
  sourceText: string,
  options: {
    formType: string;
    primaryDocument?: string | null;
  },
): S1F1DocumentFilterResult {
  const documents = parseSubmissionDocuments(sourceText);
  if (documents.length === 0) {
    const text = toPlainText(sourceText);
    const extracted = extractDocumentBlocks(
      sourceText,
      { sequence: null, type: normalizeFormType(options.formType) || "UNKNOWN", filename: options.primaryDocument ?? null },
      0,
      1,
    );
    return {
      text,
      summary: summarize(sourceText, text, [], [], false, null, [], extracted.blocks, extracted.tables),
    };
  }

  const mainDocumentResult = selectMainDocument(documents, options.formType, options.primaryDocument);
  const blocks: S1F1DocumentBlock[] = [];
  const tables: S1F1DocumentTable[] = [];
  let nextBlockOrder = 0;
  let nextTableId = 1;
  const included: string[] = [];
  const items: S1F1DocumentFilterItem[] = documents.map((document) => {
    const classification = classifyDocument(document, options.formType, options.primaryDocument, mainDocumentResult.selection);
    const include = classification.bucket === "body" || classification.bucket === "important_exhibit";
    if (include && document.text) {
      const extracted = extractDocumentBlocks(document.sourceText, document, nextBlockOrder, nextTableId);
      blocks.push(...extracted.blocks);
      tables.push(...extracted.tables);
      nextBlockOrder = extracted.nextOrder;
      nextTableId = extracted.nextTableId;
      included.push(
        [
          `Document type: ${document.type}`,
          document.filename ? `Filename: ${document.filename}` : null,
          document.description ? `Description: ${document.description}` : null,
          document.text,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
    return {
      sequence: document.sequence,
      type: document.type,
      filename: document.filename,
      description: document.description,
      documentKind: classification.documentKind,
      isMainDocument: classification.isMainDocument,
      confidence: classification.confidence,
      bucket: classification.bucket,
      reason: classification.reason,
      included: include,
      sourceTextLength: document.sourceText.length,
      textLength: document.text.length,
      includedTextLength: include ? document.text.length : 0,
      snippets: buildSnippets(document, include),
    };
  });

  const filteredText = included.join("\n\n");
  return {
    text: filteredText,
    summary: summarize(
      sourceText,
      filteredText,
      documents,
      items,
      true,
      mainDocumentResult.selection,
      mainDocumentResult.warnings,
      blocks,
      tables,
    ),
  };
}
