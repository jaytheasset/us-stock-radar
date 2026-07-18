import { buildCurrentFilingIdentity, type SecCurrentFilingIdentity } from "../common/currentFilingIdentity.ts";
import { extractSecDocumentRoutingOutline, semanticHeadlineCandidate } from "./documentHeadline.ts";

export type Sec8k6kRouterDigestInput = {
  current_filing: SecCurrentFilingIdentity;
  router_digest: {
    items: Array<{
      item_number: string;
      title: string | null;
      summary: string;
      context_snippets: string[];
    }>;
    documents: Array<{
      source_ref: string | null;
      document_type: string | null;
      exhibit_number: string | null;
      title: string | null;
      subtitle: string | null;
      lead_context: string[];
      section_headings: string[];
      headline_or_summary: string;
    }>;
    tables: Array<{
      source_ref: string | null;
      title: string | null;
      heading: string;
    }>;
    amendment: {
      is_amendment: boolean;
      amendment_number: number | null;
      parent_accession_number: string | null;
      parent_filed_date: string | null;
      needs_parent_context: boolean;
      routine_administrative_only: boolean;
      material_change_language: boolean;
    };
    coverage: {
      item_count: number;
      document_count: number;
      table_count: number;
      document_types: string[];
      parser_warnings: string[];
    };
  };
};

export function buildSec8k6kRouterDigestInput(params: {
  filingPackage?: Record<string, unknown> | null;
  parserOutput?: Record<string, unknown> | null;
  fallbackText?: string | null;
  parentFilingContext?: Record<string, unknown> | null;
  relatedFilingContexts?: Array<Record<string, unknown>> | null;
}): Sec8k6kRouterDigestInput {
  const parser = toRecord(params.parserOutput);
  const facts = toRecord(parser.facts);
  const extracted = toRecord(facts.extracted);
  const amendment = toRecord(facts.amendment);
  const items = arrayRecords(facts.items);
  const documents = buildDocumentDigest({
    facts,
    extracted,
    parentFilingContext: params.parentFilingContext,
    relatedFilingContexts: params.relatedFilingContexts,
  });
  documents.push(...extractDocumentHeadingDigest(stringValue(params.fallbackText)));
  const dedupedDocuments = dedupeBy(documents, (document) =>
    [document.title, document.subtitle, document.title || document.subtitle ? "" : document.headline_or_summary]
      .map((value) => stringValue(value).toLowerCase())
      .filter(Boolean)
      .join("|"),
  );
  const tables = buildTableDigest(toRecord(extracted.tableFacts));

  if (
    !items.length &&
    stringValue(params.fallbackText) &&
    !dedupedDocuments.some((document) => document.title || document.subtitle || document.lead_context.length)
  ) {
    dedupedDocuments.push({
      source_ref: "primary_filing_summary",
      document_type: "primary_filing_summary",
      exhibit_number: null,
      title: "Primary filing summary",
      subtitle: null,
      lead_context: [],
      section_headings: [],
      headline_or_summary: buildPrimaryFilingRoutingSummary(stringValue(params.fallbackText)),
    });
  }

  return {
    current_filing: buildCurrentFilingIdentity({
      filingPackage: params.filingPackage,
      parserOutput: params.parserOutput,
      formFamily: stringValue(parser.formType),
    }),
    router_digest: {
      items: items.slice(0, 12).map((item) => {
        const itemNumber = firstString(item.item, item.itemNumber, item.number);
        const evidence = firstString(item.evidence, item.summary);
        return {
          item_number: itemNumber,
          title: nullableString(firstString(item.label, item.title)),
          summary: compactSummary(evidence, 320),
          context_snippets: buildRoutingContextSnippets(evidence),
        };
      }),
      documents: dedupedDocuments.slice(0, 12),
      tables: tables.slice(0, 8),
      amendment: {
        is_amendment: amendment.isAmendment === true,
        amendment_number: numberValue(amendment.amendmentNumber),
        parent_accession_number: nullableString(amendment.parentAccessionNumber),
        parent_filed_date: nullableString(amendment.parentFiledDate),
        needs_parent_context: amendment.needsParentContext === true,
        routine_administrative_only: amendment.isRoutineAdministrativeOnly === true,
        material_change_language: amendment.hasMaterialChangeLanguage === true,
      },
      coverage: {
        item_count: items.length,
        document_count: dedupedDocuments.length,
        table_count: tables.length,
        document_types: uniqueStrings(dedupedDocuments.map((document) => stringValue(document.document_type)).filter(Boolean)).slice(0, 16),
        parser_warnings: stringArray(parser.warnings).slice(0, 12),
      },
    },
  };
}

