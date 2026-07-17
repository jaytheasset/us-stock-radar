export type PeriodicReportIngestXbrlFact = {
  name: string;
  value: string | number;
  unitRef: string | null;
  decimals: string | null;
  contextRef: string | null;
  period: string | null;
  statement: string;
  sourceDocument: string | null;
  hasDimensions: boolean;
};

export type PeriodicReportIngestSourceBlock = {
  blockId: string;
  topic: "annual_core_performance";
  text: string;
  sourceDocument: string | null;
};

export type PeriodicReportIngestEvidence = {
  xbrlFacts: PeriodicReportIngestXbrlFact[];
  sourceBlocks: PeriodicReportIngestSourceBlock[];
};

const PERIODIC_REPORT_FORMS = new Set(["10-K", "10-Q", "20-F", "10-K/A", "10-Q/A", "20-F/A"]);
const DOCUMENT_CONCEPTS = new Set([
  "documenttype",
  "documentfiscalperiodfocus",
  "documentfiscalyearfocus",
  "documentperiodenddate",
  "currentfiscalyearenddate",
]);
const MAX_FACTS = 320;
const MAX_SOURCE_BLOCKS = 5;
const MAX_SOURCE_BLOCK_CHARS = 3600;

type XbrlContext = {
  period: string | null;
  hasDimensions: boolean;
};

export function extractPeriodicReportIngestEvidence({
  cleanedText,
  formType,
  html,
  isPrimary,
  sourceDocument,
}: {
  cleanedText: string;
  formType: string | null;
  html: string;
  isPrimary: boolean;
  sourceDocument: string | null;
}): PeriodicReportIngestEvidence | null {
  const normalizedFormType = normalizeFormType(formType);
  if (!isPrimary || !PERIODIC_REPORT_FORMS.has(normalizedFormType)) return null;

  return {
    xbrlFacts: extractCoreXbrlFacts(html, sourceDocument),
    sourceBlocks: /^(?:10-K|20-F)(?:\/A)?$/.test(normalizedFormType)
      ? extractCorePerformanceBlocks(cleanedText, sourceDocument)
      : [],
  };
}

