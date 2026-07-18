const EXHIBIT_LABEL_PREFIX =
  /^(?:EXHIBIT|EX)[\s_-]*(?:NO\.?\s*)?\d{1,3}(?:\.\d{1,4}[A-Z]?)?\s*(?:[:|\-\u2013\u2014]\s*)?/i;

const SEC_DOCUMENT_BOILERPLATE =
  /^(?:FORM\s+(?:8-K|6-K)(?:\/A)?|(?:8-K|6-K)(?:\/A)?\s*[-|:]\s*FORM\s+(?:8-K|6-K)(?:\/A)?|UNITED STATES|SECURITIES AND EXCHANGE COMMISSION|WASHINGTON,?\s+D\.?C\.?|REPORT OF FOREIGN PRIVATE ISSUER|PURSUANT TO (?:RULE|SECTION)\b.*|COMMISSION FILE NUMBER\b.*|FOR THE MONTH OF\b.*|PRIMARY FILING TEXT|SIGNATURES?|EXHIBIT INDEX|TABLE OF CONTENTS|OMB APPROVAL)$/i;

const DATE_ONLY =
  /^(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})$/i;

const DOCUMENT_TITLE_PATTERN =
  /\b(?:financial report|financial results?|quarterly results?|annual results?|earnings release|business update|operating update|press release|announc(?:es|ed|ement)|appoint(?:s|ed|ment)|resign(?:s|ed|ation)|dismiss(?:es|ed|al)|engag(?:es|ed|ement)|receiv(?:es|ed)|approv(?:es|ed|al)|grant(?:s|ed)|clear(?:s|ed|ance)|accept(?:s|ed|ance)|complet(?:es|ed|ion)|enter(?:s|ed) into|acqui(?:res|red|sition)|merger|offering|redemption|redeem(?:s|ed)|restructuring|bankruptcy|delisting)\b/i;

const LEAD_CONTEXT_PATTERN =
  /\b(?:announc|appoint|resign|dismiss|engag|approv|authoriz|receiv|grant|clear|accept|complet|enter|launch|expect|report|increase|decrease|grew|declin|revenue|sales|earnings|guidance|production|merger|acquisition|clinical|FDA|PDUFA|NDA|BLA|IND|offering|financ|redeem|redemption|restructur|bankrupt|delist)\w*\b/i;

const SECTION_HEADING_PATTERN =
  /\b(?:financial highlights?|business highlights?|operating highlights?|commercial highlights?|research and development|pipeline|outlook|guidance|financial results?|operating results?|transaction overview|transaction highlights?|about the transaction)\b/i;

export type SecDocumentRoutingOutline = {
  title: string | null;
  subtitle: string | null;
  lead_context: string[];
  section_headings: string[];
};

type SemanticLine = {
  text: string;
  sourceIndex: number;
  listLike: boolean;
};

export function extractSecDocumentRoutingOutline(value: string): SecDocumentRoutingOutline {
  const lines = semanticLines(value);
  const titleIndex = chooseTitleIndex(lines);
  const titleLine = titleIndex >= 0 ? lines[titleIndex] : null;
  const title = titleLine ? mergeWrappedTitle(lines, titleIndex) : null;
  const consumedThrough = titleLine && title && title !== titleLine.text ? titleIndex + 1 : titleIndex;

  const contextual = mergeWrappedContext(
    lines.slice(Math.max(0, consumedThrough + 1), Math.max(0, consumedThrough + 31)),
  )
    .filter((line) => line.text.toLowerCase() !== stringValue(title).toLowerCase())
    .filter((line) => !looksLikeSectionHeading(line.text))
    .filter((line) => line.listLike || /^[A-Z\u00c0-\u00de]/.test(line.text))
    .filter((line) => !line.listLike || LEAD_CONTEXT_PATTERN.test(line.text))
    .filter((line) => line.text.length >= 35 && LEAD_CONTEXT_PATTERN.test(line.text));

  const leadContext = dedupeStrings(contextual.map((line) => compactText(line.text, 520))).slice(0, 3);
  const sectionHeadings = dedupeStrings(
    lines
      .filter((line) => looksLikeSectionHeading(line.text))
      .map((line) => compactText(line.text, 120)),
  ).slice(0, 8);

  return {
    title,
    subtitle: leadContext[0] || null,
    lead_context: leadContext,
    section_headings: sectionHeadings,
  };
}

export function findSecDocumentHeadline(value: string) {
  return extractSecDocumentRoutingOutline(value).title;
}

