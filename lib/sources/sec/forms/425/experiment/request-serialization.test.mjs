import test from 'node:test';import assert from 'node:assert/strict';
import {buildSecGeminiRequestBody,readGeminiResponseSchema,readMaxOutputTokens,readGeminiThinkingConfig} from '../../../../../ai/secFilingAnalysisPreview.ts';
globalThis.fetch=async()=>{throw Error('serialization_test_network_forbidden');};
for(const key of ['sec_425_router','sec_425_analysis_draft','sec425_fact_input_v2','sec_s3_offering_analysis','other_family'])test(`original runtime request bytes unchanged: ${key}`,()=>{
 const prompt={key,version:'synthetic',system:'System source',user:'{"source":"exact"}',responseFormat:{json_schema:{schema:{type:'object',additionalProperties:false,properties:{text:{type:['string','null'],maxLength:240},list:{type:'array',maxItems:100,items:{type:'string'}}}}}}};
 for(const model of ['gemini-2.5-flash','gemini-2.5-flash-lite']){
  // Exact pre-refactor object/property order, calling the unchanged runtime helpers.
  const original={systemInstruction:{parts:[{text:prompt.system}]},contents:[{role:'user',parts:[{text:prompt.user}]}],generationConfig:{responseMimeType:'application/json',responseSchema:readGeminiResponseSchema(prompt),maxOutputTokens:readMaxOutputTokens(prompt.key),temperature:0,...readGeminiThinkingConfig(model)}};
  assert.equal(JSON.stringify(buildSecGeminiRequestBody(prompt,model)),JSON.stringify(original));
 }
});