function extractCoreXbrlFacts(html: string, sourceDocument: string | null) {
  if (!/<ix:(?:nonFraction|nonNumeric)\b/i.test(html)) return [];

  const contexts = extractContexts(html);
  const facts: PeriodicReportIngestXbrlFact[] = [];
  const seen = new Set<string>();
  const pattern = /<ix:(nonFraction|nonNumeric)\b([^>]*)>([\s\S]*?)<\/ix:\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const kind = (match[1] || "").toLowerCase();
    const attrs = parseAttributes(match[2] || "");
    const name = readAttribute(attrs, "name");
    if (!name) continue;
    const concept = normalizeConcept(name);
    const isDocumentConcept = DOCUMENT_CONCEPTS.has(concept);
    if (!isDocumentConcept && !isCoreFinancialConcept(concept)) continue;

    const rawValue = visibleFactText(match[3] || "");
    const value = kind === "nonfraction" ? parseNumericValue(rawValue, attrs) : rawValue;
    if (value === null || value === "") continue;
    if (!isDocumentConcept && typeof value !== "number") continue;

    const contextRef = readAttribute(attrs, "contextRef");
    const context = contextRef ? contexts.get(contextRef) : null;
    const unitRef = readAttribute(attrs, "unitRef");
    const key = `${name}:${String(value)}:${unitRef || ""}:${contextRef || ""}:${context?.period || ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    facts.push({
      name,
      value,
      unitRef,
      decimals: readAttribute(attrs, "decimals"),
      contextRef,
      period: context?.period || null,
      statement: inferStatement(concept),
      sourceDocument,
      hasDimensions: Boolean(context?.hasDimensions),
    });
  }

  return facts
    .sort((left, right) => {
      const leftDocument = DOCUMENT_CONCEPTS.has(normalizeConcept(left.name)) ? 0 : 1;
      const rightDocument = DOCUMENT_CONCEPTS.has(normalizeConcept(right.name)) ? 0 : 1;
      if (leftDocument !== rightDocument) return leftDocument - rightDocument;
      if (left.hasDimensions !== right.hasDimensions) return left.hasDimensions ? 1 : -1;
      return String(right.period || "").localeCompare(String(left.period || ""));
    })
    .slice(0, MAX_FACTS);
}

function extractContexts(html: string) {
  const contexts = new Map<string, XbrlContext>();
  const pattern = /<(?:xbrli:)?context\b([^>]*)>([\s\S]*?)<\/(?:xbrli:)?context>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const attrs = parseAttributes(match[1] || "");
    const id = readAttribute(attrs, "id");
    if (!id) continue;
    const body = match[2] || "";
    const instant = body.match(/<(?:xbrli:)?instant\b[^>]*>([^<]+)<\/(?:xbrli:)?instant>/i)?.[1]?.trim();
    const start = body.match(/<(?:xbrli:)?startDate\b[^>]*>([^<]+)<\/(?:xbrli:)?startDate>/i)?.[1]?.trim();
    const end = body.match(/<(?:xbrli:)?endDate\b[^>]*>([^<]+)<\/(?:xbrli:)?endDate>/i)?.[1]?.trim();
    contexts.set(id, {
      period: instant || (start && end ? `${start}/${end}` : end || start || null),
      hasDimensions: /<(?:xbrldi:)?(?:explicitMember|typedMember)\b|<scenario\b/i.test(body),
    });
  }

  return contexts;
}

function extractCorePerformanceBlocks(cleanedText: string, sourceDocument: string | null) {
  if (!cleanedText) return [];
  const paragraphs = cleanedText
    .split(/\n{2,}/)
    .map((text, index) => ({ text: compactText(text), index }))
    .filter(({ text }) => text.length >= 100 && text.length <= 12_000)
    .map((candidate) => ({ ...candidate, score: scorePerformanceParagraph(candidate.text) }))
    .filter(({ score }) => score >= 8)
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const selected: typeof paragraphs = [];
  for (const candidate of paragraphs) {
    if (selected.some((item) => overlapKey(item.text) === overlapKey(candidate.text))) continue;
    selected.push(candidate);
    if (selected.length >= MAX_SOURCE_BLOCKS) break;
  }

  return selected
    .sort((left, right) => left.index - right.index)
    .map(({ text, index }) => ({
      blockId: `periodic-ingest-core-${index}-${stableHash(text)}`,
      topic: "annual_core_performance" as const,
      text: truncateAtSentence(text, MAX_SOURCE_BLOCK_CHARS),
      sourceDocument,
    }));
}

function scorePerformanceParagraph(text: string) {
  let score = 0;
  if (/\b(?:total\s+)?revenues?|net sales\b/i.test(text)) score += 3;
  if (/\boperating (?:income|loss|profit)\b/i.test(text)) score += 3;
  if (/\b(?:net income|net loss|profit for the year|profit attributable)\b/i.test(text)) score += 3;
  if (/\b(?:operating cash flow|cash flows? from operating activities)\b/i.test(text)) score += 2;
  if (/\b(?:fiscal year|year ended|FY\s*20\d{2})\b/i.test(text)) score += 2;
  if ((text.match(/\b20\d{2}\b/g) || []).length >= 2) score += 2;
  if (/\b(?:increased|decreased|grew|declined|compared with|compared to|year[- ]over[- ]year)\b/i.test(text)) score += 2;
  if (/\b\d+(?:\.\d+)?%\b/.test(text)) score += 1;
  if (/\b(?:risk factors?|forward-looking statements?|table of contents)\b/i.test(text)) score -= 4;
  return score;
}

function isCoreFinancialConcept(concept: string) {
  if (/(?:practicalexpedient|policy|disclosure|textblock|extensibleenumeration|member|axis|domain)/i.test(concept)) return false;
  return /^(?:revenues?|totalrevenues?|salesrevenuenet|salesrevenuegoodsnet|salesrevenueservicesnet|revenuefromcontractwithcustomerexcludingassessedtax|revenuefromcontractwithcustomerincludingassessedtax|grossprofit|operatingincomeloss|operatingprofitloss|profitlossfromoperatingactivities|netincomeloss|profitloss|profitfortheyear|profitlossattributabletoownersofparent|earningspersharebasic|earningspersharediluted|basicearningslosspershare|dilutedearningslosspershare|netcashprovidedbyusedinoperatingactivities|cashflowsfromusedinoperatingactivities)$/i.test(concept);
}

function inferStatement(concept: string) {
  if (/netcashprovidedbyusedinoperatingactivities|cashflowsfromusedinoperatingactivities/i.test(concept)) return "Cash flow statement";
  if (/revenue|sales|grossprofit|operating|netincome|profitloss|profitfortheyear|earnings/i.test(concept)) return "Income statement";
  return "Document metadata";
}

function parseAttributes(source: string) {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w.-]+)\s*=\s*["']([^"']*)["']/g)) {
    if (match[1]) attrs[match[1]] = match[2] || "";
  }
  return attrs;
}

function readAttribute(attrs: Record<string, string>, name: string) {
  const entry = Object.entries(attrs).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1] || null;
}

function parseNumericValue(rawValue: string, attrs: Record<string, string>) {
  let text = rawValue.replace(/\u2212/g, "-").replace(/[$,%\s]/g, "").replace(/,/g, "");
  if (!text || text === "-" || !/^\(?-?\d+(?:\.\d+)?\)?$/.test(text)) return null;
  const parenthetical = text.startsWith("(") && text.endsWith(")");
  text = text.replace(/[()]/g, "");
  let value = Number(text);
  if (!Number.isFinite(value)) return null;
  if (parenthetical || readAttribute(attrs, "sign") === "-") value = -Math.abs(value);
  const scale = Number(readAttribute(attrs, "scale") || 0);
  if (Number.isFinite(scale) && scale !== 0) value *= 10 ** scale;
  return value;
}

function visibleFactText(value: string) {
  return decodeEntities(value.replace(/<ix:exclude[\s\S]*?<\/ix:exclude>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateAtSentence(value: string, maximum: number) {
  if (value.length <= maximum) return value;
  const clipped = value.slice(0, maximum + 1);
  const boundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("; "), clipped.lastIndexOf(".\n"));
  return `${clipped.slice(0, boundary >= maximum * 0.65 ? boundary + 1 : maximum).trim()}...`;
}

function overlapKey(value: string) {
  return value.toLowerCase().replace(/\W+/g, "").slice(0, 240);
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeConcept(name: string) {
  return (name.split(":").pop() || name).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function normalizeFormType(value: string | null) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}
