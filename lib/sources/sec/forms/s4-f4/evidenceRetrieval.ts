import { createHash } from "node:crypto";
import type { selectS4F4Sources } from "./sourceSelector.ts";

type SelectedPacket = ReturnType<typeof selectS4F4Sources>;
type Role = SelectedPacket["documents"][number]["role"];
const VERSION = "s4-f4-evidence-v1";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const id = (kind: string, value: unknown) => `${kind}:${sha(JSON.stringify(value))}`;
const normalize = (value: string) => value.toLowerCase().replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const STOP = new Set("a an and are as at be by can does for from how in is it of on or the to what when which who with".split(" "));
const tokens = (value: string) => [...new Set((normalize(value).match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOP.has(t)))];

// Search hints only. These labels never assert that an obligation/event exists or is satisfied.
const TOPICS = {
  transaction: /\b(merger|business combination|transaction structure)\b/i,
  consideration: /\b(consideration|purchase price|exchange ratio)\b/i,
  vote_meeting: /\b(vot\w*|meeting|proposal|quorum)\b/i,
  closing: /\b(closing|conditions precedent|consummation)\b/i,
  regulatory: /\b(regulatory|antitrust|HSR|governmental approv\w*)\b/i,
  termination: /\b(termination|outside date|end date|cure|cured)\b/i,
  financing: /\b(PIPE|financing|subscription|cash|proceeds)\b/i,
  ownership: /\b(ownership|equity stake|dilution|redemption scenario)\b/i,
  exchange_offer: /\b(exchange offer|tender\w*|withdrawal)\b/i,
} as const;
export type S4F4EvidenceTopic = keyof typeof TOPICS;

interface EvidenceRange {
  ref: string;
  sectionRef: string;
  documentRef: string;
  heading: string;
  /** A rendered-text caption hint, NOT a recovered HTML heading level. */
  caption: string | null;
  textStart: number;
  textEnd: number;
  textSha256: string;
  topics: S4F4EvidenceTopic[];
  tables: Array<{ textStart: number; textEnd: number }>;
  boundary: "whole-selected-section" | "caption-delimited";
}

/** Only standalone title-like paragraphs outside tables are candidate read boundaries.
 * Small sections remain intact. There is no hard truncation or sentence/byte slicing.
 * Ambiguous large sections stay large and are reported as over-budget by search.
 */
