import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateCorrections,unavailableCorrections} from "./contract.ts";
const sources=[{id:"filing",url:"https://www.sec.gov/Archives/a.htm",label:"SEC source",text:"Intention to remove January 02, 2024. Trading immediately suspended December 19, 2023."}];
test("human date roles and intent status remain distinct without inference",()=>{
 const input={trading_suspension_date:{value:"2023-12-19",dateStatus:"occurred",availability:"available",sourceRef:"filing"},removal_effective_date:{value:"2024-01-02",dateStatus:"scheduled",availability:"available",sourceRef:"filing"}};
 const before=JSON.stringify(input);assert.deepEqual(validateCorrections(input,sources),input);assert.equal(JSON.stringify(input),before);
});
test("unavailable selected field remains null without erasing unrelated fields",()=>{
 assert.deepEqual(Object.keys(validateCorrections({removal_effective_date:{value:null,availability:"unavailable",sourceRef:"filing"}},sources)),["removal_effective_date"]);
 assert.equal(unavailableCorrections("filing").trading_suspension_date?.value,null);
});
test("invalid dates, statuses and unconstrained ticker corrections are rejected",()=>{
 for(const value of ["2024-02-30","yesterday",null])assert.throws(()=>validateCorrections({removal_effective_date:{value,availability:"available",dateStatus:"scheduled",sourceRef:"filing"}},sources));
 assert.throws(()=>validateCorrections({ticker:{value:"TTWO",availability:"available",sourceRef:"filing"}},sources));
 assert.throws(()=>validateCorrections({event_kind:{value:"delisted",availability:"available",sourceRef:"filing"}},sources));
});
test("missing retained evidence cannot be presented as a confirmed human fact",()=>{
 assert.throws(()=>validateCorrections({event_outcome:{value:"procedural",availability:"available",sourceRef:"external"}},sources));
 assert.throws(()=>validateCorrections({event_outcome:{value:"procedural",availability:"available",sourceRef:"filing"}},[{...sources[0],text:""}]));
});
test("exchange and security are typed retained-source claims, never identity assignments",()=>{
 const evidence=[{...sources[0],text:"The Nasdaq Stock Market LLC removes Common Stock, par value $0.001 per share."}];
 const corrections={exchange:{value:"The Nasdaq Stock Market LLC",availability:"available",sourceRef:"filing"},security_title:{value:"Common Stock, par value $0.001 per share",availability:"available",sourceRef:"filing"}};
 assert.deepEqual(validateCorrections(corrections,evidence),corrections);
 for(const field of ["exchange","security_title"])assert.throws(()=>validateCorrections({[field]:{value:"Different class not in source",availability:"available",sourceRef:"filing"}},evidence));
 for(const field of ["ticker","issuer","subject_cik","security_id"])assert.throws(()=>validateCorrections({[field]:{value:"TTOO",availability:"available",sourceRef:"filing"}},evidence));
 assert.equal(unavailableCorrections("filing").exchange?.value,null);
 assert.equal(unavailableCorrections("filing").security_title?.value,null);
});
test("text correction validation rejects source-free, blank, injected and detached values",()=>{
 for(const value of ["", "A", "<script>", "Nasdaq\nStock", "x".repeat(301), null])assert.throws(()=>validateCorrections({exchange:{value,availability:"available",sourceRef:"filing"}},sources));
 assert.throws(()=>validateCorrections({security_title:{value:"Common Stock",availability:"available",sourceRef:"attachment:99"}},sources));
});
test("additive migration extends only review validation and preserves old migration",()=>{
 const sql=readFileSync(new URL("../../supabase/migrations/20260914050001_form25_analysis_security_exchange_review.sql",import.meta.url),"utf8");
 assert.match(sql,/create or replace function public\.admin_apply_sec_form25_analysis_decision/);
 assert.match(sql,/'exchange','security_title'/);assert.match(sql,/INVALID_SOURCE_TEXT_CORRECTION/);
 assert.doesNotMatch(sql,/create table|\b(update|delete from)\s+public\./i);
});
test("retry uses append trace only, never reset, event analysis upsert or Alert fanout",()=>{
 const code=readFileSync(new URL("./persistence.ts",import.meta.url),"utf8");
 assert.match(code,/runSecFilingAnalysisForRawRow/);assert.match(code,/saveSecFilingAiTrace/);
 assert.doesNotMatch(code,/saveAnalyzedSecFilingEvent|runSecFilingAnalysisIngest|resetSec|enqueueSecFilingAlertCandidate/);
 assert.match(code,/retry_cancelled/);assert.match(code,/claim\.replayed===true/);
});
test("new human storage remains append-only and never updates source or identity rows",()=>{
 const sql=readFileSync(new URL("../../supabase/migrations/20260914041702_sec_form25_analysis_review_v1.sql",import.meta.url),"utf8");
 assert.match(sql,/reject_sec_ticker_resolution_human_mutation/);
 assert.doesNotMatch(sql,/\b(update|delete from)\s+public\.(events|raw_items|ai_outputs|ai_runs|sec_form25_identity)/i);
 assert.match(sql,/ANALYSIS_SOURCE_CHANGED/);assert.match(sql,/ANALYSIS_VERSION_CHANGED/);assert.match(sql,/ANALYSIS_STALE_REVIEW/);
});
