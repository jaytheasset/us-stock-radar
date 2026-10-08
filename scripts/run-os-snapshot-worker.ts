import { CodexCliOsSnapshotProvider } from '../lib/sec-os-snapshot/provider.ts';
import { processSnapshot } from '../lib/sec-os-snapshot/runtime.ts';
import { repository, select } from '../lib/sec-os-snapshot/repository.ts';
const executable=process.env.OS_SNAPSHOT_CODEX_EXECUTABLE, root=process.env.OS_SNAPSHOT_JOURNAL_DIR;
if(!executable || !root) throw Error('Set OS_SNAPSHOT_CODEX_EXECUTABLE and OS_SNAPSHOT_JOURNAL_DIR (persistent private local directory).');
const provider=new CodexCliOsSnapshotProvider({executable,root}), repo=await repository();
const once=process.argv.includes('--once'), id=process.argv.find(x=>x.startsWith('--id='))?.slice(5);
do {
  const jobs=await select(repo,'ai_runs',{select:'id',prompt_key:'eq.sec_os_snapshot','metadata->>osStatus':'in.(QUEUED,RUNNING)',...(id?{id:`eq.${id}`}:{order:'metadata->>reservedAt.asc'}),limit:'1'});
  for(const job of jobs) {
    try {console.log(JSON.stringify({id:job.id,...await processSnapshot(String(job.id),provider,repo)}));}
    catch {console.error(JSON.stringify({id:job.id,status:'recovery_pending',message:'Reconcile retained process journal before retry.'}));}
  }
  if(!once) await new Promise(r=>setTimeout(r,5000));
} while(!once);
