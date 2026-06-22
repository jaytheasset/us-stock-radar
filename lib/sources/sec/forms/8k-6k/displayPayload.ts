import {
  SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES,
  SEC_8K_6K_ROUTER_DISPLAY_VERSION_VALUES,
} from "./routerPrompt";

const DISPLAY_PAYLOAD_VERSION = "sec_8k_6k_display_payload_v1";
const SNIPPET_LIMIT = 12;
const SNIPPET_CHAR_LIMIT = 650;
const TABLE_LIMIT = 8;
const ATTACHMENT_LIMIT = 24;

export type Sec8k6kDisplayPayloadBuilderInput = {
  parser_output: Record<string, unknown>;
  router_result: Record<string, unknown>;
  market_context?: Record<string, unknown> | null;
};

export function buildSec8k6kDisplayPayload(input: Sec8k6kDisplayPayloadBuilderInput) {
  const parserOutput = toRecord(input.parser_output);
  const facts = toRecord(parserOutput.facts);
  const extracted = toRecord(facts.extracted);
  const exhibitFacts = toRecord(extracted.exhibitFacts);
  const tableFacts = toRecord(extracted.tableFacts);
  const documentCoverage = toRecord(extracted.documentCoverage);
  const router = toRecord(input.router_result);
  const displayType = normalizeDisplayType(router.display_type);
  const displayVersion = normalizeDisplayVersion(router.display_version, displayType);
  const selectedSourceSnippets = collectSelectedSourceSnippets({ facts, extracted, parserOutput });
  const selectedTables = compactSelectedTables(tableFacts);
  const attachmentInventory = compactAttachmentInventory(exhibitFacts, documentCoverage);
  const warnings = stringArray(parserOutput.warnings);
  const sourceUrl = nullableString(facts.sourceUrl);

  return {
    display_type: displayType,
    data: {
      payload_version: DISPLAY_PAYLOAD_VERSION,
      display_version: displayVersion,
      event_type: nullableString(router.event_type),
      ipo_kind: normalizeIpoKind(router.ipo_kind, router.event_type),
      route_case: nullableString(router.route_case),
      score_from_router: numberOrNull(router.score),
      source_form_scope: nullableString(parserOutput.formType),
      accession_number: nullableString(parserOutput.accessionNumber),
      sec_form_type: nullableString(facts.secFormType),
      company_name: nullableString(facts.companyName),
      ticker: nullableString(facts.ticker),
      source_url: sourceUrl,
      filed_at: nullableString(facts.filedAt),
      source_availability_note: sourceAvailabilityNote(sourceUrl, selectedSourceSnippets.length, selectedTables.length, warnings),
      item_inventory: compactItems(facts.items),
      attachment_inventory: attachmentInventory,
      linked_exhibit_hints: compactLinkedExhibitHints(exhibitFacts),
      selected_source_snippets: selectedSourceSnippets,
      selected_tables: selectedTables,
      parser_warnings: warnings,
      document_coverage: compactDocumentCoverage(documentCoverage),
      offering_terms: displayType === "offering_terms" ? compactOfferingTerms(extracted, facts) : null,
      spac_transaction_status: displayType === "spac_transaction_status" ? compactSpacTransactionStatus(extracted, facts, selectedSourceSnippets) : null,
      market_context_available: Boolean(input.market_context),
    },
    evidence: selectedSourceSnippets.slice(0, 6),
    notes: buildDisplayNotes({ displayVersion, warnings, sourceUrl }),
  };
}

function normalizeDisplayType(value: unknown) {
  const displayType = stringValue(value);
  return SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES.includes(displayType as (typeof SEC_8K_6K_ROUTER_DISPLAY_TYPE_VALUES)[number])
    ? displayType
    : "generic";
}

function normalizeDisplayVersion(value: unknown, displayType: string) {
  const version = stringValue(value);
  if (SEC_8K_6K_ROUTER_DISPLAY_VERSION_VALUES.includes(version as (typeof SEC_8K_6K_ROUTER_DISPLAY_VERSION_VALUES)[number])) {
    return version;
  }
  if (displayType === "offering_terms") return "sec_8k_6k_offering_terms_v1";
  if (displayType === "spac_transaction_status") return "sec_8k_6k_spac_transaction_status_v1";
  if (displayType === "candidate_special") return "sec_8k_6k_candidate_special_v1";
  return "sec_8k_6k_generic_v1";
}

function normalizeIpoKind(value: unknown, eventType: unknown) {
  if (stringValue(eventType) !== "ipo_listing") return null;
  const ipoKind = stringValue(value);
  return ipoKind === "traditional" || ipoKind === "spac" ? ipoKind : null;
}

