import { combineWithFilingEvents, eventsSchema } from "./combined.ts";

export type ContextBlock = { block_id: string; source_ref: string; text: string; heading?: string | null; is_boilerplate?: boolean; [key: string]: unknown };
export const CONTEXT_RADIUS = 3;
export const CONTEXT_MAX_BLOCKS = 32;
export const CONTEXT_MAX_CHARS = 24_000;

/** Bounded document-order context, without company IDs, event keywords or facts. */
export function preserveLocalContext(all: ContextBlock[], prior: ContextBlock[], anchors: string[]) {
  if (new Set(all.map(b => b.block_id)).size !== all.length) throw Error("duplicate_block_id");
  const selected = new Map(prior.map(b => [b.block_id, ["preserved_round1_selection"]]));
  for (const b of prior) if (!all.some(a => a.block_id === b.block_id && a.text === b.text && a.heading === b.heading)) throw Error("prior_block_changed");
  for (const id of anchors) {
    const index = all.findIndex(b => b.block_id === id);
    if (index < 0) throw Error("anchor_missing");
    for (let delta = -CONTEXT_RADIUS; delta <= CONTEXT_RADIUS; delta++) {
      const b = all[index + delta];
      if (!b || b.source_ref !== all[index].source_ref) continue;
      // Do not discard mixed factual paragraphs just because a section was labeled boilerplate.
      const reasons = selected.get(b.block_id) ?? [];
      reasons.push(`same_document_context:${id}:offset=${delta}`);
      selected.set(b.block_id, reasons);
    }
  }
  const blocks = all.filter(b => selected.has(b.block_id));
  if (blocks.length > CONTEXT_MAX_BLOCKS || blocks.reduce((n,b) => n+b.text.length+(b.heading?.length??0),0) > CONTEXT_MAX_CHARS) throw Error("context_budget_exceeded_no_silent_truncation");
  return { blocks, decisions: all.map(b => ({ block_id:b.block_id, status:selected.has(b.block_id)?prior.some(p=>p.block_id===b.block_id)?"preserved":"expanded":"excluded", reasons:selected.get(b.block_id)??["outside_bounded_context"], originalBoilerplateFlag:b.is_boilerplate??null })) };
}

// Preserve round 1 verbatim. Round 2 changes the experiment contract only.
export const round2EventsSchema = JSON.parse(JSON.stringify(eventsSchema));
round2EventsSchema.properties.events.items.properties.event_state.enum = ["occurred"];
for (const branch of ["events", "unresolved"]) {
  const proof = round2EventsSchema.properties[branch].items.properties.evidence;
  proof.items.required.push("source_field");
  proof.items.properties.source_field = { type:"string", enum:["heading","text"] };
  proof.items.properties.quote.maxLength = 240;
}

export function buildRound2Prompt(primary: Parameters<typeof combineWithFilingEvents>[0], all: ContextBlock[], anchors: string[]) {
  const payload = JSON.parse(primary.user);
  const selection = preserveLocalContext(all, payload.cleaned_source_blocks, anchors);
  const keys = Object.keys(payload.cleaned_source_blocks[0] ?? {});
  payload.cleaned_source_blocks = selection.blocks.map(b => Object.fromEntries(keys.map(k=>[k,b[k]])));
  payload.analysis_source_block_count = selection.blocks.length;
  payload.analysis_source_blocks_truncated = all.length > selection.blocks.length;
  payload.analysis_source_selection = { ...payload.analysis_source_selection, mode:"experiment_same_document_radius3", selected_block_count:selection.blocks.length };
  const combined = combineWithFilingEvents({...primary,user:JSON.stringify(payload)});
  const v1 = "Describe insufficient/scheduled/ambiguous evidence in unresolved.";
  if (!combined.system.includes(v1)) throw Error("round1_instruction_anchor_changed");
  combined.system = combined.system.replace(v1,
    "Clearly scheduled future votes/closing and purely hypothetical actions are outside the seven occurred-event categories: omit them from events, and do not automatically put them in unresolved. Use unresolved only when an actual occurrence is asserted or plausibly at issue but its evidence is insufficient or conflicting.") + "\n" + [
      "Round 2: events contains occurred actions only. A completed submission of a non-binding proposal is an occurred proposal_made action; it is neither a signed definitive agreement nor a closed acquisition. Preserve non-binding and conditional qualifiers in BOTH the Primary analysis and event statements when the source states them.",
      "For shareholder_vote_result require an actual result (approved/rejected, vote tallies or stated voting outcome). A meeting date or a future vote is not a result. Do not infer a result from the schema category.",
      "For each evidence item explicitly choose source_field=heading or text. Copy a short exact contiguous span (at most 240 characters) from THAT field of THAT block, preserving whitespace/newlines. Use multiple short spans if needed; do not reconstruct whole paragraphs. Heading is source evidence, not body text. Do not move or repair a quote to another ID or field.",
      "The existing Primary generic-display rule still applies: when router_result.display_type is generic, snapshot_title and snapshot_summary are empty strings and snapshot_items is []. Do not add snapshot output for the event extension. Existing score and repair policies are not changed.",
    ].join("\n");
  combined.responseFormat.json_schema.name="sec425_primary_events_experiment_v2";
  combined.responseFormat.json_schema.schema.properties.filing_events=round2EventsSchema;
  return {prompt:combined,selection};
}

export function inspectRound2Evidence(value: {events:Array<{date_literal?:string|null;decision_scope_literal?:string|null;evidence:Array<{block_id:string;source_field:"heading"|"text";quote:string}>}>;unresolved:Array<{evidence:Array<{block_id:string;source_field:"heading"|"text";quote:string}>}>},blocks:ContextBlock[]) {
  const normalize=(s:string)=>s.replace(/\s+/g," ").trim();
  const proofs=[...value.events,...value.unresolved].flatMap(item=>item.evidence).map(p=>{
    const b=blocks.find(b=>b.block_id===p.block_id),field=b?.[p.source_field];
    const exact=typeof field==="string"&&!!p.quote&&field.includes(p.quote);
    return {...p,exact,diagnosticWhitespaceOnlyMatch:!exact&&typeof field==="string"&&!!p.quote&&normalize(field).includes(normalize(p.quote)),missingBlock:!b};
  });
  const literalErrors=value.events.flatMap((event,index)=>["date_literal","decision_scope_literal"].filter(key=>{
    const literal=event[key as "date_literal"|"decision_scope_literal"];
    return literal!==null&&literal!==undefined&&!event.evidence.some(p=>p.quote.includes(literal));
  }).map(key=>`literal_not_in_cited_span:${index}:${key}`));
  return {exactPass:proofs.every(p=>p.exact)&&literalErrors.length===0,proofs,literalErrors,semanticAccuracy:"requires_direct_source_review",corrected:false};
}