export function semanticHeadlineCandidate(value: string) {
  let candidate = value.replace(/\s+/g, " ").trim();
  if (!candidate) return null;

  candidate = candidate.replace(/^#{1,6}\s+/, "").replace(/^\*{1,2}(.+?)\*{1,2}$/, "$1").trim();
  candidate = candidate.replace(EXHIBIT_LABEL_PREFIX, "").trim();
  if (!candidate || candidate.length < 8) return null;
  if (SEC_DOCUMENT_BOILERPLATE.test(candidate) || DATE_ONLY.test(candidate)) return null;
  if (/^(?:EXHIBIT|EX)(?:\s|[-_])*(?:NO\.?)?\s*\d/i.test(candidate)) return null;
  if (/^[^\s]+\.(?:html?|txt|xml|xsd|jpg|jpeg|png|gif)$/i.test(candidate)) return null;
  if (/^(?:indicate by check mark|the information contained|the registrant hereby|exact name of registrant|address of principal|telephone number|trading symbol|name of each exchange|pursuant to the requirements)\b/i.test(candidate)) return null;
  if (/^(?:yes|no|none|n\/a|not applicable)$/i.test(candidate)) return null;
  if (looksLikeTableRow(candidate)) return null;

  return candidate;
}

function semanticLines(value: string): SemanticLine[] {
  return value
    .split(/\r?\n/)
    .slice(0, 220)
    .map((rawLine, sourceIndex) => ({
      text: semanticHeadlineCandidate(rawLine),
      sourceIndex,
      listLike: /^\s*(?:[-*\u2022]|\d+[.)])\s+/.test(rawLine),
    }))
    .filter((line): line is SemanticLine => Boolean(line.text));
}

function chooseTitleIndex(lines: SemanticLine[]) {
  if (!lines.length) return -1;

  const explicitReport = lines.findIndex((line) =>
    /\b(?:financial report|financial results?|quarterly results?|annual results?|earnings release)\b/i.test(line.text),
  );
  if (explicitReport >= 0) return explicitReport;

  const titledEvent = lines.findIndex((line) =>
    !line.listLike &&
    line.text.length <= 220 &&
    DOCUMENT_TITLE_PATTERN.test(line.text) &&
    !/[.!?]\s+\S/.test(line.text),
  );
  if (titledEvent >= 0) return titledEvent;

  const firstMaterial = lines.findIndex((line) => !line.listLike && DOCUMENT_TITLE_PATTERN.test(line.text));
  if (firstMaterial >= 0) return firstMaterial;

  return 0;
}

function mergeWrappedTitle(lines: SemanticLine[], index: number) {
  const current = lines[index]?.text || "";
  const next = lines[index + 1];
  if (!next || next.sourceIndex !== lines[index].sourceIndex + 1) return current;
  if (current.length > 170 || /[.!?;:]$/.test(current) || DATE_ONLY.test(next.text)) return current;
  if (next.listLike || LEAD_CONTEXT_PATTERN.test(next.text) || looksLikeSectionHeading(next.text)) return current;
  if (!/^[a-z(]/.test(next.text)) return current;
  return compactText(`${current} ${next.text}`, 220);
}

function mergeWrappedContext(lines: SemanticLine[]) {
  const merged: SemanticLine[] = [];
  for (const line of lines) {
    const previous = merged[merged.length - 1];
    if (
      previous &&
      !previous.listLike &&
      !line.listLike &&
      line.sourceIndex === previous.sourceIndex + 1 &&
      !/[.!?]$/.test(previous.text) &&
      previous.text.length + line.text.length < 900
    ) {
      previous.text = `${previous.text} ${line.text}`;
      previous.sourceIndex = line.sourceIndex;
      continue;
    }
    merged.push({ ...line });
  }
  return merged;
}

function looksLikeSectionHeading(value: string) {
  if (!SECTION_HEADING_PATTERN.test(value) || value.length > 120) return false;
  if (/[.!?]$/.test(value) || /\b(?:increased|decreased|grew|declined)\b/i.test(value)) return false;
  return value.split(/\s+/).length <= 10 || /:$/.test(value);
}

function looksLikeTableRow(value: string) {
  if ((value.match(/\|/g) || []).length >= 2 || (value.match(/\t/g) || []).length >= 2) return true;
  const numericTokens = value.match(/(?:\$|\u20ac|\u00a3)?\(?-?\d[\d,.]*%?\)?/g) || [];
  const words = value.match(/[A-Za-z]{3,}/g) || [];
  return numericTokens.length >= 4 && words.length <= 3;
}

function compactText(value: string, maxLength: number) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength + 1);
  const sentenceBoundary = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("; "));
  const wordBoundary = clipped.lastIndexOf(" ");
  const boundary = sentenceBoundary > maxLength * 0.55 ? sentenceBoundary + 1 : wordBoundary;
  return `${clipped.slice(0, boundary > maxLength * 0.55 ? boundary : maxLength).trim()}...`;
}

function dedupeStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
