import { createHash } from "node:crypto";
import type { ProxyProposalDiscoveryResult, ProxyProposalDiscoverySourcePackage } from "./proposalDiscovery.ts";
import { validateProxyProposalDiscovery, type ProxyAnalysisHandoffResult } from "./proposalDiscovery.ts";

export type ProxyFinalStructuredFilingIdentity = {
  form_type: string;
  accession_number: string | null;
  filing_date: string | null;
  company_name: string | null;
  source_url: string | null;
};

export type ProxyFinalStructuredInput = {
  filing: ProxyFinalStructuredFilingIdentity;
  handoff: ProxyAnalysisHandoffResult;
};

/** Call 1 has already checked source membership. This boundary never receives SEC text. */
export function buildProxyFinalStructuredInput({ filing, stage1 }: {
  filing: ProxyFinalStructuredFilingIdentity;
  stage1: ProxyAnalysisHandoffResult;
}): ProxyFinalStructuredInput {
  // Reuse the unchanged v3 structural validator with only the handoff's ID inventory.
  // These empty records check format/shape, not source membership or semantic truth.
  const root = object(stage1);
  const claims = [
    ...(Array.isArray(root.document_notes) ? root.document_notes : []),
    ...(Array.isArray(root.candidates) ? root.candidates.flatMap(candidate => {
      const value = object(candidate).claims;
      return Array.isArray(value) ? value : [];
    }) : []),
  ];
  const ids = claims.flatMap(claim => {
    const value = object(claim).evidence;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  });
  const validation = validateProxyProposalDiscovery(stage1, {
    evidenceBlocks: [...new Set(ids)].map((id, blockSequence) => ({
      id, blockSequence, blockType: "handoff_reference", text: "",
    })),
  });
  if (!validation.ok || !validation.value) {
    throw new Error(`Proxy Final Structured requires a valid proxy_analysis_handoff_v3: ${validation.errors.join("; ")}`);
  }
  if (typeof filing?.form_type !== "string" || !filing.form_type.trim()) {
    throw new Error("Proxy Final Structured requires a form type");
  }
  for (const key of ["accession_number", "filing_date", "company_name", "source_url"] as const) {
    if (filing[key] !== null && typeof filing[key] !== "string") {
      throw new Error(`Proxy Final Structured filing.${key} must be a string or null`);
    }
  }
  const handoff = validation.value;
  const copyClaim = (claim: ProxyAnalysisHandoffResult["document_notes"][number]) => ({
    text: claim.text, evidence: [...claim.evidence],
  });
  // Explicit projection prevents extra runtime properties from crossing the request boundary.
  return {
    filing: {
      form_type: filing.form_type,
      accession_number: filing.accession_number,
      filing_date: filing.filing_date,
      company_name: filing.company_name,
      source_url: filing.source_url,
    },
    handoff: {
      version: handoff.version,
      document_notes: handoff.document_notes.map(copyClaim),
      candidates: handoff.candidates.map(candidate => ({
        title: candidate.title, claims: candidate.claims.map(copyClaim),
      })),
    },
  };
}

export type ProxySourceFragment = {
  evidence_id: string;
  block_id: string;
  document_id: string;
  original_source_offset: { start: number; end: number; coordinate: "document_text" | "block_text" };
  block_offset: { start: number; end: number };
  text_offset: { start: number; end: number };
};

type Block = {
  id: string; text: string; sequence: number; documentId: string;
  start: number; end: number; originalStart: number | null; sparse: boolean;
};
type Range = { start: number; end: number };
type Heading = Range & { ordinal: string | null; appendix: string | null; kind: "proposal" | "appendix" | "tail" };
type Section = Range & { heading: Heading; text: string };
type Document = { id: string; blocks: Block[]; text: string; headings: Heading[]; sections: Section[] };
type Candidate = ProxyProposalDiscoveryResult["proposals"][number];

