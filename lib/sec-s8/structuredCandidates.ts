/** Lexical candidates, never accepted entities or inferred filing relationships.
 * Exact source occurrences are retained; flags only veto unsupported promotions.
 * Unrecognized names/references remain unavailable rather than being invented. */
export type SourceBlock = { ref: string; documentUrl: string; documentSha256: string;
  normalizedSha256: string; start: number; end: number; text: string };
export type NeutralDocument = { documentUrl: string; text: string };
export type CandidateOccurrence = { documentUrl: string; start: number; end: number;
  text: string; context: string; evidence: string[];
  guards: Array<"denied_existence" | "non_current_context" | "historical_context"> };
export type SourceCandidate = { ref: string; label: string; kind: "plan_mention" | "file_number" | "sec_url" | "filing_date_mention";
  occurrences: CandidateOccurrence[] };
export const MAX_CANDIDATES = 100;
const flat = (value: string) => value.replace(/\s+/g, " ").trim();
export const lexicalName = (value: string) => flat(value).replace(/^(?:The |Registrant['’]s |Company['’]s |Inc\. )+/, "");
function clause(text: string, start: number, end: number) {
  // Periods inside company names/URLs are not sentence boundaries.
  const before = text.slice(0, start), after = text.slice(end);
  const matches = [...before.matchAll(/[.!?;](?=\s|$)|\n\n/g)];
  const left = matches.length ? matches.at(-1)!.index! + matches.at(-1)![0].length : 0;
  const right = after.search(/[.!?;](?=\s|$)|\n\n/);
  return { before: text.slice(left, start), after: after.slice(0, right < 0 ? after.length : right),
    text: text.slice(left, right < 0 ? text.length : end + right + 1).trim() };
}
export function buildS8Candidates(documents: NeutralDocument[], evidence: SourceBlock[]) {
  const plans: SourceCandidate[] = [], references: SourceCandidate[] = [];
  function add(target: SourceCandidate[], kind: SourceCandidate["kind"], doc: NeutralDocument,
    start: number, value: string) {
    const end = start + value.length, c = clause(doc.text, start, end);
    const label = kind === "plan_mention" ? lexicalName(value) : flat(value);
    const guards: CandidateOccurrence["guards"] = [];
    if (kind === "plan_mention") {
      if (/\b(?:there\s+is\s+no|there\s+was\s+no|no)\s+[“"']?$/i.test(c.before)
        || /^\s*[”"']?\s+(?:does\s+not|did\s+not|never)\s+exist\b/i.test(c.after)) guards.push("denied_existence");
      if (/\b(?:no\s+shares(?:\s+\w+){0,3}\s+under|does\s+not\s+relate\s+to|not\s+registered\s+under|does\s+not\s+amend)\b/i.test(c.before)
        || /\b(?:no\s+additional\s+securities|supersedes|replaces)\b/i.test(c.text))
        guards.push("non_current_context");
      if (/\b(?:historical(?:ly)?|previously\s+registered|previous\s+registration|prior\s+filing|mentioned\s+historically)\b/i.test(c.text))
        guards.push("historical_context");
    }
    const refs = evidence.filter(e => e.documentUrl === doc.documentUrl && e.start < end && e.end > start).map(e => e.ref);
    if (!refs.length) throw new Error("s8_candidate_without_evidence");
    let found = target.find(p => p.kind === kind && p.label === label);
    if (!found) {
      if (target.length >= MAX_CANDIDATES) throw new Error("s8_structured_candidate_limit");
      found = { ref: (kind === "plan_mention" ? "P" : "H") + (target.length + 1), kind, label, occurrences: [] };
      target.push(found);
    }
    found.occurrences.push({ documentUrl: doc.documentUrl, start, end, text: value,
      context: c.text, evidence: refs, guards });
  }
  for (const doc of documents) {
    // Capitalized lexical names; no parser aggregate/classification becomes truth.
    for (const m of doc.text.matchAll(/\b(?:(?:[A-Z][A-Za-z0-9.'&’/-]*|[12][0-9]{3})\s+){1,9}?Plan\b/g))
      add(plans, "plan_mention", doc, m.index!, m[0]);
    for (const m of doc.text.matchAll(/\b333-\d{3,}\b/g)) {
      // A telephone suffix is not a registration identifier.
      if (/\(\d{3}\)\s*$/.test(doc.text.slice(Math.max(0, m.index! - 12), m.index!))) continue;
      add(references, "file_number", doc, m.index!, m[0]);
    }
    for (const m of doc.text.matchAll(/https:\/\/www\.sec\.gov\/Archives\/edgar\/[^\s<>"”]+/g))
      add(references, "sec_url", doc, m.index!, m[0].replace(/[),.;]+$/, ""));
    const dates = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+[12]\d{3}\b/g;
    for (const m of doc.text.matchAll(dates)) {
      const context = clause(doc.text, m.index!, m.index! + m[0].length).text;
      if (/\b(?:Form\s+S-8|registration\s+statement|S-8\s+filed)\b/i.test(context))
        add(references, "filing_date_mention", doc, m.index!, m[0]);
    }
  }
  return { plans, references };
}
