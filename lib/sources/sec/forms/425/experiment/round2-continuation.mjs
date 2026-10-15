import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import Ajv from 'ajv';
const sha=x=>createHash('sha256').update(x).digest('hex');
const originalGuardSha='4f13e82fc5f44131b55684d6ed2d195b12276444da891fb566abb8bbb2696fe6';
const read=(dir,n)=>JSON.parse(fs.readFileSync(path.join(dir,n),'utf8'));
const check=(value,code)=>{if(!value)throw Error(code);};
function writeNew(file,value){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,JSON.stringify(value,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}

/** Proof for the exact settled first output failure. Never infers a numeric HTTP status. */
export function inspectSettledFirstFailure(directory){
 const plan=read(directory,'plan.json'),attempt=read(directory,'ledger/attempt-1.json'),result=read(directory,'ledger/result-1.json'),halt=read(directory,'ledger/HALTED.json');
 const prompt=read(directory,'signed-prompt.json'),body=read(directory,'signed-response.json'),validation=read(directory,'signed-validation.json');
 const files=['plan.json','ledger/attempt-1.json','ledger/result-1.json','ledger/HALTED.json','signed-prompt.json','signed-request.json','signed-response.json','signed-validation.json'];
 check(plan.version==='sec425-round2-v1'&&plan.maxRequests===3&&plan.cases.length===3,'continuation_plan_scope');
 check(attempt.number===1&&attempt.caseId==='signed'&&result.number===1&&result.caseId==='signed'&&halt.number===1&&halt.caseId==='signed','continuation_first_case_only');
 check(result.status==='failed_consumes_budget'&&validation.ok===false&&validation.schemaPass===false,'continuation_not_output_schema_failure');
 const item=plan.cases.find(c=>c.id==='signed');
 check(attempt.planSha256===sha(fs.readFileSync(path.join(directory,'plan.json')))&&attempt.requestSha256===item.requestSha256&&item.requestSha256===sha(fs.readFileSync(path.join(directory,'signed-request.json')))&&item.promptSha256===sha(fs.readFileSync(path.join(directory,'signed-prompt.json'))),'continuation_input_changed');
 check(body.candidates?.length===1&&body.candidates[0].finishReason==='STOP','continuation_response_unsettled');
 const parsed=JSON.parse(body.candidates[0].content.parts.filter(p=>p.thought!==true).map(p=>p.text??'').join(''));
 const validate=new Ajv({strict:false,allErrors:true}).compile(prompt.responseFormat.json_schema.schema);
 check(validate(parsed)===false,'continuation_schema_failure_not_reproduced');
 let httpSuccessEvidence;
 if(result.httpStatus===200&&result.finishReason==='STOP')httpSuccessEvidence='recorded_http_200_stop';
 else{
  // The original receipt omitted status. Its unchanged guard only reached validation
  // after response.ok and STOP; the immutable failed validation proves that branch.
  check(result.httpStatus===undefined&&sha(fs.readFileSync(path.join(directory,'guard-at-first-attempt.mjs')))===originalGuardSha,'continuation_http_success_unproven');
  files.push('guard-at-first-attempt.mjs');httpSuccessEvidence='original_guard_control_flow_proves_2xx_stop_numeric_status_unrecorded';
 }
 return {version:'sec425-round2-output-continuation-v1',classification:'settled_successful_http_stop_output_schema_failed',httpStatus:result.httpStatus??null,httpSuccessEvidence,originalVerdict:'FAIL',planSha256:attempt.planSha256,consumedRequests:1,totalCap:3,perCaseCap:1,noRetryCase:'signed',allowedUnsentCases:['background','revised-offer'],fingerprints:Object.fromEntries(files.map(n=>[n,sha(fs.readFileSync(path.join(directory,n)))]))};
}

export function prepareContinuation(directory){
 const proposal=inspectSettledFirstFailure(directory),file=path.join(directory,'CONTINUATION-PROPOSAL.json');writeNew(file,proposal);
 return {proposalSha256:sha(fs.readFileSync(file)),proposal};
}

/** Separate, explicit checkpoint after main reviews the exact proposal digest. No request is sent. */
export function appendReviewedContinuation(directory,expectedProposalSha256){
 const lock=path.join(directory,'ledger','exclusive.lock');fs.mkdirSync(lock);
 try{
  check(fs.readdirSync(path.join(directory,'ledger')).filter(n=>/^attempt-\d+\.json$/.test(n)).length===1,'continuation_must_precede_next_attempt');
  const bytes=fs.readFileSync(path.join(directory,'CONTINUATION-PROPOSAL.json'));
  check(sha(bytes)===expectedProposalSha256,'continuation_proposal_digest_mismatch');
  const proposal=JSON.parse(bytes);check(isDeepStrictEqual(proposal,inspectSettledFirstFailure(directory)),'continuation_proof_changed');
  writeNew(path.join(directory,'ledger','continuation-1.json'),{proposalSha256:expectedProposalSha256,proposal,recordedAt:new Date().toISOString()});
 }finally{fs.rmdirSync(lock);}
}

export function readAuthorizedContinuation(directory){
 const file=path.join(directory,'ledger','continuation-1.json');if(!fs.existsSync(file))return false;
 const entry=read(directory,'ledger/continuation-1.json'),proposalBytes=fs.readFileSync(path.join(directory,'CONTINUATION-PROPOSAL.json'));
 check(entry.proposalSha256===sha(proposalBytes)&&isDeepStrictEqual(entry.proposal,JSON.parse(proposalBytes))&&isDeepStrictEqual(entry.proposal,inspectSettledFirstFailure(directory)),'continuation_proof_changed');
 return true;
}
