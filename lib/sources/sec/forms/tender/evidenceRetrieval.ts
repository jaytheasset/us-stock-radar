import { renderTenderSource, selectTenderSourceSlices, tenderSourceHash, validateTenderDocument, validateTenderFiling, type TenderSourcePacket, type TenderSourceDocument } from "./evidenceSource.ts";

const aliases = [
  ["maximum", "up to"],
  ["expiration", "expire", "expires", "expired", "extended", "extension", "previously scheduled"],
  ["exchange ratio", "receive", "for each", "share consideration"],
  ["board recommendation", "recommend", "recommends", "recommended", "accept", "reject", "not tender", "take no action"],
  ["proration", "prorated", "pro rata"],
  ["withdrawal", "withdraw", "withdrawn"],
  ["regulatory", "antitrust", "hsr"],
  ["fairness", "fair", "special committee", "opinion"],
];
const stop = new Set("what which is are the a an of to for and or in on was were does did how much many before after issuer third party tender offer".split(" "));
const tokens = (text: string) => [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((t) => t.length > 1 && !stop.has(t));
type Evidence = {
  id: string;
  accession: string;
  form: string;
  document: Omit<TenderSourceDocument, "content">;
  sourceHash: string;
  renderedHash: string;
  textHash: string;
  location: { representation: "tender-render-v1" | "prepared-text-v1"; start: number; end: number; heading: string | null; offsets: "UTF-16-half-open" };
  text: string;
};

/** Transient, filing-scoped source slices. No Parser/Primary/LLM input, fetch or persistence. */
export function buildTenderEvidenceIndex(packet: TenderSourcePacket) {
  validateTenderFiling(packet);
  const filingAccession = packet.accession;
  const filingForm = packet.form;
  const evidence = new Map<string, Evidence>();
  const documents = new Set<string>();
  const unavailable = structuredClone(packet.unavailable);
  const partial: string[] = [];
  for (const source of packet.documents) {
    validateTenderDocument(source, packet);
    if (documents.has(source.documentId)) throw new Error("Duplicate source document identity");
    documents.add(source.documentId);
    if (source.completeness !== "complete") partial.push(source.documentId);
    if (!source.content.trim()) { unavailable.push({ documentId: source.documentId, reason: "empty-source" }); continue; }
    const text = source.format === "html" ? renderTenderSource(source.content) : source.content;
    const sourceHash = tenderSourceHash(source.content);
    const renderedHash = tenderSourceHash(text);
    // Explicit allowlist: JSON callers may carry Parser/Primary fields beside content.
    // A fixed field order also makes IDs independent of input JSON key ordering.
    const document: Evidence["document"] = { accession: source.accession, form: source.form, documentId: source.documentId, url: source.url, role: source.role, format: source.format, completeness: source.completeness };
    for (const slice of selectTenderSourceSlices(text)) {
      const selected = text.slice(slice.start, slice.end);
      const textHash = tenderSourceHash(selected);
      const location: Evidence["location"] = { ...slice, representation: source.format === "html" ? "tender-render-v1" : "prepared-text-v1", offsets: "UTF-16-half-open" };
      const id = `tender:${tenderSourceHash(JSON.stringify([packet.accession, packet.form, document, sourceHash, location, textHash]))}`;
      evidence.set(id, { id, accession: packet.accession, form: packet.form, document, sourceHash, renderedHash, textHash, location, text: selected });
    }
  }
  function scope(accession: string, documentId?: string) {
    if (accession !== filingAccession) throw new Error("Filing not loaded in this index");
    if (documentId && !documents.has(documentId)) throw new Error("Document not loaded in this filing");
  }
  function coverage() { return { unavailable: structuredClone(unavailable), partialDocuments: [...partial], indexedDocuments: [...documents], interpretation: "unassessed-source-only", externalReferences: "not-resolved" }; }
  return {
    search_evidence({ accession, question, documentId, limit = 5 }: { accession: string; question: string; documentId?: string; limit?: number }) {
      scope(accession, documentId);
      if (!question.trim() || question.length > 2000 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Invalid search request");
      const query = tokens(question);
      const normalized = question.toLowerCase();
      const expansions = aliases.filter((group) => group.some((term) => normalized.includes(term))).flat();
      const scored = [...evidence.values()].filter((e) => !documentId || e.document.documentId === documentId).map((e) => {
        const terms = new Set(tokens(e.text));
        const exact = query.filter((t) => terms.has(t));
        const lower = e.text.toLowerCase();
        const expanded = expansions.filter((t) => lower.includes(t));
        // Coverage, not term frequency: long tables do not win merely by repetition.
        // Bare captions/reference lists remain searchable but should not outrank prose.
        const outsideQuotes = e.text.replace(/[“"][^”"]+[”"]/g, "").replace(/\[\/?TABLE\]|\[(?:colspan|rowspan)=[^\]]+\]/g, "");
        const quotedCaptions = /[“"]/.test(e.text) && (outsideQuotes.match(/[a-z]/gi)?.length ?? 0) < 20;
        const captionWeight = !quotedCaptions && /[a-z][.!?](?:\s|$)/i.test(e.text) ? 1 : 0.25;
        const synonymMatches = query.filter(t => !terms.has(t) && aliases.some(group => group.includes(t) && group.some(term => lower.includes(term))));
        const score = captionWeight * ((exact.length + synonymMatches.length) * 4 + Math.min(4, expanded.length)) / Math.sqrt(1 + terms.size / 80);
        return { e, score, matchedTerms: exact, expandedTerms: expanded };
      }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.e.text.length - b.e.text.length || a.e.id.localeCompare(b.e.id));
      const chosen: typeof scored = [];
      for (const candidate of scored) {
        if (chosen.some(({ e }) => e.document.documentId === candidate.e.document.documentId && e.text.replace(/\s+/g, " ") === candidate.e.text.replace(/\s+/g, " "))) continue;
        // Avoid near-identical neighbouring windows crowding out independent evidence.
        if (chosen.some(({ e }) => e.document.documentId === candidate.e.document.documentId && Math.max(0, Math.min(e.location.end, candidate.e.location.end) - Math.max(e.location.start, candidate.e.location.start)) / Math.min(e.text.length, candidate.e.text.length) > 0.8)) continue;
        chosen.push(candidate);
      }
      return { status: chosen.length ? "hits" : (!documents.size || unavailable.length || partial.length ? "source-insufficient" : "retrieval-no-match"), accession, form: filingForm, ...coverage(), remainingMatches: Math.max(0, chosen.length - limit), hits: chosen.slice(0, limit).map(({ e: { text, ...metadata }, score, matchedTerms, expandedTerms }) => ({ ...structuredClone(metadata), chars: text.length, score, matchedTerms, expandedTerms })) };
    },
    read_evidence({ accession, ids, maxChars = 60000 }: { accession: string; ids: string[]; maxChars?: number }) {
      scope(accession);
      if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length || !Number.isInteger(maxChars) || maxChars < 1 || maxChars > 500000) throw new Error("Invalid read request");
      const selected = ids.map((id) => { const value = evidence.get(id); if (!value) throw new Error("Evidence ID not in this filing/source revision"); return value; });
      const requiredChars = selected.reduce((sum, value) => sum + value.text.length, 0);
      if (requiredChars > maxChars) return { status: "needs-larger-context-budget", requiredChars, evidence: [], ...coverage() };
      return { status: "read", requiredChars, evidence: structuredClone(selected), ...coverage() };
    },
  };
}
