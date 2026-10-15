// Candidate-only source extraction. No ingest hook, persistence, canonical publication or Alert dispatch.
import { createHash } from "node:crypto";
import Ajv from "ajv";
import { inspectSec425Currentness, inspectSec425Identity, compareSec425PartyIdentities, type Sec425ActionContext, type Sec425IdentityEvidence } from "./verification.ts";

export const SEC425_FACT_CANDIDATE_VERSION = "sec425_fact_candidate_v2";
export const SEC425_ANNOUNCEMENT_TYPES = ["new_acquisition_proposal", "revised_acquisition_proposal", "definitive_agreement_signed"] as const;
export const SEC425_TRANSACTION_TYPES = ["acquisition", "merger", "tender_offer", "exchange_offer", "spac_business_combination", "asset_acquisition"] as const;
export type Sec425Proof = { block_id: string; source_field: "heading" | "text"; quote: string };
export type Sec425Bound<T> = { value: T | null; evidence: Sec425Proof[] };
export type Sec425FactOutput = {
  decision: "confirmed" | "not_applicable" | "uncertain";
  reason: string;
  evidence: Sec425Proof[];
  action_context?: Sec425ActionContext;
  announcement: null | {
    announcement_type: typeof SEC425_ANNOUNCEMENT_TYPES[number] | null;
    transaction_types: typeof SEC425_TRANSACTION_TYPES[number][] | null;
    parties: {
      name: string | null;
      role: "acquirer" | "target" | "merger_sub" | "adviser" | "partner" | "other" | null;
      ticker: string | null;
      participation: string | null;
      evidence: Sec425Proof[];
    }[];
    statement: string | null;
    key_terms: Sec425Bound<string>[];
  };
};
export type Sec425FactSource = { accession: string; sourceUrl: string; sourceSha256: string; representation: "raw_html" | "sec_public_text_excerpt" };
export type Sec425FactBlock = { block_id: string; text: string; heading?: string | null };

const string = { type: "string", minLength: 1 };
const object = (properties: Record<string, unknown>) => ({ type: "object", additionalProperties: false, required: Object.keys(properties), properties });
const proof = object({ block_id: string, source_field: { type: "string", enum: ["heading", "text"] }, quote: { ...string, maxLength: 240 } });
const evidence = { type: "array", items: proof };
const nullable = (values?: readonly string[]) => ({ type: ["string", "null"], ...(values ? { enum: [...values, null] } : { minLength: 1 }) });
export const SEC425_ACTION_CONTEXT_SCHEMA = object({
  disclosure_context: { type: "string", enum: ["current_announcement", "prior_background", "unclear"] },
  action_date_literal: nullable(), action_evidence: evidence, context_evidence: evidence,
});
export const SEC425_FACT_LOCAL_SCHEMA = object({
  decision: { type: "string", enum: ["confirmed", "not_applicable", "uncertain"] }, reason: string, evidence,
  announcement: { ...object({
    announcement_type: nullable(SEC425_ANNOUNCEMENT_TYPES),
    transaction_types: { type: ["array", "null"], items: { type: "string", enum: SEC425_TRANSACTION_TYPES } },
    parties: { type: "array", minItems: 1, items: object({ name: nullable(), role: nullable(["acquirer", "target", "merger_sub", "adviser", "partner", "other"]), ticker: nullable(), participation: nullable(), evidence }) },
    statement: nullable(), key_terms: { type: "array", items: object({ value: nullable(), evidence }) },
  }), type: ["object", "null"] },
});
// Backward-readable old outputs stay intact; absence is explicitly unresolved at the consumption boundary.
Object.assign(SEC425_FACT_LOCAL_SCHEMA.properties, { action_context: SEC425_ACTION_CONTEXT_SCHEMA });