const ROUTING_ACTION_PATTERN =
  /\b(?:Proposal|Matter)\s+(?:[A-Z][A-Za-z-]*|\d+)|\b(?:approve|approved|adopt|adopted|authorize|authorized|ratify|ratified|elect|elected|entered into|completed|closed|filed|received|appointed|resigned|dismissed|engaged|declared|issued|terminated|defaulted|accelerated|suspended|delisted|withdrew|withdrawn)\b/gi;

function buildRoutingContextSnippets(value: string) {
  const paragraphs = value
    .split(/\n\s*\n+/)
    .map((paragraph) =>
      paragraph
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^Item\s+[0-9.]+\s+[^.]{0,180}\.\s*/i, ""),
    )
    .filter((paragraph) => paragraph.length >= 40);
  const candidates: Array<{ text: string; score: number; order: number }> = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const matches = [...paragraph.matchAll(ROUTING_ACTION_PATTERN)].slice(0, 6);
    for (const match of matches) {
      const anchor = match.index || 0;
      const snippet = contextWindow(paragraph, anchor, 650);
      candidates.push({
        text: snippet,
        score: routingSnippetScore(snippet),
        order: paragraphIndex * 10_000 + anchor,
      });
    }
  });

  const chosen: Array<{ text: string; order: number }> = [];
  for (const candidate of candidates.sort((left, right) => right.score - left.score || left.order - right.order)) {
    if (chosen.some((item) => snippetsSubstantiallyOverlap(item.text, candidate.text))) continue;
    chosen.push({ text: candidate.text, order: candidate.order });
    if (chosen.length >= 2) break;
  }
  return chosen.sort((left, right) => left.order - right.order).map((item) => item.text);
}

function routingSnippetScore(value: string) {
  let score = 0;
  if (/\b(?:Proposal|Matter)\s+(?:[A-Z][A-Za-z-]*|\d+)\b/i.test(value)) score += 80;
  if (/\b(?:approve|approved|adopt|adopted|authorize|authorized|ratify|ratified|elect|elected)\b/i.test(value)) score += 70;
  if (/\b(?:entered into|completed|closed|filed|received|appointed|resigned|dismissed|engaged|declared|issued|terminated|defaulted|accelerated|suspended|delisted|withdrew|withdrawn)\b/i.test(value)) score += 50;
  if (/\b(?:shares?|warrants?|merger|acquisition|reverse stock split|bankruptcy|listing|auditor|officer|director|financial results)\b/i.test(value)) score += 25;
  return score;
}

function contextWindow(value: string, anchor: number, maxLength: number) {
  if (value.length <= maxLength) return value;
  let start = Math.max(0, anchor - 140);
  let end = Math.min(value.length, start + maxLength);
  if (end - start < maxLength) start = Math.max(0, end - maxLength);

  const priorBoundary = value.lastIndexOf(". ", anchor);
  if (priorBoundary >= start && anchor - priorBoundary <= 180) start = priorBoundary + 2;
  const nextBoundary = value.indexOf(". ", end);
  if (nextBoundary >= 0 && nextBoundary - start <= maxLength + 100) end = nextBoundary + 1;

  const clipped = value.slice(start, end).trim();
  return `${start > 0 ? "..." : ""}${clipped}${end < value.length ? "..." : ""}`;
}

function snippetsSubstantiallyOverlap(left: string, right: string) {
  const normalizedLeft = left.replace(/^\.\.\.|\.\.\.$/g, "").trim();
  const normalizedRight = right.replace(/^\.\.\.|\.\.\.$/g, "").trim();
  const shorter = normalizedLeft.length <= normalizedRight.length ? normalizedLeft : normalizedRight;
  const longer = normalizedLeft.length > normalizedRight.length ? normalizedLeft : normalizedRight;
  return shorter.length >= 120 && longer.includes(shorter.slice(0, Math.min(240, shorter.length)));
}

