import "server-only";
import { createHash } from "node:crypto";
import type { GenericMonitorChildIdentity } from "../monitor/genericMonitorChildExecution.ts";
import { readCurrentListingRiskFacts } from "../monitor/listingRiskPersistence.ts";
import type { ListingRiskEventFacts, ListingFactPath } from "../monitor/listingRiskFacts.ts";
import type { SecTickerResolutionRepository } from "../sec-ticker-resolution/persistence.ts";
import { record, validDate, validScope, type DelistingScope } from "../sec-delisting-state/state.ts";
import { sourceText, validateSourceEvent, validateEventLink, closingEvent, type ListingSourceEvent } from "./sourceEvent.ts";
import { hash, sameScope, type HistoryItem, type Row } from "./observation.ts";
import { persistSecListingObservation, readSecListingHistory } from "./persistence.ts";

/** A post-persistence consumer, not another analyzer. Read the exact committed
 * Listing Risk execution; never turn its classification alone into a recovery. */
export async function persistListingRiskStatusAutomatically(identity: GenericMonitorChildIdentity,
  repository?: SecTickerResolutionRepository) {
  const base = {eventId:identity.eventId,rawItemId:identity.rawItemId,sourceExecutionId:identity.executionId};
  if (identity.sourceFamily !== "sec_8k_6k" || identity.monitorAnalyzerKey !== "listing_risk")
    return {...base,status:"not_applicable" as const};
  try {
    const repo = repository ?? await defaultRepository();
    const current = await readCurrentListingRiskFacts(identity.eventId,{rpc:repo.rpc.bind(repo)});
    if (current.status !== "available") return {...base,status:"unavailable" as const,reason:"listing_risk_facts_unavailable"};
    if (current.rawItemId !== identity.rawItemId || current.sourceExecutionId !== identity.executionId
      || current.parentPrimaryAiRunId !== identity.parentPrimaryAiRunId)
      return {...base,status:"unavailable" as const,reason:"listing_risk_execution_changed"};
    const r = await repo.select("raw_items",{select:"*",id:`eq.${identity.rawItemId}`,limit:"2"});
    if (!r.ok || !Array.isArray(r.data) || r.data.length !== 1) throw Error("listing_raw_read_failed");
    const raw = r.data[0] as Row, p = record(raw.raw_payload);
    if (raw.source_code !== "sec_edgar" || raw.source_unique_id !== identity.sourceIdentity
      || !/^(8-K|6-K)(\/A)?$/.test(String(p.form_type)))
      return {...base,status:"unavailable" as const,reason:"listing_raw_identity_mismatch"};
    const asOf = String(raw.published_at).slice(0,10);
    if (!validDate(asOf)) return {...base,status:"unavailable" as const,reason:"filing_date_unavailable"};
    const scope = {issuerCik:String(p.cik ?? "").padStart(10,"0"),
      securityTitle:current.facts.affected_security.title.value ?? "",exchange:current.facts.exchange.value ?? ""};
    const history = validScope(scope) ? await readSecListingHistory({scope,repository:repo}) : [];
    const selection = selectListingRiskSourceEvent(raw,current.facts,scope,history);
    // Explicit source events are source-only history: Monitoring execution remains
    // the provenance of this hook, not the identity of the SEC event itself.
    const saved = await persistSecListingObservation(selection.event
      ? {rawItemId:identity.rawItemId,asOf,scope,sourceEvent:selection.event,repository:repo}
      : {rawItemId:identity.rawItemId,eventId:identity.eventId,asOf,repository:repo});
    return {...base,status:saved.status,observationId:saved.id,selection:selection.reason,
      listing:saved.observation.reported.listing,trading:saved.observation.reported.trading,
      attachment:saved.observation.attachment.status,resolves:selection.event?.resolves?.observationId ?? null};
  } catch(error) {
    return {...base,status:"failed" as const,reason:error instanceof Error ? error.message : "listing_history_persistence_failed"};
  }
}

/** Select only existing source-event contracts. No new phrase/state interpretation.
 * All required fact spans must be in one retained document and complete paragraphs;
 * a date comes only from an exact, occurred, source-stated Listing Risk date. */
