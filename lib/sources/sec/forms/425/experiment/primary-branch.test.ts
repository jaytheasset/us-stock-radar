import test from "node:test";import assert from "node:assert/strict";
import { parseSec425Filing } from "../parser.ts";
import { normalizeSec425RouterResult } from "../routerPrompt.ts";
import { shouldRunSec425Analysis, buildSec425DeterministicAnalysisForInput } from "../../../../../ai/sec425AnalysisAdapter.ts";
import type { SecFilingAnalysisInput } from "../../../../../prompts/secFilingAnalysis.ts";
test("raw router stage label cannot archive a needs-analysis decision; existing normalization clears it", () => {
 const parser=parseSec425Filing({filingText:"Example made a revised non-binding offer."}),id=parser.raw.router_source_blocks[0].block_id;
 const raw={material_update_present:true,needs_analysis_llm:true,deterministic_stage:"router",score:50,selected_source_block_ids:[id],source_blocks_used:[id]};
 const before=JSON.stringify(raw),normalized=normalizeSec425RouterResult(raw,parser),input={filing_package:{hard_parsers:{"425":parser}}} as unknown as SecFilingAnalysisInput;
 assert.equal(shouldRunSec425Analysis(raw),true);assert.equal(shouldRunSec425Analysis(normalized),true);
 assert.equal(normalized.deterministic_stage,null);assert.equal(buildSec425DeterministicAnalysisForInput(input,raw),null);assert.equal(buildSec425DeterministicAnalysisForInput(input,normalized),null);
 assert.equal(JSON.stringify(raw),before);
});
