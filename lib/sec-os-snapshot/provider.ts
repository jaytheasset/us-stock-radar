import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, open, rename, stat, unlink } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve, join, isAbsolute } from "node:path";
import { promptText, schemaText, PROFILE, sha } from "./contract.ts";
import type { Binding } from "./source.ts";
import type { OsSnapshotProvider, ProviderResult } from "./runtime.ts";

export type RunProcess = (exe: string, args: string[], options: {cwd:string; timeoutMs:number; stdin:string; onPid:(pid:number)=>Promise<void>}) => Promise<{stdout:string;stderr:string;exitCode:number|null;error?:string}>;
const alive = (pid: number) => { try {process.kill(pid,0);return true;} catch {return false;} };
async function exists(path: string) {try {await stat(path);return true;} catch(e) {if ((e as NodeJS.ErrnoException).code==='ENOENT') return false;throw e;} }
async function atomic(path: string, data: string) {
  const temp = path+'.pending'; const f = await open(temp,'w',0o600);
  try {await f.writeFile(data);await f.sync();} finally {await f.close();}
  await rename(temp,path);
}
// Strip credentials from process diagnostics; auth files are never copied or loaded by this provider.
export const redact = (s:string) => s.replace(/\b(?:sk-[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,'[REDACTED]').replace(/(Bearer\s+)\S+/gi,'$1[REDACTED]');
export const runProcess: RunProcess = async (exe,args,options) => new Promise((done,reject) => {
  // Narrow environment: no product DB/provider keys and no inherited custom model routing.
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'production' };
  for (const key of ['PATH','Path','SystemRoot','WINDIR','USERPROFILE','HOME','APPDATA','LOCALAPPDATA','TEMP','TMP','CODEX_HOME']) if(process.env[key]) env[key]=process.env[key];
  const child = spawn(exe,args,{cwd:options.cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='',error:string|undefined;
  child.stdout.on('data', b=>{stdout+=String(b);writeFileSync(join(options.cwd,'stdout.log'),redact(stdout),{mode:0o600});});
  child.stderr.on('data', b=>{stderr+=String(b);writeFileSync(join(options.cwd,'stderr.log'),redact(stderr),{mode:0o600});});
  child.on('error',e=>{error=e.message;});
  const stop = () => {
    if (child.pid && process.platform==='win32') {try{execFileSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}catch{}}
    else child.kill('SIGKILL');
  };
  const timer=setTimeout(()=>{error='timeout';stop();},options.timeoutMs);
  child.on('close',code=>{clearTimeout(timer);done({stdout:redact(stdout),stderr:redact(stderr),exitCode:code,error});});
  child.stdin.on('error',()=>{});
  if(child.pid) options.onPid(child.pid).then(()=>child.stdin.end(options.stdin)).catch(e=>{stop();reject(e);});
});

/** Durable host-local process journal. Never infer "uncalled" from an expired DB lease. */
export class CodexCliOsSnapshotProvider implements OsSnapshotProvider {
  executable: string; root: string; runner: RunProcess; journalId: string;
  constructor(options:{executable:string;root:string;runner?:RunProcess}) {
    if (!isAbsolute(options.executable) || !isAbsolute(options.root)) throw Error('os_absolute_provider_paths_required');
    if (/\.(cmd|ps1|bat)$/i.test(options.executable)) throw Error('os_native_executable_required');
    this.executable=options.executable;this.root=resolve(options.root);this.runner=options.runner??runProcess;
    this.journalId=hostname()+':'+this.root;
    const repo=resolve(process.cwd());if(this.root===repo || this.root.startsWith(repo+ '\\') || this.root.startsWith(repo+'/')) throw Error('os_journal_must_be_outside_repository');
  }
  async run(binding: Binding, attempt: number, recoverOnly=false): Promise<ProviderResult> {
    if(binding.providerProfile!==PROFILE) return {raw:'',stdout:'',stderr:'Provider profile unavailable; retained job was not executed.',exitCode:null,cliVersion:'not_started',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),technicalError:'provider_profile_mismatch',retrySafe:false};
    const dir=join(this.root,binding.id,String(attempt)), resultPath=join(dir,'result.json');
    await mkdir(dir,{recursive:true});
    if(await exists(resultPath)) return JSON.parse(await readFile(resultPath,'utf8'));
    const markerPath=join(dir,'started.json'), outputPath=join(dir,'single-extraction.json');
    // A surviving Codex process owns this attempt even if its worker/DB lease disappeared.
    if(await exists(markerPath)) {
      const marker=JSON.parse(await readFile(markerPath,'utf8'));
      if(marker.host!==hostname() || (marker.pid && alive(marker.pid)) || !marker.pid) throw Error('os_execution_uncertain_do_not_retry');
      const raw=await exists(outputPath)?await readFile(outputPath,'utf8'):'';
      const freeze=await readMaybe(join(dir,'single-extraction-freeze.json'));
      let integrityError: string | undefined;
      if(raw) {try{if(JSON.parse(freeze).sha256!==sha(raw)) integrityError='First frozen output hash mismatch';}catch{integrityError='First output freeze missing or invalid';}}
      const result:ProviderResult={raw,stdout:await readMaybe(join(dir,'stdout.log')),stderr:await readMaybe(join(dir,'stderr.log')),
        exitCode:null,cliVersion:marker.cliVersion,startedAt:marker.startedAt,finishedAt:new Date().toISOString(),technicalError:raw?undefined:'worker_interrupted_before_final_output',retrySafe:true,freeze,integrityError};
      await atomic(resultPath,JSON.stringify(result));
      return result;
    }
    if(recoverOnly) throw Error('os_missing_journal_do_not_retry');
    const lock=join(this.root,'provider.lock');
    // Filesystem lock survives worker death. Reclaim only after BOTH owner and recorded child are dead.
    if(await exists(lock)) {
      const owner=JSON.parse(await readFile(lock,'utf8'));
      if(owner.host!==hostname() || alive(owner.workerPid)) throw Error('os_provider_busy');
      const old=JSON.parse(await readFile(owner.marker,'utf8'));
      if(!old.pid || alive(old.pid)) throw Error('os_execution_uncertain_do_not_retry');
      await unlink(lock);
    }
    const handle=await open(lock,'wx',0o600);
    await handle.writeFile(JSON.stringify({host:hostname(),workerPid:process.pid,marker:markerPath}));await handle.sync();await handle.close();
    try {
      if(attempt>1) {
        const prior=JSON.parse(await readFile(join(this.root,binding.id,String(attempt-1),'result.json'),'utf8'));
        if(prior.raw || !prior.retrySafe) throw Error('os_retry_forbidden');
      }
      let cliVersion='not_started';
      const startedAt=new Date().toISOString();
      const marker={host:hostname(),startedAt,cliVersion,bindingKey:binding.key,pid:0};
      try {
      await writeFile(join(dir,'filing.json'),JSON.stringify(binding.source.filing));
      await writeFile(join(dir,'blocks.jsonl'),binding.source.blocks.map(b=>JSON.stringify(b)).join('\n'));
      await writeFile(join(dir,'documents.json'),JSON.stringify(binding.source.documents));
      await writeFile(join(dir,'source.html'),binding.source.documents[0].original);
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
      // The frozen instruction writes its output files. Only this isolated directory is writable;
      // no product checkout, inherited instructions, plugins, MCP servers, or API credentials are supplied.
      const args=['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--color','never',
        '-c','default_permissions=":workspace"','-c','windows.sandbox="unelevated"',
        '-m','gpt-6-astra','-c','model_reasoning_effort="high"','-c','model_provider="openai"','-c','forced_login_method="chatgpt"',
        '-c','project_doc_max_bytes=0','-c','features.memories=false','-c','features.multi_agent=false','-c','features.skills=false',
        '-c','sandbox_workspace_write.network_access=false','-C',dir,'-o',join(dir,'final-message.txt'),'-'];
      const p=await this.runner(this.executable,args,{cwd:dir,timeoutMs:20*60*1000,
        stdin:'Read extraction-instructions.md and schema.json. Assigned filing metadata: filing.json. Complete neutral blocks: blocks.jsonl; documents.json retains source text and originals. Use only files in this directory. Do not delegate. Follow the frozen instructions exactly, including single-extraction.json and its freeze file.',
        onPid:async pid=>{marker.pid=pid;await atomic(markerPath,JSON.stringify(marker));}});
      const raw=await readMaybe(outputPath), freeze=await readMaybe(join(dir,'single-extraction-freeze.json'));
      let integrityError: string | undefined;
      if(raw) {
        try {if(JSON.parse(freeze).sha256!==sha(raw)) integrityError='First frozen output hash mismatch';}
        catch {integrityError='First output freeze missing or invalid';}
      }
      await atomic(join(dir,'stdout.log'),p.stdout);await atomic(join(dir,'stderr.log'),p.stderr);
      const result:ProviderResult={raw,stdout:p.stdout,stderr:p.stderr,exitCode:p.exitCode,cliVersion,startedAt:marker.startedAt,finishedAt:new Date().toISOString(),
        technicalError:raw?undefined:p.error??'final_output_missing',retrySafe:true,freeze,integrityError};
      await atomic(resultPath,JSON.stringify(result));return result;
    } finally {await unlink(lock).catch(()=>{});}
  }
}
async function readMaybe(path:string) {return await exists(path)?readFile(path,'utf8'):'';}