export function selectListingRiskSourceEvent(raw: Row, facts: ListingRiskEventFacts, scope: DelistingScope,
  history: HistoryItem[]): {event:ListingSourceEvent|null;reason:string} {
  const none = (reason:string) => ({event:null,reason});
  if (!validScope(scope)) return none("source_event_scope_unavailable");
  const p = record(raw.raw_payload);
  const docs = [{url:p.primary_document_url,text:p.primary_document_html,truncated:p.primary_document_html_truncated},
    ...(Array.isArray(p.attachment_texts) ? p.attachment_texts.map(v=>{const d=record(v);return {url:d.url,text:d.text,truncated:d.textTruncated};}) : [])];
  const paths:ListingFactPath[]=["affected_security.title.value","exchange.value","listing_rule.value"];
  if ([facts.affected_security.title,facts.exchange,facts.listing_rule].some(f=>f.availability!=="available" || f.value_quality!=="exact" || !f.value))
    return none("source_event_exact_scope_or_issue_unavailable");
  const evidence = (path:ListingFactPath) => {
    const entries=facts.fact_provenance.filter(f=>f.fact_path===path && f.origin==="source_stated"
      && f.evidence_status==="available" && f.evidence);
    if(entries.length!==1) return null;
    const e=entries[0],s=facts.sources.find(s=>s.source_ref===e.source_ref);
    return s?.source_family==="sec" && s.source_id===raw.source_unique_id ? {text:sourceText(e.evidence!),url:s.source_url} : null;
  };
  const kinds:ListingSourceEvent["kind"][] = facts.classification.event_outcome === "recovered"
    ? ["removal_decision_withdrawn","trading_resumed"]
    : facts.classification.event_kind === "delisting_determination" ? ["removal_decision"]
    : facts.classification.event_kind === "trading_suspension" ? ["trading_suspension"] : [];
  const candidates:ListingSourceEvent[]=[];
  for(const dateKey of ["notice_date","trading_suspension_date"] as const) {
    const date=facts.dates[dateKey];
    if(date.availability!=="available" || date.value_quality!=="exact" || date.date_status!=="occurred" || !validDate(date.value)) continue;
    const spans=[...paths,`dates.${dateKey}.value` as ListingFactPath].map(evidence);
    if(spans.some(s=>!s)) continue;
    for(const doc of docs) {
      if(typeof doc.url!=="string" || typeof doc.text!=="string" || doc.truncated===true) continue;
      if(spans.some(s=>s!.url!==doc.url && s!.url!==raw.source_url)) continue;
      const text=sourceText(doc.text);
      const bounds=spans.map(s=>({start:text.indexOf(s!.text),end:text.indexOf(s!.text)+s!.text.length,text:s!.text}));
      if(bounds.some(b=>b.start<0 || text.indexOf(b.text,b.start+1)>=0)) continue;
      const paragraphs=[...doc.text.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/gi)].map(m=>sourceText(m[0])).filter(Boolean);
      const lo=Math.min(...bounds.map(b=>b.start)),hi=Math.max(...bounds.map(b=>b.end));
      const first=paragraphs.filter(q=>{const i=text.indexOf(q);return i>=0 && i<=lo && i+q.length>lo;});
      const last=paragraphs.filter(q=>{const i=text.indexOf(q);return i>=0 && i<hi && i+q.length>=hi;});
      if(first.length!==1 || last.length!==1) continue;
      const quote=text.slice(text.indexOf(first[0]),text.indexOf(last[0])+last[0].length);
      const [y,m,d]=date.value.split("-").map(Number);
      const literal=`${["January","February","March","April","May","June","July","August","September","October","November","December"][m-1]} ${d}, ${y}`;
      for(const kind of kinds) {
        let event:ListingSourceEvent={version:"listing_source_event_v1",kind,date:date.value,dateText:quote.includes(literal)?literal:date.value,
          documentUrl:doc.url,documentHash:createHash("sha256").update(doc.text).digest("hex"),quote,
          securityText:scope.securityTitle,exchangeText:scope.exchange,issue:facts.listing_rule.value!};
        // Reuse a previously validated excerpt of this exact opening event when it
        // contains every current fact span. Do not create a second event merely
        // because the paragraph selector also retained an adjacent sentence.
        if (!closingEvent(event)) {
          const existing = [...new Map(history.filter(h => h.usable && h.observation.rawItemId === raw.id
            && h.observation.scope && sameScope(h.observation.scope, scope)).map(h => h.observation.sourceEvent)
            .filter((e): e is ListingSourceEvent => Boolean(e && !e.resolves && e.kind === kind && e.date === event.date
              && e.documentHash === event.documentHash && e.documentUrl === event.documentUrl && e.issue === event.issue
              && e.securityText === event.securityText && e.exchangeText === event.exchangeText
              && spans.every(s => sourceText(e.quote).includes(s!.text))))
            .map(e => [hash(e), e])).values()];
          if (existing.length > 1) return none("ambiguous_existing_source_events");
          if (existing.length === 1) event = existing[0];
        }
        if(closingEvent(event)) {
          const groups=new Map<string,HistoryItem[]>();
          for(const prior of history) {
            const o=prior.observation;
            if(!prior.usable || !o.sourceEvent || closingEvent(o.sourceEvent) || !o.scope || !sameScope(o.scope,scope)
              || o.filingDate>String(raw.published_at).slice(0,10) || o.filingDate===String(raw.published_at).slice(0,10) && o.rawItemId!==raw.id) continue;
            const candidate={...event,resolves:{observationId:prior.id,sourceHash:o.sourceHash,eventDate:o.sourceEvent.date}};
            try {validateEventLink(candidate,o.sourceEvent);validateSourceEvent(raw,scope,candidate);} catch {continue;}
            const key=hash({sourceHash:o.sourceHash,scope:o.scope,sourceEvent:o.sourceEvent});
            groups.set(key,[...(groups.get(key)??[]),prior]);
          }
          if(groups.size!==1) continue;
          const target=[...groups.values()][0].sort((a,b)=>a.id.localeCompare(b.id))[0];
          event.resolves={observationId:target.id,sourceHash:target.observation.sourceHash,eventDate:target.observation.sourceEvent!.date};
        }
        try {validateSourceEvent(raw,scope,event);candidates.push(event);} catch { /* existing contract rejects unsupported/conditional evidence */ }
      }
    }
  }
  const unique=[...new Map(candidates.map(e=>[hash(e),e])).values()];
  return unique.length===1 ? {event:unique[0],reason:"validated_source_event"}
    : none(unique.length>1?"ambiguous_source_events":"source_event_or_unique_prior_unavailable");
}

async function defaultRepository():Promise<SecTickerResolutionRepository> {
  const {supabaseSelect,supabaseRpc}=await import("../supabase.ts");return {select:supabaseSelect,rpc:supabaseRpc};
}
