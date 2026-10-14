import {enabled,loadSource,repository,rpc,type Repository} from "./storage.ts";
import {sec425FactWorkflow} from "../../workflows/sec425-facts.ts";
export async function enqueueSec425Facts(rawItemId:string,options:{repo?:Repository;start?:(job:{rawItemId:string;executionId:string})=>Promise<{runId:string}>}={}){
 if(!enabled())return{status:"disabled"};
 const repo=options.repo??await repository(),input=await loadSource(rawItemId,repo);
 await rpc(repo,"reserve_sec425_facts",{p_id:input.executionId,p_binding:input.binding});
 const schedule=await rpc(repo,"sec425_transition",{p_id:input.executionId,p_action:"schedule"});
 if(schedule.claimed!==true)return{status:"duplicate",executionId:input.executionId};
 const start=options.start??(async(job)=>{const {start}=await import("workflow/api");return start(sec425FactWorkflow,[job]);});
 const run=await start({rawItemId,executionId:input.executionId});
 await rpc(repo,"sec425_transition",{p_id:input.executionId,p_action:"link",p_value:{token:schedule.token,workflowRunId:run.runId}});
 return{status:"enqueued",executionId:input.executionId,workflowRunId:run.runId};
}
