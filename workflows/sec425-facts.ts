import {sleep} from "workflow";
import {processFacts} from "@/lib/sec425/storage";
import {consumeSec425Alerts} from "@/lib/sec425/consumer";
export async function sec425FactWorkflow(job:{rawItemId:string;executionId:string}){
 "use workflow";
 let result=await analyze(job);
 if(result.status==="busy"){await sleep("180s");result=await analyze(job);}
 if(result.status==="succeeded")await alerts(job.rawItemId);
 return result;
}
async function analyze(job:{rawItemId:string;executionId:string}){"use step";return processFacts(job);}
analyze.maxRetries=3;
async function alerts(rawItemId:string){"use step";return consumeSec425Alerts(rawItemId);}
alerts.maxRetries=3;