function compactItems(value: unknown) {
  return arrayRecords(value)
    .map((item) => ({
      item: nullableString(item.item),
      label: truncateText(nullableString(item.label), 180),
      evidence: truncateText(nullableString(item.evidence), SNIPPET_CHAR_LIMIT),
    }))
    .slice(0, 24);
}

function compactAttachmentInventory(exhibitFacts: Record<string, unknown>, documentCoverage: Record<string, unknown>) {
  const exhibitDocuments = arrayRecords(exhibitFacts.documentExhibits).map((document) => ({
    exhibitNumber: nullableString(document.exhibitNumber),
    type: nullableString(document.type),
    description: truncateText(nullableString(document.description), 240),
    filename: nullableString(document.filename),
    role: nullableString(document.role),
    noiseClass: nullableString(document.noiseClass),
    textAvailable: booleanOrNull(document.textAvailable),
    textCharCount: numberOrNull(document.textCharCount),
    roleCandidates: stringArray(document.roleCandidates).slice(0, 8),
  }));
  const importantDocuments = arrayRecords(documentCoverage.importantAttachments).map((document) => ({
    exhibitNumber: nullableString(document.exhibitNumber),
    type: nullableString(document.type),
    description: truncateText(nullableString(document.description), 240),
    filename: nullableString(document.filename),
    role: nullableString(document.role),
    noiseClass: nullableString(document.noiseClass),
    textAvailable: booleanOrNull(document.textAvailable),
    textCharCount: numberOrNull(document.textCharCount),
    textExtractionStatus: nullableString(document.textExtractionStatus),
    textTruncated: booleanOrNull(document.textTruncated),
  }));
  return dedupeAttachments([...exhibitDocuments, ...importantDocuments]).slice(0, ATTACHMENT_LIMIT);
}

function compactLinkedExhibitHints(exhibitFacts: Record<string, unknown>) {
  return arrayRecords(exhibitFacts.itemExhibitHints)
    .map((hint) => ({
      item: nullableString(hint.item),
      exhibitNumber: nullableString(hint.exhibitNumber),
      documentType: nullableString(hint.documentType),
      roleHint: nullableString(hint.roleHint),
      confidence: nullableString(hint.confidence),
      evidence: truncateText(nullableString(hint.evidence), SNIPPET_CHAR_LIMIT),
    }))
    .slice(0, ATTACHMENT_LIMIT);
}

function compactSelectedTables(tableFacts: Record<string, unknown>) {
  return arrayRecords(tableFacts.tableLikeBlocks)
    .map((block) => ({
      kind: nullableString(block.kind),
      rowCount: numberOrNull(block.rowCount),
      columnCount: numberOrNull(block.columnCount),
      numericCellCount: numberOrNull(block.numericCellCount),
      rows: arrayRows(block.rows)
        .map((row) => row.map((cell) => truncateText(stringValue(cell), 80)).filter(Boolean).slice(0, 8))
        .slice(0, 4),
      evidence: truncateText(nullableString(block.evidence), SNIPPET_CHAR_LIMIT),
      confidence: nullableString(block.confidence),
    }))
    .filter((block) => block.evidence || block.rows.length)
    .slice(0, TABLE_LIMIT);
}

function compactDocumentCoverage(documentCoverage: Record<string, unknown>) {
  return {
    documentCount: numberOrNull(documentCoverage.documentCount),
    importantAttachmentCount: numberOrNull(documentCoverage.importantAttachmentCount),
    parserTextCoverage: toRecord(documentCoverage.parserTextCoverage),
    imageHeavyPackage: toRecord(documentCoverage.imageHeavyPackage),
    omittedOrNonTextImportantAttachments: arrayRecords(documentCoverage.omittedOrNonTextImportantAttachments)
      .map((document) => ({
        type: nullableString(document.type),
        description: truncateText(nullableString(document.description), 240),
        filename: nullableString(document.filename),
        textExtractionStatus: nullableString(document.textExtractionStatus),
        noiseClass: nullableString(document.noiseClass),
      }))
      .slice(0, ATTACHMENT_LIMIT),
  };
}

function compactOfferingTerms(extracted: Record<string, unknown>, facts: Record<string, unknown>) {
  return {
    offering: toRecord(extracted.offering),
    moneyAmounts: arrayRecords(facts.moneyAmounts)
      .map((item) => ({
        text: truncateText(nullableString(item.text), 240),
        evidence: truncateText(nullableString(item.evidence), SNIPPET_CHAR_LIMIT),
        confidence: nullableString(item.confidence),
      }))
      .slice(0, 12),
    shareCounts: arrayRecords(facts.shareCounts)
      .map((item) => ({
        text: truncateText(nullableString(item.text), 240),
        evidence: truncateText(nullableString(item.evidence), SNIPPET_CHAR_LIMIT),
        confidence: nullableString(item.confidence),
      }))
      .slice(0, 12),
  };
}

