import { buildS8DirectFacts, hash, stable, type S8Document } from "./directFacts.ts";
import { decodeSecHtmlEntities } from "../sources/sec/htmlEntities.ts";
import { contextPreservingChunks } from "../sources/sec/forms/common/contextPreservingChunks.ts";

export const S8_STRUCTURED_SOURCE_VERSION = "s8_structured_source_v1";
/** Presentation-only normalization. Original documents and hashes remain authoritative. */
export function s8NeutralText(html: string) {
  return decodeSecHtmlEntities(html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(?:p|div|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/[^\S\n]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function buildS8StructuredSource(rawItem: Record<string, unknown>) {
  // Existing canonical builder independently checks accession, issuer contexts,
  // retained SEC URLs/hashes, lexical quantities and evidence. No Primary input.
  const direct = buildS8DirectFacts(rawItem);
  const documents = direct.source.documents as S8Document[];
  if (documents.some(d => d.truncated)) throw new Error("s8_structured_truncated_source");
  const evidence: Array<{ ref: string; documentUrl: string; documentSha256: string;
    normalizedSha256: string; start: number; end: number; text: string }> = [];
  let total = 0;
  for (const doc of documents) {
    const text = s8NeutralText(doc.text);
    total += text.length;
    if (total > 120_000) throw new Error("s8_structured_source_limit");
    let cursor = 0;
    for (const chunk of contextPreservingChunks(text, 4000)) {
      const start = text.indexOf(chunk, cursor);
      if (start < 0) throw new Error("s8_structured_chunk_locator_invalid");
      evidence.push({ ref: `E${evidence.length + 1}`, documentUrl: doc.url,
        documentSha256: doc.sha256, normalizedSha256: hash(text), start,
        end: start + chunk.length, text: chunk });
      cursor = start + chunk.length;
    }
  }
  if (!evidence.length || evidence.length > 64) throw new Error("s8_structured_evidence_limit");
  const directRows = direct.facts.registrationRows.map((row, index) => ({
    ref: `R${index + 1}`, ...row,
  }));
  const content = { version: S8_STRUCTURED_SOURCE_VERSION,
    identity: { accession: direct.facts.accessionNumber, issuerCik: direct.facts.issuerCik,
      form: String(direct.facts.formType), filingDate: direct.facts.filingDate },
    sourceSha256: direct.sourceSha256, directFactsSha256: direct.factsSha256,
    directRows, evidence, limitations: direct.facts.limitations };
  return { ...content, fingerprint: hash(stable(content)) };
}
export type S8StructuredSource = ReturnType<typeof buildS8StructuredSource>;
export function assertS8StructuredSource(source: S8StructuredSource) {
  const { fingerprint, ...content } = source;
  if (hash(stable(content)) !== fingerprint) throw new Error("s8_structured_package_changed");
}