function ranges(text: string): Array<{ start: number; end: number; caption: string | null }> {
  if (text.length <= 20_000) return [{ start: 0, end: text.length, caption: null }];
  const starts: Array<{ start: number; caption: string | null }> = [{ start: 0, caption: null }];
  const tables = tableRanges(text, 0);
  for (const match of text.matchAll(/(?:^|\n\n)([^\n]+)(?=\n\n|$)/g)) {
    const start = match.index + match[0].indexOf(match[1]);
    if (tables.some((t) => start >= t.textStart && start < t.textEnd)) continue;
    const caption = match[1].trim();
    const words = caption.split(/\s+/);
    if (caption.length < 6 || caption.length > 140 || words.length < 2
      || /[|\[\]“”".;:?!]/.test(caption) || /^table of contents$/i.test(caption)
      || !/^[A-Z]/.test(caption)
      || !words.every((w) => /^[A-Z][A-Za-z’'()/-]*$/.test(w) || /^(a|an|and|as|at|by|for|from|in|of|on|or|the|to|with|under|upon|after|before)$/.test(w))) continue;
    if (start) starts.push({ start, caption });
    else starts[0].caption = caption;
  }
  return starts.map((s, i) => ({ ...s, end: starts[i + 1]?.start ?? text.length }));
}

function tableRanges(text: string, offset: number) {
  const result: Array<{ textStart: number; textEnd: number }> = [];
  let depth = 0, start = 0;
  for (const m of text.matchAll(/\[\/?TABLE\]/g)) {
    if (m[0] === "[TABLE]") { if (!depth) start = m.index; depth++; }
    else {
      if (!depth) throw new Error("Unbalanced selected table markers");
      if (!--depth) result.push({ textStart: offset + start, textEnd: offset + m.index + m[0].length });
    }
  }
  if (depth) throw new Error("Unbalanced selected table markers");
  return result;
}

export interface S4F4EvidenceQuery {
  query: string;
  /** Quoted phrases in query and these phrases must occur verbatim (whitespace/case folded). */
  phrases?: string[];
  topics?: S4F4EvidenceTopic[];
  role?: Role; // current by default; parent/exhibit require explicit requests
  accession?: string;
  limit?: number;
  /** Oversize candidates are reported, never silently clipped or replaced by fragments. */
  maxChars?: number;
}

/** Minimal in-memory search/read seam for a future MCP adapter. No IO, DB or provider.
 * Text lives only in the supplied selector packet. The exported map contains references.
 */
export function buildS4F4EvidenceIndex(packet: SelectedPacket) {
  if (packet.version !== "s4-f4-core-sections-v1" || !["S-4", "F-4", "S-4/A", "F-4/A"].includes(packet.form)
    || packet.documents.filter((d) => d.role === "current").length !== 1) throw new Error("Invalid S-4/F-4 selector packet");
  const documents = packet.documents.map((d) => {
    if ((d.role === "parent" && d.purpose !== "amendment-comparison")
      || (d.role === "exhibit" && d.purpose !== "direct-supplement")
      || !["current", "parent", "exhibit"].includes(d.role)) throw new Error("Invalid document role/purpose");
    return { ref: id("document", [packet.form, d.accession, d.url, d.filename, d.role, d.purpose, d.sha256]),
      accession: d.accession, url: d.url, filename: d.filename, role: d.role, purpose: d.purpose,
      htmlSha256: d.sha256 };
  });
  const sections: Array<{ ref: string; documentRef: string; heading: string; reason: string;
    htmlStart: number; htmlEnd: number; textChars: number; textSha256: string }> = [];
  const units: EvidenceRange[] = [];
  const bindings = new Map<string, { documentIndex: number; sectionIndex: number }>();
  const searchText = new Map<string, { terms: Set<string>; headingTerms: Set<string> }>();
  packet.documents.forEach((d, di) => d.sections.forEach((s, si) => {
    const documentRef = documents[di].ref, textSha256 = sha(s.text);
    const sectionRef = id("section", [VERSION, documentRef, s.heading, s.reason, s.htmlStart, s.htmlEnd, textSha256]);
    if (bindings.has(sectionRef)) throw new Error("Duplicate section identity");
    sections.push({ ref: sectionRef, documentRef, heading: s.heading, reason: s.reason,
      htmlStart: s.htmlStart, htmlEnd: s.htmlEnd, textChars: s.text.length, textSha256 });
    bindings.set(sectionRef, { documentIndex: di, sectionIndex: si });
    for (const range of ranges(s.text)) {
      const text = s.text.slice(range.start, range.end);
      const ref = id("evidence", [VERSION, sectionRef, range.start, range.end, sha(text)]);
      const unit: EvidenceRange = { ref, sectionRef, documentRef, heading: s.heading, caption: range.caption,
        textStart: range.start, textEnd: range.end, textSha256: sha(text),
        topics: (Object.keys(TOPICS) as S4F4EvidenceTopic[]).filter((t) => TOPICS[t].test(text)),
        tables: tableRanges(text, range.start),
        boundary: range.start === 0 && range.end === s.text.length ? "whole-selected-section" : "caption-delimited" };
      units.push(unit);
      searchText.set(ref, { terms: new Set(tokens(text)), headingTerms: new Set(tokens(range.caption ?? s.heading)) });
    }
  }));
  // Private metadata cannot be changed by callers through the public map or search results.
  const map = { version: VERSION, selectorVersion: packet.version, form: packet.form, documents, sections, units,
    coordinates: "Half-open UTF-16. htmlStart/htmlEnd locate the whole selected section in original HTML; textStart/textEnd locate the read unit in selector-rendered section text. They are not interchangeable.",
    limitations: ["Retrieval topics and captions are hints, not facts or verified HTML hierarchy.",
      "Table markers/cells and surrounding text are preserved; footnote associations are not inferred. Read sectionRef for broader context.",
      "No hit does not establish absence. Unselected/external references remain unresolved; no reference traversal.",
      "The HTML hash is supplied by the selector; this index does not independently re-fetch the original."] };

  function read(ref: string) {
    const unit = units.find((u) => u.ref === ref);
    const section = sections.find((s) => s.ref === (unit?.sectionRef ?? ref));
    if (!section) throw new Error("Unknown evidence reference");
    const binding = bindings.get(section.ref)!;
    const original = packet.documents[binding.documentIndex], source = original?.sections[binding.sectionIndex];
    const document = documents.find((d) => d.ref === section.documentRef)!;
    if (!source || id("document", [packet.form, original.accession, original.url, original.filename, original.role, original.purpose, original.sha256]) !== document.ref
      || sha(source.text) !== section.textSha256 || source.heading !== section.heading || source.reason !== section.reason
      || source.htmlStart !== section.htmlStart || source.htmlEnd !== section.htmlEnd) throw new Error("Stale or mutated selector packet");
    return structuredClone({ ref, document, section, range: unit ?? null,
      text: source.text.slice(unit?.textStart ?? 0, unit?.textEnd ?? source.text.length),
      coordinates: map.coordinates, limitations: map.limitations });
  }

  function search(input: S4F4EvidenceQuery) {
    const limit = input.limit ?? 4, maxChars = input.maxChars ?? 60_000;
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isFinite(maxChars) || maxChars < 1) throw new Error("Invalid retrieval budget");
    const phrases = [...(input.phrases ?? []), ...[...input.query.matchAll(/["“]([^"”]+)["”]/g)].map((m) => m[1])].map(normalize).filter(Boolean);
    const queryTerms = tokens(input.query);
    const candidates = units.filter((u) => {
      const d = documents.find((d) => d.ref === u.documentRef)!;
      return d.role === (input.role ?? "current") && (!input.accession || input.accession === d.accession)
        && (!input.topics?.length || input.topics.some((t) => u.topics.includes(t)));
    });
    const frequency = new Map(queryTerms.map((t) => [t, candidates.filter((u) => searchText.get(u.ref)!.terms.has(t)).length]));
    const ranked = candidates.flatMap((u) => {
      // Reading also validates provenance before exposing any search result.
      const evidence = read(u.ref), folded = normalize(evidence.text);
      if (!phrases.every((p) => folded.includes(p))) return [];
      const indexed = searchText.get(u.ref)!;
      const matchedTerms = queryTerms.filter((t) => indexed.terms.has(t));
      if (!matchedTerms.length && !phrases.length && !input.topics?.length) return [];
      const score = matchedTerms.reduce((sum, t) => sum + Math.log(1 + candidates.length / (1 + frequency.get(t)!))
        * (indexed.headingTerms.has(t) ? 2 : 1), 0) * (matchedTerms.length / Math.max(1, queryTerms.length)) ** 2
        / Math.sqrt(1 + evidence.text.length / 6000);
      return [{ ...u, document: evidence.document, chars: evidence.text.length, score, matchedTerms, matchedPhrases: phrases }];
    }).sort((a, b) => b.score - a.score || a.ref.localeCompare(b.ref));
    // Preserve rank: a budget failure is visible and does not silently substitute weaker evidence.
    const selected = ranked.slice(0, limit), hits: typeof selected = [], deferred: typeof selected = [];
    let chars = 0;
    for (const hit of selected) {
      if (chars + hit.chars > maxChars) deferred.push(hit);
      else { hits.push(hit); chars += hit.chars; }
    }
    return structuredClone({ status: !ranked.length ? "no-match-in-selected-source" : deferred.length ? "needs-larger-context-budget" : "retrieved",
      hits, deferred, returnedChars: chars, matchedUnits: ranked.length, remainingMatches: ranked.length - selected.length,
      limitations: map.limitations });
  }
  return { map: structuredClone(map), search, read };
}
