import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,open,rename,stat,unlink} from 'node:fs/promises';
import {hostname} from 'node:os';
import {resolve,join,isAbsolute} from 'node:path';
import {getContract,PROFILE,sha} from './contract.ts';
import type {Binding} from './source.ts';
import type {OfferingProvider,ProviderResult} from './runtime.ts';
import {runProcess,redact,type RunProcess} from '../sec-os-snapshot/provider.ts';
import {freezeOutput,decode} from './output-writer.mjs';
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch{return false;}};
async function exists(path:string){try{await stat(path);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
async function atomic(path:string,data:string){const f=await open(path+'.pending','w',0o600);try{await f.writeFile(data);await f.sync();}finally{await f.close();}await rename(path+'.pending',path);}
// Preserve the CLI bytes even when UTF-8 or JSON validation fails. Never repair/retry an output.
async function capture(dir:string):Promise<Pick<ProviderResult,'raw'|'rawBytesBase64'|'freeze'|'integrityError'>>{
 const input=join(dir,'cli-final-output.json');if(!await exists(input))return {raw:''};
 const bytes=await readFile(input);if(!bytes.length)return {raw:''};
 let raw='';try{raw=decode(bytes);}catch(e){return {raw:'',rawBytesBase64:bytes.toString('base64'),integrityError:String(e)};}
 const output=join(dir,'single-extraction.json'),freeze=join(dir,'single-extraction-freeze.json');
 try{
  if(await exists(freeze)){
   const frozen=JSON.parse(await readFile(freeze,'utf8')),saved=await readFile(output);
   if(!saved.equals(bytes)||frozen.sha256!==sha(bytes))throw Error('freeze_hash_mismatch');
  }else if(await exists(output+'.lock')){
   // Interrupted freeze: retain the first bytes as a failed validation, never overwrite them.
   throw Error('interrupted_output_freeze');
  }else await freezeOutput(input,output,freeze);
  return {raw,freeze:await readFile(freeze,'utf8')};
 }catch(e){return {raw,integrityError:String(e)};}
}
/** Durable host-local process journal. Never infer "uncalled" from an expired DB lease. */
export class CodexCliOfferingProvider implements OfferingProvider {
  executable: string; root: string; runner: RunProcess; journalId: string;
  namespace: string; contract: (binding:Binding)=>{schemaText:string;promptText:string};
  constructor(options:{executable:string;root:string;runner?:RunProcess;execution?:{namespace:'combined';contract:(binding:Binding)=>{schemaText:string;promptText:string}}}) {
    if (!isAbsolute(options.executable) || !isAbsolute(options.root)) throw Error('offering_absolute_provider_paths_required');
    if (/\.(cmd|ps1|bat)$/i.test(options.executable)) throw Error('offering_native_executable_required');
    this.executable=options.executable;this.root=resolve(options.root);this.runner=options.runner??runProcess;
    this.journalId=hostname()+':'+this.root;
    this.namespace=options.execution?.namespace??'offering';
    this.contract=options.execution?.contract??(binding=>getContract(binding.contractVersion,binding));
    const repo=resolve(process.cwd());if(this.root===repo || this.root.startsWith(repo+ '\\') || this.root.startsWith(repo+'/')) throw Error('offering_journal_must_be_outside_repository');
  }
  async run(binding: Binding, attempt: number, recoverOnly=false): Promise<ProviderResult> {
    const {schemaText,promptText}=this.contract(binding);
    if(binding.providerProfile!==PROFILE) return {raw:'',stdout:'',stderr:'Provider profile unavailable; retained job was not executed.',exitCode:null,cliVersion:'not_started',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),technicalError:'provider_profile_mismatch',retrySafe:false};
    const dir=join(this.root,this.namespace,binding.id,String(attempt)), resultPath=join(dir,'result.json');
    await mkdir(dir,{recursive:true});
    if(await exists(resultPath)) {
      const saved:ProviderResult=JSON.parse(await readFile(resultPath,'utf8'));
      if(saved.raw||saved.rawBytesBase64){
        const captured=await capture(dir);
        if(saved.raw!==captured.raw||saved.rawBytesBase64!==captured.rawBytesBase64)return {...saved,integrityError:'journal_output_bytes_mismatch',retrySafe:false};
        if(captured.integrityError)return {...saved,integrityError:captured.integrityError,retrySafe:false};
      }
      return saved;
    }
    const markerPath=join(dir,'started.json'), outputPath=join(dir,'cli-final-output.json');
    // A surviving Codex process owns this attempt even if its worker/DB lease disappeared.
    if(await exists(markerPath)) {
      const marker=JSON.parse(await readFile(markerPath,'utf8'));
      if(marker.host!==hostname() || (marker.pid && alive(marker.pid)) || !marker.pid) throw Error('offering_execution_uncertain_do_not_retry');
      const captured=await capture(dir);
      const result:ProviderResult={...captured,stdout:await readMaybe(join(dir,'stdout.log')),stderr:await readMaybe(join(dir,'stderr.log')),
        exitCode:null,cliVersion:marker.cliVersion,startedAt:marker.startedAt,finishedAt:new Date().toISOString(),technicalError:captured.raw||captured.rawBytesBase64?undefined:'worker_interrupted_before_final_output',retrySafe:!captured.raw&&!captured.rawBytesBase64};
      await atomic(resultPath,JSON.stringify(result));
      return result;
    }
    if(recoverOnly) throw Error('offering_missing_journal_do_not_retry');
    const lock=join(this.root,'provider.lock');
    // Filesystem lock survives worker death. Reclaim only after BOTH owner and recorded child are dead.
    if(await exists(lock)) {
      const owner=JSON.parse(await readFile(lock,'utf8'));
      if(owner.host!==hostname() || alive(owner.workerPid)) throw Error('offering_provider_busy');
      const old=JSON.parse(await readFile(owner.marker,'utf8'));
      if(!old.pid || alive(old.pid)) throw Error('offering_execution_uncertain_do_not_retry');
      await unlink(lock);
    }
    const handle=await open(lock,'wx',0o600);
    await handle.writeFile(JSON.stringify({host:hostname(),workerPid:process.pid,marker:markerPath}));await handle.sync();await handle.close();
    try {
      if(attempt>1) {
        const prior=JSON.parse(await readFile(join(this.root,this.namespace,binding.id,String(attempt-1),'result.json'),'utf8'));
        if(prior.raw || prior.rawBytesBase64 || !prior.retrySafe) throw Error('offering_retry_forbidden');
      }
      let cliVersion='not_started';
      const startedAt=new Date().toISOString();
      const marker={host:hostname(),startedAt,cliVersion,bindingKey:binding.key,pid:0};
      try {
      await writeFile(join(dir,'filing.json'),JSON.stringify(binding.source.filing));
      await writeFile(join(dir,'blocks.jsonl'),binding.source.blocks.map(b=>JSON.stringify(b)).join('\n'));
      await writeFile(join(dir,'documents.json'),JSON.stringify(binding.source.documents));
      await writeFile(join(dir,'source.html'),binding.source.documents[0].original);
      await writeFile(join(dir,'source.txt'),binding.source.documents[0].text);
      await writeFile(join(dir,'schema.json'),schemaText);await writeFile(join(dir,'extraction-instructions.md'),promptText);
      cliVersion=this.runner===runProcess?execFileSync(this.executable,['--version'],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:10000}).trim():'injected-test-runner';
      marker.cliVersion=cliVersion;
      await atomic(markerPath,JSON.stringify(marker));
      } catch(e) {
        // No extraction process has been started. If journaling itself fails, throw
        // and retain the DB invocation intent instead of assuming a safe retry.
        const result:ProviderResult={raw:'',stdout:'',stderr:redact(String(e)),exitCode:null,cliVersion,startedAt,finishedAt:new Date().toISOString(),technicalError:'provider_preflight_failed',retrySafe:true};
        await atomic(resultPath,JSON.stringify(result));return result;
      }
      // CLI final-answer file is frozen by the host. Only this isolated directory is writable;
      // no product checkout, inherited instructions, plugins, MCP servers, or API credentials are supplied.
      const args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--color','never',
        '-c','default_permissions=":workspace"','-c','windows.sandbox="unelevated"',
        '-m','gpt-6-astra','-c','model_reasoning_effort="high"','-c','model_provider="openai"','-c','forced_login_method="chatgpt"',
        '-c','project_doc_max_bytes=0','-c','features.memories=false','-c','features.multi_agent=false','-c','features.skills=false',
        '-c','sandbox_workspace_write.network_access=false','-C',dir,'-o',outputPath,'-'];
      const p=await this.runner(this.executable,args,{cwd:dir,timeoutMs:20*60*1000,
        stdin:'Read extraction-instructions.md and schema.json. Assigned filing metadata: filing.json. Complete neutral blocks: blocks.jsonl; documents.json retains source text and originals. Use only files in this directory. Do not delegate. Follow the frozen instructions exactly, returning the JSON as the final answer only. Do not write the output through a shell.',
        onPid:async pid=>{marker.pid=pid;await atomic(markerPath,JSON.stringify(marker));}});
      const captured=await capture(dir);
      await atomic(join(dir,'stdout.log'),p.stdout);await atomic(join(dir,'stderr.log'),p.stderr);
      const result:ProviderResult={...captured,stdout:p.stdout,stderr:p.stderr,exitCode:p.exitCode,cliVersion,startedAt:marker.startedAt,finishedAt:new Date().toISOString(),
        technicalError:captured.raw||captured.rawBytesBase64?undefined:p.error??'final_output_missing',retrySafe:!captured.raw&&!captured.rawBytesBase64};
      await atomic(resultPath,JSON.stringify(result));return result;
    } finally {await unlink(lock).catch(()=>{});}
  }
}
async function readMaybe(path:string) {return await exists(path)?readFile(path,'utf8'):'';}
