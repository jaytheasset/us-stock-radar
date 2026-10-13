import {combinedProvider} from '../lib/sec-combined-offering/provider.ts';
import {processCombinedOffering} from '../lib/sec-combined-offering/runtime.ts';
import { CodexCliOsSnapshotProvider } from '../lib/sec-os-snapshot/provider.ts';
import { processSnapshot } from '../lib/sec-os-snapshot/runtime.ts';
import { CodexCliOfferingProvider } from '../lib/sec-offering-plan/provider.ts';
import { processOfferingPlan } from '../lib/sec-offering-plan/runtime.ts';
import { repository, select } from '../lib/sec-os-snapshot/repository.ts';
const executable=process.env.OS_SNAPSHOT_CODEX_EXECUTABLE, root=process.env.OS_SNAPSHOT_JOURNAL_DIR;
if(!executable || !root) throw Error('Set OS_SNAPSHOT_CODEX_EXECUTABLE and OS_SNAPSHOT_JOURNAL_DIR (persistent private local directory).');
const provider=new CodexCliOsSnapshotProvider({executable,root}), repo=await repository();
const once=process.argv.includes('--once'), id=process.argv.find(x=>x.startsWith('--id='))?.slice(5);
const purpose=process.argv.find(x=>x.startsWith('--purpose='))?.slice(10);
if(purpose&&!['sec_os_snapshot','sec_offering_plan','sec_combined_offering'].includes(purpose))throw Error('Unknown purpose');
const offeringProvider=new CodexCliOfferingProvider({executable,root}),combined=combinedProvider({executable,root});
do {
  const jobs=await select(repo,'ai_runs',{select:'id,prompt_key',prompt_key:purpose?`eq.${purpose}`:'in.(sec_os_snapshot,sec_offering_plan,sec_combined_offering)',status:'in.(pending,running)',...(id?{id:`eq.${id}`}:{order:'metadata->>reservedAt.asc'}),limit:'1'});
  for(const job of jobs) {
    // Each runtime saves only its original extraction and independently validated domains.
    try {console.log(JSON.stringify({id:job.id,...await (job.prompt_key==='sec_combined_offering'?processCombinedOffering(String(job.id),combined):job.prompt_key==='sec_offering_plan'?processOfferingPlan(String(job.id),offeringProvider):processSnapshot(String(job.id),provider))}));}
    catch {console.error(JSON.stringify({id:job.id,status:'recovery_pending',message:'Reconcile retained process journal before retry.'}));}
  }
  if(!once) await new Promise(r=>setTimeout(r,5000));
} while(!once);
