import {adminHistoryFilter,commonSummaryFields,commonExecution,readAdminHistoryRun} from "../sec-combined-offering/adminHistory.ts";
import { record, PURPOSE } from "./contract.ts";
import { buildSource, bindingFor } from "./source.ts";
export interface Repository {
  select(table: string, query: Record<string,string>): Promise<{ ok: boolean; data?: unknown; error?: string }>;
  rpc(name: string, args: Record<string,unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }>;
}
export async function repository(): Promise<Repository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
export async function rpc(repo: Repository, name: string, args: Record<string,unknown>) {
  const r = await repo.rpc(name,args);
  if (!r.ok) throw Error(`${name}: ${r.error ?? "failed"}`);
  return record(r.data);
}
export async function select(repo: Repository, table: string, query: Record<string,string>) {
  const r = await repo.select(table,query);
  if (!r.ok || !Array.isArray(r.data)) throw Error(`${table}: read_failed`);
  return r.data.map(record);
}
export async function enqueueOsSnapshot(rawItemId: string, repo?: Repository) {
  repo ??= await repository();
  const raw = (await select(repo,"raw_items",{id:`eq.${rawItemId}`,select:"*",limit:"1"}))[0];
  if (!raw) throw Error("os_raw_missing");
  let source;
  try { source = buildSource(raw); }
  catch (e) { if (String(e).includes("not_ready")) return {status:"source_not_ready"}; throw e; }
  return rpc(repo,"reserve_sec_os_snapshot",{p_binding:bindingFor(rawItemId,source)});
}
export async function listSnapshots(repo?: Repository) {
  const rows = await select(repo ?? await repository(),"ai_runs",{or:adminHistoryFilter(PURPOSE),
    select:commonSummaryFields+",id,raw_item_id,started_at,finished_at,osStatus:metadata->>osStatus,attempt:metadata->attempt,filing:metadata->binding->source->filing,ticker:metadata->binding->source->ticker,sourceFingerprint:metadata->binding->>sourceFingerprint,contractVersion:metadata->binding->>contractVersion",
    order:"metadata->>reservedAt.desc",limit:"100"});
  return rows.map(r=>({commonExecution:commonExecution(r),id:String(r.id),started_at:r.started_at,finished_at:r.finished_at,metadata:{osStatus:r.osStatus,attempt:r.attempt,binding:{source:{filing:r.filing,ticker:r.ticker},sourceFingerprint:r.sourceFingerprint,contractVersion:r.contractVersion}}}));
}
export async function readSnapshot(id: string, repo?: Repository) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw Error("os_id_invalid");
  repo ??= await repository();
  const {run,commonExecution} = await readAdminHistoryRun(id,PURPOSE,repo);
  if (commonExecution) return {run,commonExecution,decisions:[],current:false};
  const decisions = await select(repo,"sec_os_snapshot_decisions",{run_id:`eq.${run.id}`,select:"*",order:"created_at.asc"});
  // Explicit current-source comparison; historical runs never overwrite a latest pointer.
  let current = false;
  try {
    if(run.metadata.executionKind==='derived_domain_view'){
      run.metadata={...run.metadata,commonInvocation:await (await import('../sec-combined-offering/repository.ts')).readCommonInvocation(run,repo)};
      const combined=await (await import('../sec-combined-offering/repository.ts')).readCombinedDomainSource(run,repo);
      current=true;
      // Read-only display hydration; no stored run or original response is rewritten.
      run.metadata={...run.metadata,binding:{...run.metadata.binding,source:combined.source},
        commonInvocation:run.metadata.commonInvocation};
    }else{
      const raw = (await select(repo,"raw_items",{id:`eq.${run.raw_item_id}`,select:"*",limit:"1"}))[0];
      current = buildSource(raw).fingerprint === run.metadata.binding.sourceFingerprint;
    }
  } catch { /* Missing/unready current raw is not proof of absence. */ }
  return {run,decisions,current,commonExecution:null};
}

/** Exact selected-run navigation only; no calculation or amendment fallback. */
export async function readMatchingOfferingRun(run:Record<string,any>,repo:Repository):Promise<string|null>{
  if(run.metadata?.executionKind==='derived_domain_view'){
    const common=await (await import('../sec-combined-offering/repository.ts')).readCommonInvocation(run,repo);
    return common.offeringRunId;
  }
  const pair=await rpc(repo,'read_projected_offering_inputs',{p_raw_id:run.raw_item_id});
  return pair.raw?.id===run.raw_item_id&&pair.os?.id===run.id&&typeof pair.offering?.id==='string'?pair.offering.id:null;
}