// Same previously exercised Gemini subset: nullable, objects, arrays, enums. Quote limit remains description-only on wire.
function wireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireSchema);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>, result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (key === "additionalProperties") continue;
    if (key === "type" && Array.isArray(child)) { result.type = child.find(v => v !== "null"); result.nullable = true; }
    else if (key === "enum" && Array.isArray(child)) result.enum = child.filter(v => v !== null);
    else if (key === "maxLength") result.description = "Exact contiguous source quote, at most 240 characters; preserve punctuation and whitespace.";
    else result[key] = wireSchema(child);
  }
  return result;
}
export const SEC425_FACT_WIRE_SCHEMA = wireSchema(SEC425_FACT_LOCAL_SCHEMA);
export const SEC425_FACT_SYSTEM = [
  "Extract source-backed current acquisition/merger announcement facts from supplied cleaned_source_blocks. Return only the supplied JSON schema. This is not Primary copy or a score. Ignore Router, parser facts, summary, issuer metadata and earlier outputs as fact authority.",
  "decision confirmed requires a newly announced action here: new_acquisition_proposal, revised_acquisition_proposal, or definitive_agreement_signed. Changed consideration belongs to a revised proposal, not another event. Prior agreements/offers, board approvals, own-share repurchase, proxy filing or a vote are not a new announcement of these kinds. An intention, negotiations or LOI is not definitive execution. A submitted non-binding proposal is an actual proposal, not a completed acquisition. Future conditional closing remains future.",
  "Return announcement null for not_applicable (neither supported current announcement in supplied blocks) or uncertain (possible relevant action lacks clear identity/currentness/support). These differ; none is not a complete-filing absence claim. Multiple distinct ambiguous transactions require uncertain, not arbitrary selection.",
  "Keep announcement_type separate from transaction_types. Transaction types are non-exclusive: acquisition, merger, tender_offer, exchange_offer, spac_business_combination or asset_acquisition may coexist when supported. Do not force one mutually exclusive label or infer SPAC from form425. Unknown types stay null, not a guess.",
  "Root evidence supports current action, announcement_type, statement and transaction_types. Each party has shared evidence for its name, role, ticker and participation; avoid repeating the same quote per field. Use null for unavailable fields; never fill from another field. Ticker is a source-stated symbol of THAT party, not a name abbreviation, the filed-by issuer's ticker copied to every party, or a future combined-company symbol. CIK/company/security identity is not resolved by this extraction. Keep acquirer versus target clear; unknown role/ticker stays null. participation states limited-purpose Adviser, partnership or other relevant limitations, not generic involvement.",
  "statement explains the current action. Each key_terms.value must contain an actual concise condition/value, not a heading such as Agreement Date or Merger Consideration. Preserve stated cash/share/implied values without calculations; preserve non-binding status, alternatives such as termination OR inapplicability, majority basis, exceptions, absence of financing conditions, ownership exclusions and conditional future completion. Do not simplify away economically material qualifications. If an incomplete table lacks context to express a value correctly, return null for that term rather than guessing or presenting unqualified formula alternatives.",
  "Every non-null value must be supported by its associated root/party/term evidence. Each key term has its own evidence covering the actual value AND material qualifications. Do not use an unrelated generic quote for a condition. Evidence source_field is heading or text of the exact block_id. Copy short contiguous spans of at most240 characters with exact punctuation/newlines, using multiple spans when needed. Do not normalize, repair, relocate or reconstruct quotations.",
  "Missing evidence, ambiguous company attribution or lost condition meaning must remain unavailable; schema consistency is not semantic verification. No canonical-ready status, automatic matching, ticker change or Alert authority is granted. Do not derive facts from an investor-facing Primary summary or score.",
  "Include action_context for confirmed claims: separately quote the actual action and its announcement-time context. Record the source's literal action date, not the filing date. Prior agreement descriptions and current meeting/vote events are different actions; the same or different dates alone do not decide newness. If context is unclear retain unclear. FILED BY and SUBJECT COMPANY are filing roles, not acquirer/target roles. No supplied verified CIK/mapping means identity is unresolved; do not infer it from a name or abbreviation.",
].join("\n");