// Structural source navigation only. These expressions never classify a proposal or extract FACT values.
const NUMBER = "[0-9]+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE";
const PROPOSAL_LINE = new RegExp(`^[ \\t]*PRO\\s*POSAL\\s+(?:(?:NUMBER|NO\\.?)\\s*)?(${NUMBER})\\b[^\\n]*`, "gim");
const PROPOSAL_REF = new RegExp(`\\bPRO\\s*POSAL\\s+(?:(?:NUMBER|NO\\.?)\\s*)?(${NUMBER})\\b`, "gi");
const ORDINALS = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE"];
const APPENDIX_LINE = /^[ \t]*(?:APPENDIX|ANNEX|EXHIBIT)\s+([A-Z]|[0-9]+)[ \t]*$/gim;
const APPENDIX_REF = /\b(?:Appendix|Annex|Exhibit)\s+([A-Z]|[0-9]+)\b/gi;
const CARD_HEADING = /^(?:(?:TO )?VOTE BY|REVERSE SIDE OF PROXY CARD|SCAN TO (?:VIEW|VOTE)|Mark, sign and date your Proxy Card)/i;
const TAIL_LINE = /^[ \t]*(?:(?:SECURITY|SECURITIES)\s+OWNERSHIP[^\n]*|PRINCIPAL STOCKHOLDERS[^\n]*|BENEFICIAL OWNERSHIP[^\n]*|OWNERSHIP OF CERTAIN[^\n]*|ADDITIONAL INFORMATION[^\n]*|OTHER (?:BUSINESS|MATTERS)[^\n]*|(?:FUTURE |20[0-9]{2} )?(?:STOCKHOLDER|SHAREHOLDER) PROPOSALS[^\n]*|INFORMATION ABOUT SOLICITATION AND VOTING|INTERNET AVAILABILITY[^\n]*|QUESTIONS AND ANSWERS[^\n]*|HOUSEHOLDING[^\n]*|WHERE YOU CAN FIND[^\n]*|INCORPORATION BY REFERENCE[^\n]*|FORWARD[ -]LOOKING[^\n]*|IMPORTANT NOTICE[^\n]*|(?:TO )?VOTE BY[^\n]*|REVERSE SIDE OF PROXY CARD|SCAN TO (?:VIEW|VOTE)[^\n]*|Mark, sign and date your Proxy Card[^\n]*)$/gim;
const STOP = new Set(("about adopt adoption amendment amended and approve approval asking at be board by certificate company common corporation determined directors discretion effect for from incorporation inclusive is issued it its number of on or our outstanding proposal range ranging ratio restated selected shareholders shares sole stock stockholders that the their this to total upon vote we which with would" ).split(" "));

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function tokens(text: string) {
  return new Set(text.replace(/\bPRO\s*POSAL\b/gi, "proposal").toLowerCase().match(/[a-z][a-z0-9]*/g)?.filter(t => t.length > 2 && !STOP.has(t)) || []);
}
function normalize(text: string) { return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
function relevance(text: string, candidate: Candidate) {
  // A rival's action summary may mention this proposal as a dependency. Source ownership follows its title instead.
  const query = tokens(candidate.title), found = tokens(text);
  return query.size ? [...query].filter(t => found.has(t)).length / query.size : 0;
}
function ordinal(text: string) {
  const index = ORDINALS.indexOf(text.toUpperCase());
  return index < 0 ? String(Number(text)) : String(index + 1);
}
function appendixKey(match: RegExpMatchArray) { return `${match[0].trim().split(/\s+/)[0].toUpperCase()}:${match[1].toUpperCase()}`; }
function intersects(a: Range, b: Range) { return a.start < b.end && b.start < a.end; }
function trimRange(text: string, range: Range): Range {
  const part = text.slice(range.start, range.end);
  return { start: range.start + part.length - part.trimStart().length, end: range.end - (part.length - part.trimEnd().length) };
}
function units(text: string, range: Range): Range[] {
  // Blank paragraphs and numbered/bulleted agenda rows are boundaries, even inside a shared source block.
  const part = text.slice(range.start, range.end);
  const cuts = [0, ...[...part.matchAll(/\n\s*\n|[;,](?=\s*(?:and\s+)?[“"']?\s*FOR\b)|\n(?=[ \t]*(?:[0-9]+[.)]|[•●▪])\s)/g)].map(m => m.index! + m[0].length), part.length];
  return cuts.slice(0, -1).map((start, i) => trimRange(text, { start: range.start + start, end: range.start + cuts[i + 1] }))
    .filter(r => r.end > r.start);
}

function anchorUnits(text: string, range: Range): Range[] {
  // Selected excerpts can collapse several source paragraphs. Split only their context into exact sentence slices.
  // The selected main section and its tables are still kept whole, not filtered sentence by sentence.
  return units(text, range).flatMap(r => {
    const part = text.slice(r.start, r.end);
    const cuts = [0, ...[...part.matchAll(/(?<=[a-zA-Z][.!?])\s+(?=(?:[0-9]+\s+)?[A-Z“"])/g)].map(m => m.index! + m[0].length), part.length];
    return cuts.slice(0, -1).map((start, i) => trimRange(text, { start: r.start + start, end: r.start + cuts[i + 1] }))
      .filter(piece => piece.end > piece.start);
  });
}

function documents(sourcePackage: ProxyProposalDiscoverySourcePackage, candidates: Candidate[]): Document[] {
  const groups = new Map<string, Block[]>(), seen = new Set<string>();
  sourcePackage.evidenceBlocks.forEach((value, index) => {
    const raw = object(value), source = object(value.source);
    if (!/^E[1-9][0-9]*$/.test(value.id) || seen.has(value.id)) throw new Error(`Invalid or duplicate source evidence ID: ${value.id}`);
    if (typeof value.text !== "string" || !value.text.trim()) throw new Error(`Source evidence ${value.id} has empty text`);
    seen.add(value.id);
    const documentId = typeof raw.documentId === "string" ? raw.documentId
      : `source-document:${source.documentIndex ?? source.documentSequence ?? 0}:${source.origin ?? "blocks"}`;
    // An offset without a coordinate's source is never relabelled as a filing/document offset.
    const originalStart = Number.isInteger(source.startChar) && Number.isInteger(source.endChar)
      && Number(source.endChar) - Number(source.startChar) === value.text.length ? Number(source.startChar) : null;
    const block: Block = { id: value.id, text: value.text, documentId, sequence: Number.isInteger(value.blockSequence) ? value.blockSequence : index,
      originalStart, sparse: value.blockType === "proxy_source_block" && typeof raw.documentId !== "string" && originalStart === null, start: 0, end: 0 };
    const group = groups.get(documentId) || []; group.push(block); groups.set(documentId, group);
  });
  const metadata = object(sourcePackage).documents;
  return [...groups].map(([id, blocks]) => {
    const located = blocks.every(b => b.originalStart !== null);
    blocks.sort((a, b) => (located ? a.originalStart! - b.originalStart! : 0) || a.sequence - b.sequence || a.id.localeCompare(b.id));
    let text = "";
    for (const b of blocks) { if (text) text += "\n\n"; b.start = text.length; text += b.text; b.end = text.length; }
    const meta = Array.isArray(metadata) ? metadata.map(object).find(d => d.documentId === id) : undefined;
    // Legacy chunk packages have no offsets. Recover document coordinates only with an exact source hash proof.
    if (meta && createHash("sha256").update(text).digest("hex") === meta.normalizedTextSha256) {
      blocks.forEach(b => { b.originalStart = b.start; });
    }
    const headings: Heading[] = [];
    for (const m of text.matchAll(PROPOSAL_LINE)) {
      if (/“FOR”|"FOR"/.test(m[0])) continue; // A wrapped recommendation list is not a section heading.
      headings.push({ start: m.index!, end: m.index! + m[0].length, ordinal: ordinal(m[1]), appendix: null, kind: "proposal" });
    }
    for (const m of text.matchAll(APPENDIX_LINE)) headings.push({ start: m.index!, end: m.index! + m[0].length, ordinal: null, appendix: appendixKey(m), kind: "appendix" });
    for (const m of text.matchAll(TAIL_LINE)) headings.push({ start: m.index!, end: m.index! + m[0].length, ordinal: null, appendix: null, kind: "tail" });
    // Excerpts without physical adjacency and gaps/overlaps in recorded source coordinates are hard boundaries.
    for (let i = 1; i < blocks.length; i++) {
      const previous = blocks[i - 1], current = blocks[i];
      const gap = previous.originalStart !== null && current.originalStart !== null
        ? current.originalStart - (previous.originalStart + previous.text.length) : null;
      if (previous.sparse || current.sparse || gap !== null && (gap < 0 || gap > 2)) {
        if (!headings.some(h => h.start === current.start)) headings.push({ start: current.start, end: current.start, ordinal: null, appendix: null, kind: "tail" });
      }
    }
    // Some filings have only the original, unnumbered title (or OCR splits the word PROPOSAL).
    for (const m of text.matchAll(/^[ \t]*[A-Z][A-Z ,’'“”()/:.\-]{8,}[^\n]*(?:\n[A-Z][A-Z ,’'“”()/:.\-]{8,}[^\n]*)?/gm)) {
      const headingText = m[0].trim();
      if (/^(?:OUR BOARD|THE BOARD|VOTE |IMPORTANT |UNITED |SECURITIES |CERTIFICATE |FORM |TO |OF )/.test(headingText)) continue;
      if (!candidates.some(c => normalize(headingText) === normalize(c.title))) continue;
      if (headings.some(h => h.start === m.index! || h.kind === "proposal" && h.ordinal !== null
        && h.end <= m.index! && /^\s*$/.test(text.slice(h.end, m.index!)))) continue;
      headings.push({ start: m.index!, end: m.index! + m[0].length, ordinal: null, appendix: null, kind: "proposal" });
    }
    headings.sort((a, b) => a.start - b.start);
    const deduped = headings.filter((h, i) => !i || h.start !== headings[i - 1].start);
    // Consecutive "PROPOSAL NUMBER N" / "PROPOSAL N: title" labels are one physical heading.
    const merged: Heading[] = [];
    for (const h of deduped) {
      const last = merged.at(-1);
      if (last?.ordinal && last.ordinal === h.ordinal && h.start - last.end < 100) last.end = h.end;
      else merged.push({ ...h });
    }
    const sections = merged.map((h, i) => ({ start: h.start, end: merged[i + 1]?.start ?? text.length, heading: h, text: text.slice(h.start, merged[i + 1]?.start ?? text.length) }));
    return { id, blocks, text, headings: merged, sections };
  });
}

function ownsUnit(text: string, candidate: Candidate, candidates: Candidate[]) {
  // Retrieval similarity is only a location selector; it never supplies or adjudicates an analysis value.
  const score = relevance(text, candidate);
  if (score < 0.3 || /(?:please sign|signature \[|proxy.vote form|authorized signatures|side of (?:this |the )?proxy card|proxy and attorney-in-fact|the undersigned stockholder|continued and to be signed)/i.test(text)) return false;
  return candidates.every(other => other === candidate || normalize(other.title) === normalize(candidate.title)
    || relevance(text, other) < score);
}

function headingScore(section: Section, candidate: Candidate) {
  let heading = section.text.slice(0, section.heading.end - section.start);
  if (tokens(heading).size === 0 || tokens(heading).size === 1 && tokens(heading).has("number")) {
    const following = section.text.slice(heading.length).trimStart().split("\n");
    heading += following[0];
    // Continue a wrapped uppercase title, not its following explanatory sentences or dependency discussion.
    for (const line of following.slice(1)) {
      const titleLine = line.replace(/\(\s*(?:Item|Proposal)\s+[0-9]+\s+on\s+the\s+Proxy\s+Card\s*\)\s*$/i, "");
      if (!line.trim() || /[a-z]/.test(titleLine)) break;
      heading += ` ${line}`;
    }
  }
  const query = tokens(candidate.title), found = tokens(heading);
  const shared = [...found].filter(t => query.has(t)).length;
  return shared / Math.max(1, Math.sqrt(query.size * found.size));
}

function selectRanges(doc: Document, candidate: Candidate, candidates: Candidate[]): Range[] {
  const anchors = doc.blocks.filter(b => candidate.evidence.includes(b.id));
  if (!anchors.length) return [];
  const anchoredUnits = anchors.flatMap(b => anchorUnits(doc.text, b));
  const refs = new Set(anchoredUnits.filter(r => ownsUnit(doc.text.slice(r.start, r.end), candidate, candidates))
    .flatMap(r => [...doc.text.slice(r.start, r.end).matchAll(PROPOSAL_REF)].map(m => ordinal(m[1]))));
  const eligible = doc.sections.filter(s => s.heading.kind === "proposal" && headingScore(s, candidate) >= 0.2
    && (anchors.some(a => intersects(a, s)) || (s.heading.ordinal !== null && refs.has(s.heading.ordinal))));
  const substantive = eligible.filter(s => s.text.length - (s.heading.end - s.start) >= 2_000);
  const primary = (substantive.length ? substantive : eligible).map(s => ({ section: s, score: headingScore(s, candidate) * 100 + Math.min(25, Math.log2(s.text.length + 1) * 2) }))
    .sort((a, b) => b.score - a.score || b.section.text.length - a.section.text.length)[0]?.section;
  const ranges: Range[] = primary ? [{ start: primary.start, end: primary.end }] : [];
  const otherBodies = doc.sections.filter(s => s !== primary && s.heading.kind === "proposal"
    && (primary?.heading.ordinal && s.heading.ordinal && s.heading.ordinal !== primary.heading.ordinal
      || candidates.some(other => other !== candidate && headingScore(s, other) > headingScore(s, candidate))));
  for (const r of anchoredUnits) {
    if (primary && intersects(r, primary)) continue;
    if (otherBodies.some(s => intersects(s, r))) continue;
    const raw = doc.text.slice(r.start, r.end);
    if (doc.sections.some(s => s.heading.appendix && intersects(s, r))) continue;
    if (!/^[\s(]*[0-9]+[.)]?\s/.test(raw) && doc.sections.some(s => s.heading.kind === "tail"
      && CARD_HEADING.test(doc.text.slice(s.heading.start, s.heading.end)) && intersects(s, r))) continue;
    if (ownsUnit(raw, candidate, candidates) && !raw.includes("|")) ranges.push(r);
  }
  // Follow explicit, source-stated references only, within this source document. No parent-document guessing.
  const appendixIds = new Set(ranges.flatMap(r => [...doc.text.slice(r.start, r.end).matchAll(APPENDIX_REF)].map(appendixKey)));
  // Some sources call an attachment Annex A in the body and Appendix A on the attachment.
  // Accept the source-stated letter only when there is exactly one physical attachment with that letter.
  for (const key of [...appendixIds]) {
    if (doc.sections.some(s => s.heading.appendix === key)) continue;
    const matches = doc.sections.filter(s => s.heading.appendix?.split(":")[1] === key.split(":")[1]);
    if (matches.length === 1) appendixIds.add(matches[0].heading.appendix!);
  }
  // A selected passage already inside an appendix is also a physical anchor, not a guessed attachment.
  for (const s of doc.sections.filter(s => s.heading.appendix && anchors.some(a => intersects(a, s)))) {
    const score = relevance(s.text.slice(0, 600), candidate);
    if (score >= 0.3 && candidates.every(c => c === candidate || relevance(s.text.slice(0, 600), c) < score)) appendixIds.add(s.heading.appendix!);
  }
  for (const section of doc.sections.filter(s => s.heading.appendix && appendixIds.has(s.heading.appendix))) {
    const related = candidates.filter(c => c !== candidate && (doc.blocks.some(b => c.evidence.includes(b.id) && intersects(b, section))
      || doc.sections.some(s => s.heading.kind === "proposal" && headingScore(s, c) >= 0.5
        && [...s.text.matchAll(APPENDIX_REF)].some(m => appendixKey(m) === section.heading.appendix))));
    if (!related.length) ranges.push(section);
    else {
      // A shared certificate may amend several unrelated charter clauses. Keep its label plus only this candidate's clauses.
      const firstClause = /\n\s*[0-9]+\./.exec(section.text);
      ranges.push({ start: section.start, end: firstClause ? section.start + firstClause.index : section.heading.end });
      const paragraphs = units(doc.text, section);
      for (let i = 0; i < paragraphs.length; i++) {
        const r = paragraphs[i], raw = doc.text.slice(r.start, r.end);
        // Keep common legal context and the candidate's clauses, but not a rival's separate amendment.
        // A numbered lead-in and the quoted paragraph it introduces must travel together.
        const leadIn = /(?:hereby amended|following paragraph|replacing|shall read)/i.test(raw);
        if (leadIn && i + 1 < paragraphs.length) continue;
        const score = relevance(raw, candidate);
        if (related.some(other => relevance(raw, other) >= 0.3 && relevance(raw, other) > score)) continue;
        if (i && /(?:hereby amended|following paragraph|replacing|shall read)/i.test(doc.text.slice(paragraphs[i - 1].start, paragraphs[i - 1].end))) ranges.push(paragraphs[i - 1]);
        ranges.push(r);
      }
    }
  }
  return ranges.map(r => trimRange(doc.text, r)).filter(r => r.end > r.start);
}

function mergeRanges(ranges: Range[]) {
  const merged: Range[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)) {
    const last = merged.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

export function buildProposalSourceSections(stage1: ProxyProposalDiscoveryResult, sourcePackage: ProxyProposalDiscoverySourcePackage) {
  const docs = documents(sourcePackage, stage1.proposals), allIds = new Set(docs.flatMap(d => d.blocks.map(b => b.id)));
  for (const id of [...stage1.meeting.evidence, ...stage1.proposals.flatMap(p => p.evidence)]) {
    if (!allIds.has(id)) throw new Error(`Proxy Final Structured references unknown Stage 1 evidence ${id}`);
  }
  return stage1.proposals.map((candidate, index) => {
    const pieces: Array<{ block: Block; start: number; end: number }> = [];
    for (const doc of docs) {
      for (const r of mergeRanges(selectRanges(doc, candidate, stage1.proposals))) {
        for (const block of doc.blocks.filter(b => intersects(b, r))) {
          const clipped = trimRange(block.text, { start: Math.max(r.start, block.start) - block.start, end: Math.min(r.end, block.end) - block.start });
          if (clipped.end > clipped.start) pieces.push({ block, ...clipped });
        }
      }
    }
    let text = "";
    const fragments: ProxySourceFragment[] = [], seenText = new Set<string>();
    const covered = new Map<string, Range[]>();
    const fingerprint = (piece: typeof pieces[number]) => piece.block.text.slice(piece.start, piece.end).replace(/\s+/g, " ").trim();
    const dedupedPieces = pieces.filter((piece, index) => {
      const raw = fingerprint(piece);
      return !pieces.some((other, otherIndex) => otherIndex !== index && fingerprint(other).includes(raw)
        && (fingerprint(other).length > raw.length || (other.block.originalStart !== null && piece.block.originalStart === null)
          || fingerprint(other) === raw && other.block.originalStart === piece.block.originalStart && otherIndex < index));
    });
    for (const piece of dedupedPieces) {
      const { block } = piece;
      const coordinate = block.originalStart === null ? "block_text" : "document_text";
      const base = block.originalStart ?? 0;
      const key = `${block.documentId}:${coordinate}:${coordinate === "block_text" ? block.id : ""}`;
      let remaining = [{ start: base + piece.start, end: base + piece.end }];
      for (const old of covered.get(key) || []) remaining = remaining.flatMap(r => !intersects(r, old) ? [r] : [
        { start: r.start, end: Math.min(r.end, old.start) }, { start: Math.max(r.start, old.end), end: r.end },
      ].filter(r => r.end > r.start));
      for (const r of remaining) {
        const start = r.start - base, end = r.end - base, raw = block.text.slice(start, end);
        const normalized = raw.replace(/\s+/g, " ").trim();
        if (!normalized || seenText.has(normalized)) continue;
        if (text) text += "\n\n";
        const offset = text.length; text += raw; seenText.add(normalized);
        fragments.push({ evidence_id: block.id, block_id: block.id, document_id: block.documentId,
          original_source_offset: { start: r.start, end: r.end, coordinate }, block_offset: { start, end }, text_offset: { start: offset, end: text.length } });
        covered.set(key, mergeRanges([...(covered.get(key) || []), r]));
      }
    }
    if (!text || !fragments.length) throw new Error(`Proxy Final Structured found no source-backed evidence anchor for P${index + 1}; no full-document fallback is allowed`);
    const evidence = [...new Set(fragments.map(f => f.evidence_id))];
    return { proposal_id: `P${index + 1}`, title: candidate.title, action_summary: candidate.action_summary,
      evidence: candidate.evidence.filter(id => evidence.includes(id)), local_section: { evidence, text, fragments } };
  });
}
