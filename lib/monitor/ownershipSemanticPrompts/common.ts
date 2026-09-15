export type OwnershipSemanticOutputFactField =
  | "owner_attribution"
  | "ownership_relation"
  | "derivative_underlying_relation"
  | "rule_10b5_1"
  | "footnote_scope"
  | "amendment_effect";

export const OWNERSHIP_SEMANTIC_PROMPT_SOURCE_URLS = Object.freeze({
  form4: "https://www.sec.gov/files/form4.pdf",
  form144: "https://www.sec.gov/files/form144.pdf",
  form144ElectronicFiling:
    "https://www.sec.gov/submit-filings/filer-support-resources/how-do-i-guides/file-form-144-electronically",
});

const COMMON_RULES = Object.freeze([
  "Treat the original SEC XML as the only semantic authority; the neutral inventory supplies opaque references, not conclusions.",
  "Preserve XML numbers, dates, transaction codes, acquired/disposed codes, and tickers exactly; do not calculate, normalize, replace, or reinterpret them.",
  "For each fact, decide Subject, then Scope, then Evidence, then Relation. If any required link is not established, omit the fact or return unresolved without a typed value.",
  "Cite only evidence IDs whose XML row or explicitly linked footnote supports that fact. Never spread one row, footnote, remark, owner, security, or plan statement to other rows without explicit source linkage.",
  "Do not merge multiple reporting owners or assume that a filing-wide owner list gives every owner the same relationship to every row.",
  "Resolve footnote and remark scope before using their text: distinguish row, owner, security, filing, prior-sale history, acquisition history, and amendment explanation.",
  "Missing does not mean false, omitted does not mean deleted, unavailable does not mean zero, and unknown does not mean 0.",
  "Use supported only for a directly source-backed typed claim. LLM supported is not Monitor verified and does not authorize a downstream alert or matcher decision.",
  "Use only supplied opaque row, owner, security, evidence, and footnote references. Never invent, transform, or self-link references to fill an inventory gap.",
  "Do not use parser semantic fields, Primary analysis, scores, signals, investor copy, market data, or Monitor conditions as evidence or inputs.",
  "The economic_direction provider field is intentionally disabled. Do not emit buy, sell, or other; transaction code and A/D remain raw XML facts outside this sidecar.",
]);

export function buildOwnershipCommonSemanticRules(): readonly string[] {
  return COMMON_RULES;
}