export function inspectSec425FactCandidate(value: unknown, blocks: readonly Sec425FactBlock[], identityEvidence?: Sec425IdentityEvidence, filingPackage?: Record<string, unknown>) {
  const validator = new Ajv({ strict: false, allErrors: true }).compile(SEC425_FACT_LOCAL_SCHEMA);
  const schemaPass = validator(value), schemaErrors = structuredClone(validator.errors);
  const bindings: { path: string; exact: boolean; length: number; missingBlock: boolean }[] = [];
  const errors: string[] = [];
  const visit = (node: unknown, path: string) => {
    if (Array.isArray(node)) { node.forEach((item, i) => visit(item, `${path}/${i}`)); return; }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if ("value" in record && Array.isArray(record.evidence)) {
      if (record.value !== null && record.evidence.length === 0) errors.push(`${path}:value_without_evidence`);
      if (record.value === null && record.evidence.length > 0) errors.push(`${path}:unavailable_with_value_evidence`);
    }
    if ("ticker" in record && Array.isArray(record.evidence)) {
      const ticker = record.ticker;
      if ([record.name, record.role, record.ticker, record.participation].some(v => v != null) && !record.evidence.length) errors.push(`${path}:party_without_evidence`);
      if (typeof ticker === "string" && !record.evidence.some(p => p && typeof p.quote === "string" && p.quote.includes(ticker))) errors.push(`${path}:ticker_literal_not_in_own_evidence`);
    }
    if (Array.isArray(record.evidence)) record.evidence.forEach((p, i) => {
      const block = blocks.find(b => b.block_id === p?.block_id), field = p?.source_field === "heading" ? block?.heading : p?.source_field === "text" ? block?.text : null;
      const quote = typeof p?.quote === "string" ? p.quote : "";
      bindings.push({ path: `${path}/evidence/${i}`, exact: !!quote && typeof field === "string" && field.includes(quote), length: [...quote].length, missingBlock: !block });
    });
    for (const [key, child] of Object.entries(record)) if (key !== "evidence") visit(child, `${path}/${key}`);
  };
  visit(value, "");
  const data = value as Partial<Sec425FactOutput> | null;
  if (data?.decision === "confirmed" && (!data.announcement || data.announcement.announcement_type == null || data.announcement.statement == null || !data.evidence?.length)) errors.push("confirmed_announcement_incomplete");
  if (data?.decision !== "confirmed" && data?.announcement != null) errors.push("nonconfirmed_announcement_must_be_null");
  const citationPass = bindings.every(p => p.exact && p.length <= 240);
  const currentness = inspectSec425Currentness({ decision: data?.decision, announcementType: data?.announcement?.announcement_type, evidence: data?.evidence, actionContext: data?.action_context }, blocks);
  const parties = Array.isArray(data?.announcement?.parties) ? data.announcement.parties : [];
  const identities = filingPackage ? compareSec425PartyIdentities(parties, filingPackage, blocks) : parties.map((p, i) => inspectSec425Identity({
    key: `party:${i}`, name: p?.name ?? null, ticker: p?.ticker ?? null, exchange: null,
  }, blocks, identityEvidence));
  return { schemaPass, schemaErrors, fieldBindingPass: errors.length === 0, errors, citationPass, bindings, mechanicalPass: schemaPass && errors.length === 0 && citationPass,
    currentness, identities,
    semanticStatus: "unverified" as const, publicationStatus: "not_ready" as const, available: false as const, matchEligible: false as const, alertEligible: false as const, corrected: false as const };
}

export function createSec425FactCandidate(source: Sec425FactSource, sourceBytes: Uint8Array, output: unknown, blocks: readonly Sec425FactBlock[], identityEvidence?: Sec425IdentityEvidence, filingPackage?: Record<string, unknown>) {
  const url = new URL(source.sourceUrl);
  if (!["raw_html", "sec_public_text_excerpt"].includes(source.representation) || !/^\d{10}-\d{2}-\d{6}$/.test(source.accession) || url.origin !== "https://www.sec.gov" || !url.pathname.startsWith("/Archives/edgar/data/") || !url.pathname.includes(`/${source.accession.replaceAll("-", "")}/`) || url.search || url.hash || createHash("sha256").update(sourceBytes).digest("hex") !== source.sourceSha256) throw Error("sec425_source_identity_or_hash_mismatch");
  if (filingPackage && (filingPackage.accession_number !== source.accession || (filingPackage.sec425_primary_source as { sourceSha256?: unknown })?.sourceSha256 !== source.sourceSha256)) throw Error("sec425_identity_package_source_mismatch");
  return { version: SEC425_FACT_CANDIDATE_VERSION, source: { ...source }, sourceScope: "supplied_blocks_only" as const, rawOutput: structuredClone(output), assessment: inspectSec425FactCandidate(output, blocks, identityEvidence, filingPackage) };
}