function buildDocumentDigest({
  facts,
  extracted,
  parentFilingContext,
  relatedFilingContexts,
}: {
  facts: Record<string, unknown>;
  extracted: Record<string, unknown>;
  parentFilingContext?: Record<string, unknown> | null;
  relatedFilingContexts?: Array<Record<string, unknown>> | null;
}) {
  const exhibitFacts = toRecord(extracted.exhibitFacts);
  const sixK = toRecord(exhibitFacts.sixK);
  const candidates = [
    ...arrayRecords(facts.documentRoutingOutlines),
    ...arrayRecords(exhibitFacts.documentExhibits),
    ...arrayRecords(sixK.exhibits),
    ...arrayRecords(facts.documents),
  ];
  const documents = candidates.map((document) => {
    const exhibitNumber = nullableString(firstString(document.exhibitNumber, document.exhibit_number));
    const documentType = nullableString(firstString(document.type, document.documentType, document.document_type));
    const semanticTitle = semanticHeadlineCandidate(firstString(document.description, document.title, document.filename));
    const documentHeadline = semanticHeadlineCandidate(firstString(document.headline));
    const title = nullableString(semanticTitle || documentHeadline);
    const subtitle = nullableString(firstString(document.subtitle));
    const leadContext = stringArray(document.lead_context).map((value) => compactSummary(value, 520)).slice(0, 3);
    const sectionHeadings = stringArray(document.section_headings).map((value) => compactText(value, 120)).slice(0, 8);
    const roleCandidates = stringArray(document.roleCandidates);
    return {
      source_ref: nullableString(firstString(document.source_ref)) || (exhibitNumber ? `Exhibit ${exhibitNumber}` : documentType || title),
      document_type: documentType,
      exhibit_number: exhibitNumber,
      title,
      subtitle,
      lead_context: leadContext,
      section_headings: sectionHeadings,
      headline_or_summary: compactSummary(
        firstString(
          document.routingSummary,
          document.routing_summary,
          document.headline,
          subtitle,
          leadContext[0],
          title,
          roleCandidates.join(", "),
          document.role,
          document.noiseClass,
          document.noise_class,
        ),
        620,
      ),
    };
  }).filter((document) => !isMetadataOnlyDocument(document));

  for (const context of [parentFilingContext, ...(relatedFilingContexts || [])]) {
    const record = toRecord(context);
    if (!Object.keys(record).length) continue;
    const formType = firstString(record.form_type, record.formType);
    const accession = firstString(record.accession_number, record.accessionNumber);
    const title = nullableString(firstString(record.event_title, record.title, record.company_name, record.companyName));
    const summary = compactSummary(firstString(record.quick_take, record.summary, record.event_summary, title), 420);
    if (!summary) continue;
    documents.push({
      source_ref: [formType, accession].filter(Boolean).join(" ") || "related filing",
      document_type: "related_filing_context",
      exhibit_number: null,
      title,
      subtitle: null,
      lead_context: [],
      section_headings: [],
      headline_or_summary: summary,
    });
  }

  return dedupeBy(documents.filter((document) => document.headline_or_summary), (document) =>
    `${document.source_ref || ""}|${document.title || ""}|${document.headline_or_summary}`,
  );
}

