// Opt-in experiment only. No ingest, persistence, Monitor or alert consumer imports this module.
export const EVENT_KINDS = ["agreement_signed", "acquisition_proposal", "consideration_changed", "shareholder_vote_result", "regulator_or_court_decision", "transaction_closed", "agreement_terminated_or_proposal_withdrawn"] as const;
const string = { type: "string", minLength: 1 } as const;
const nullableString = { type: ["string", "null"] } as const;
const evidence = { type: "array", minItems: 1, maxItems: 4, items: {
  type: "object", additionalProperties: false, required: ["block_id", "quote"],
  properties: { block_id: string, quote: string },
} } as const;
export const eventsSchema = {
  type: "object", additionalProperties: false,
  required: ["coverage", "empty_events_meaning", "events", "unresolved"],
  properties: {
    coverage: { type: "string", enum: ["supplied_current_filing_blocks_only"] },
    empty_events_meaning: { type: "string", enum: ["not_a_finding_of_no_event"] },
    events: { type: "array", maxItems: 8, items: {
      type: "object", additionalProperties: false,
      required: ["kind", "action", "event_state", "disclosure_context", "statement", "date_literal", "decision_scope_literal", "evidence"],
      properties: {
        kind: { type: "string", enum: EVENT_KINDS },
        action: { type: "string", enum: ["signed", "proposal_made", "consideration_revised", "vote_result", "regulatory_decision", "court_decision", "closed", "agreement_terminated", "proposal_withdrawn"] },
        event_state: { type: "string", enum: ["occurred", "proposed", "unknown"] },
        disclosure_context: { type: "string", enum: ["current_announcement", "prior_background", "unclear"] },
        statement: string, date_literal: nullableString, decision_scope_literal: nullableString, evidence,
      },
    } },
    unresolved: { type: "array", maxItems: 8, items: {
      type: "object", additionalProperties: false, required: ["reason", "evidence"],
      properties: { reason: string, evidence },
    } },
  },
} as const;

type Prompt = { key: string; version: string; system: string; user: string; responseFormat: { type: string; json_schema: { name: string; strict: boolean; schema: { type: string; additionalProperties: boolean; required: readonly string[]; properties: Record<string, unknown> } } } };

export function combineWithFilingEvents<T extends Prompt>(primary: T) {
  return {
    ...primary,
    system: primary.system + "\n" + [
      "Opt-in experiment extension: in this SAME response also return filing_events. The preceding runtime instruction listing four output fields applies to the unchanged Primary area; filing_events is the sole additional field.",
      "Keep all existing Primary instructions, fields and scoring unchanged. This extra area is independently source-grounded; do not derive it from Primary summary, score, router event_type/routing_reason, parser facts or candidates. Read the actual cleaned_source_blocks directly for BOTH areas.",
      "The seven filing_events kinds are independent of Primary event_type. Report only actions explicitly stated in this current document; do not infer the deal's latest overall state, first occurrence, prior-filing change or price arithmetic.",
      "Distinguish an action announced here from prior agreement/background described here using disclosure_context. A historical action may be recorded as prior_background; never promote it to current_announcement. If unclear use unclear or unresolved.",
      "A proposal being made can be an occurred proposal_made action; the proposed acquisition itself is not a closed transaction. Expected closing, scheduled votes, hypothetical termination rights, risks and existing consideration do not establish completed events or changed terms. Describe insufficient/scheduled/ambiguous evidence in unresolved. Do not invent a completion event from a plan.",
      "Keep agreement_terminated and proposal_withdrawn distinct; distinguish regulatory vs court decisions, and partial/conditional vs all required approvals in decision_scope_literal. Never infer all approvals from one approval. No canonical authority, ticker mutation or alert eligibility is granted.",
      "Each event and unresolved item must cite exact contiguous quote(s) from supplied block_id(s). Include enough context to support the action and its qualification. date_literal and decision_scope_literal are exact source wording or null, without normalization or calculation. Statements must preserve parties and qualifications.",
      "coverage is supplied_current_filing_blocks_only; empty_events_meaning is always not_a_finding_of_no_event. events=[] means no supported event extracted from supplied blocks, never confirmed absence across this filing or transaction. Missing evidence stays unresolved; no guessing, repairs or filling values from other outputs.",
    ].join("\n"),
    responseFormat: { ...primary.responseFormat, json_schema: {
      ...primary.responseFormat.json_schema, name: "sec425_primary_events_experiment_v1",
      schema: { ...primary.responseFormat.json_schema.schema,
        required: [...primary.responseFormat.json_schema.schema.required, "filing_events"],
        properties: { ...primary.responseFormat.json_schema.schema.properties, filing_events: eventsSchema },
      },
    } },
  };
}

export function validateEvidenceBindings(value: unknown, blocks: Array<{block_id: string; text: string}>) {
  // Format/schema is checked separately. Quote presence cannot establish semantic correctness.
  const errors: string[] = [];
  const data = value as { events?: Array<{ evidence: Array<{block_id: string; quote: string}>; date_literal?: string | null; decision_scope_literal?: string | null }>; unresolved?: Array<{evidence: Array<{block_id: string; quote: string}>}> };
  for (const [index, item] of [...(data.events ?? []), ...(data.unresolved ?? [])].entries()) {
    for (const proof of item.evidence ?? []) {
      const block = blocks.find(b => b.block_id === proof.block_id);
      if (!block || !proof.quote || !block.text.includes(proof.quote)) errors.push(`evidence_not_in_supplied_block:${index}:${proof.block_id}`);
    }
  }
  for (const [index, item] of (data.events ?? []).entries()) {
    for (const key of ["date_literal", "decision_scope_literal"] as const) {
      if (item[key] !== null && item[key] !== undefined && !item.evidence.some(p => p.quote.includes(item[key]!))) errors.push(`literal_not_in_cited_quote:${index}:${key}`);
    }
  }
  return { ok: errors.length === 0, errors, semanticAccuracy: "requires_source_review" as const };
}
