const EXHIBIT_LABEL_PREFIX =
  /^(?:EXHIBIT|EX)[\s_-]*(?:NO\.?\s*)?\d{1,3}(?:\.\d{1,4}[A-Z]?)?\s*(?:[:|\-\u2013\u2014]\s*)?/i;

const SEC_DOCUMENT_BOILERPLATE =
  /^(?:FORM\s+(?:8-K|6-K)(?:\/A)?|UNITED STATES|SECURITIES AND EXCHANGE COMMISSION|WASHINGTON,?\s+D\.?C\.?|SIGNATURES?|EXHIBIT INDEX|TABLE OF CONTENTS|OMB APPROVAL)$/i;

const DATE_ONLY =
  /^(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})$/i;

export function findSecDocumentHeadline(value: string) {
  for (const rawLine of value.split(/\r?\n/).slice(0, 80)) {
    const candidate = semanticHeadlineCandidate(rawLine);
    if (candidate) return candidate;
  }
  return null;
}

export function semanticHeadlineCandidate(value: string) {
  let candidate = value.replace(/\s+/g, " ").trim();
  if (!candidate) return null;

  candidate = candidate.replace(EXHIBIT_LABEL_PREFIX, "").trim();
  if (!candidate || candidate.length < 8) return null;
  if (SEC_DOCUMENT_BOILERPLATE.test(candidate) || DATE_ONLY.test(candidate)) return null;
  if (/^(?:EXHIBIT|EX)(?:\s|[-_])*(?:NO\.?)?\s*\d/i.test(candidate)) return null;
  if (/^[^\s]+\.(?:html?|txt|xml|xsd|jpg|jpeg|png|gif)$/i.test(candidate)) return null;

  return candidate;
}