function extractDocumentHeadingDigest(value: string) {
  if (!/^###\s+/m.test(value)) return [];
  const headings = [...value.matchAll(/^###\s+(.+)$/gm)];
  return headings.slice(0, 12).map((match, index) => {
    const title = match[1].trim();
    const bodyStart = (match.index || 0) + match[0].length;
    const bodyEnd = headings[index + 1]?.index ?? value.length;
    const body = value.slice(bodyStart, bodyEnd);
    const outline = extractSecDocumentRoutingOutline(body);
    const semanticTitle = semanticHeadlineCandidate(title);
    return {
      source_ref: title,
      document_type: documentTypeFromHeading(title),
      exhibit_number: nullableString(title.match(/\bEX(?:HIBIT)?[-\s]*([0-9]{1,3}(?:\.[0-9A-Z]+)?)/i)?.[1]),
      title: nullableString(outline.title || semanticTitle),
      subtitle: outline.subtitle,
      lead_context: outline.lead_context,
      section_headings: outline.section_headings,
      headline_or_summary: compactSummary(
        [outline.title || semanticTitle || title, outline.subtitle].filter(Boolean).join(". "),
        620,
      ),
    };
  }).filter((document) => !isMetadataOnlyDocument(document));
}

function buildPrimaryFilingRoutingSummary(value: string) {
  const outline = extractSecDocumentRoutingOutline(value);
  const summary = [outline.title, outline.subtitle]
    .filter(Boolean)
    .filter((part, index, values) => index === 0 || part?.toLowerCase() !== values[0]?.toLowerCase())
    .map((part) => part?.replace(/[.!?]+$/, ""))
    .join(". ");
  return compactSummary(summary || value, 620);
}

function documentTypeFromHeading(value: string) {
  const match = value.match(/\b(EX-[0-9]{1,3}(?:\.[0-9A-Z]+)?)/i);
  return match?.[1]?.toUpperCase() || "filing_document";
}

function buildTableDigest(tableFacts: Record<string, unknown>) {
  const tables: Sec8k6kRouterDigestInput["router_digest"]["tables"] = [];

  for (const block of arrayRecords(tableFacts.tableLikeBlocks)) {
    const rows = arrayRows(block.rows);
    const heading = rows[0]?.join(" | ") || firstString(block.label, block.kind);
    if (!isUsefulTableHeading(heading)) continue;
    tables.push({
      source_ref: nullableString(firstString(block.label, block.kind)),
      title: nullableString(firstString(block.label, block.kind)),
      heading: compactText(heading, 240),
    });
  }

  for (const wrapper of arrayRecords(tableFacts.structuredTables)) {
    const table = toRecord(wrapper.table);
    const headers = stringArray(table.headers);
    const heading = firstString(table.caption, headers.join(" | "));
    if (!isUsefulTableHeading(heading)) continue;
    tables.push({
      source_ref: nullableString(firstString(wrapper.filename, wrapper.documentType)),
      title: nullableString(firstString(table.caption, wrapper.documentDescription)),
      heading: compactText(heading, 240),
    });
  }

  return dedupeBy(tables, (table) => `${table.source_ref || ""}|${table.title || ""}|${table.heading}`);
}

function isMetadataOnlyDocument(document: Sec8k6kRouterDigestInput["router_digest"]["documents"][number]) {
  if (document.lead_context.length || document.subtitle || document.section_headings.length) return false;
  const values = [document.source_ref, document.document_type, document.title, document.headline_or_summary]
    .map(stringValue)
    .filter(Boolean);
  return Boolean(values.length) && values.every((value) =>
    /^(?:complete submission text file|primary filing text|filing_document|6-K\s*-\s*(?:FORM\s+)?6-K|8-K\s*-\s*(?:FORM\s+)?8-K|6-K|8-K)$/i.test(value),
  );
}

function isUsefulTableHeading(value: string) {
  const heading = value.replace(/\s+/g, " ").trim();
  if (!heading || heading.length < 6) return false;
  if (/^(?:\|?\s*[-:]+\s*)+\|?$/.test(heading)) return false;
  if (
    (heading.match(/\|/g) || []).length >= 2 &&
    !/\b(?:metric|financial|revenue|sales|income|loss|profit|earnings|EPS|EBITDA|cash flow|guidance|outlook|production|delivery|volume|shares?|warrants?|proceeds|for|against|abstain|votes?|FY\d*|Q[1-4])\b/i.test(heading)
  ) return false;
  const words = heading.match(/[A-Za-z]{3,}/g) || [];
  const numbers = heading.match(/\(?-?\d[\d,.]*%?\)?/g) || [];
  if (!words.length) return false;
  if (
    numbers.length >= 5 &&
    words.length <= 2 &&
    !/\b(?:metric|FY\d*|Q[1-4]|quarter|year|period|current|prior)\b/i.test(heading)
  ) return false;
  return true;
}

function compactSummary(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  let summary = "";
  for (const sentence of sentences) {
    const next = `${summary} ${sentence.trim()}`.trim();
    if (next.length > maxLength) break;
    summary = next;
    if (summary.length >= Math.min(220, maxLength)) break;
  }
  return summary || compactText(text, maxLength);
}

function compactText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength + 1);
  const wordBoundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, wordBoundary > maxLength * 0.6 ? wordBoundary : maxLength).trim()}...`;
}

function dedupeBy<T>(values: T[], keyFor: (value: T) => string) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = keyFor(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  return Array.isArray(value) ? value.map((row) => stringArray(row)).filter((row) => row.length) : [];
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

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