function compactSpacTransactionStatus(extracted: Record<string, unknown>, facts: Record<string, unknown>, snippets: string[]) {
  return {
    status_kind: inferSpacStatusKind(snippets),
    transaction_terms: toRecord(extracted.strategicTransaction),
    vote_or_approval: toRecord(extracted.shareholderVote),
    moneyAmounts: arrayRecords(facts.moneyAmounts)
      .map((item) => ({
        text: truncateText(nullableString(item.text), 240),
        evidence: truncateText(nullableString(item.evidence), SNIPPET_CHAR_LIMIT),
        confidence: nullableString(item.confidence),
      }))
      .slice(0, 12),
    dates: arrayRecords(facts.dates)
      .map((item) => ({
        value: nullableString(item.value),
        evidence: truncateText(nullableString(item.evidence), SNIPPET_CHAR_LIMIT),
        confidence: nullableString(item.confidence),
      }))
      .slice(0, 12),
    evidence: snippets.slice(0, 8),
  };
}

function inferSpacStatusKind(snippets: string[]) {
  const text = snippets.join(" ").toLowerCase();
  if (/\bredemption\b/.test(text)) return "redemption_result";
  if (/\b(?:stockholder|shareholder)\s+vote\b|\bapproved\b/.test(text)) return "merger_vote";
  if (/\bminimum cash\b/.test(text)) return "minimum_cash_condition";
  if (/\bticker\b|\bsymbol\b/.test(text)) return "ticker_change";
  if (/\bclosing\b|\bclosed\b|\bconsummated\b/.test(text)) return "closing_update";
  if (/\bbusiness combination\b|\bde-spac\b|\bdespac\b/.test(text)) return "business_combination_status";
  return "spac_transaction_status";
}

function collectSelectedSourceSnippets({
  facts,
  extracted,
  parserOutput,
}: {
  facts: Record<string, unknown>;
  extracted: Record<string, unknown>;
  parserOutput: Record<string, unknown>;
}) {
  const snippets: string[] = [];
  collectEvidence(facts.items, snippets);
  collectEvidence(facts.filingCues, snippets);
  collectEvidence(facts.moneyAmounts, snippets);
  collectEvidence(facts.shareCounts, snippets);
  collectEvidence(facts.dates, snippets);
  collectEvidence(parserOutput.calendarItems, snippets);
  collectEvidence(toRecord(extracted.exhibitFacts).itemExhibitHints, snippets);
  collectEvidence(toRecord(extracted.tableFacts).tableLikeBlocks, snippets);
  return uniqueStrings(
    snippets
      .map((snippet) => truncateText(snippet, SNIPPET_CHAR_LIMIT))
      .filter((snippet): snippet is string => Boolean(snippet)),
  ).slice(0, SNIPPET_LIMIT);
}

function collectEvidence(value: unknown, snippets: string[]) {
  if (!value || snippets.length >= SNIPPET_LIMIT * 4) return;
  if (Array.isArray(value)) {
    for (const item of value) collectEvidence(item, snippets);
    return;
  }
  const record = toRecord(value);
  const evidence = nullableString(record.evidence);
  if (evidence) snippets.push(evidence);
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectEvidence(nested, snippets);
  }
}

function sourceAvailabilityNote(sourceUrl: string | null, snippetCount: number, tableCount: number, warnings: string[]) {
  const parts = [
    sourceUrl ? "SEC source URL is available." : "SEC source URL is not available in parser facts.",
    snippetCount || tableCount ? "Selected source snippets and table samples are included." : "No selected source snippets or table samples were extracted.",
  ];
  if (warnings.some((warning) => /binary|graphic|pdf|truncated|missing|empty|non_text/i.test(warning))) {
    parts.push("Some source text may be incomplete because parser warnings indicate non-text, missing, or truncated material.");
  }
  return parts.join(" ");
}

function buildDisplayNotes({ displayVersion, warnings, sourceUrl }: { displayVersion: string; warnings: string[]; sourceUrl: string | null }) {
  return [
    `Display payload built by parser/router-side UI payload builder (${displayVersion}).`,
    "Analysis LLM must not choose or invent display_type, display_version, or display_payload fields.",
    sourceUrl ? "Original SEC source link is available in display_payload.data.source_url." : "Original SEC source link was not available in parser facts.",
    ...warnings.slice(0, 8).map((warning) => `Parser warning: ${warning}`),
  ];
}

function dedupeAttachments(items: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  const deduped: Array<Record<string, unknown>> = [];
  for (const item of items) {
    const key = [item.exhibitNumber, item.type, item.filename, item.description].map(stringValue).join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function arrayRecords(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

function arrayRows(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is unknown[] => Array.isArray(item)) : [];
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function truncateText(value: string | null, maxChars: number) {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxChars ? `${text.slice(0, maxChars - 3).trim()}...` : text;
}
