import { sha, validateOutput, record } from "./contract.ts";
import type { Binding } from "./source.ts";
import { repository, rpc, type Repository } from "./repository.ts";
export type ProviderResult = { raw: string; stdout: string; stderr: string; exitCode: number | null; cliVersion: string; startedAt: string; finishedAt: string; technicalError?: string; retrySafe?: boolean; freeze?: string; integrityError?: string };
export interface OsSnapshotProvider { journalId?: string; run(binding: Binding, attempt: number, recoverOnly?: boolean): Promise<ProviderResult> }
export async function processSnapshot(id: string, provider: OsSnapshotProvider, supplied?: Repository) {
  const repo = supplied ?? await repository();
  const claimed = await rpc(repo,"sec_os_snapshot_transition",{p_id:id,p_action:"claim"});
  if (!claimed.claimed) {
    if(!supplied&&['PASS','REVIEW_REQUIRED'].includes(claimed.status))await (await import('../projected-offering-dilution/repository.ts')).refreshProjectedForRun(id);
    return {status:claimed.status};
  }
  const token = String(claimed.token);
  const transition = (action: string, value?: unknown) => rpc(repo,"sec_os_snapshot_transition",{p_id:id,p_action:action,p_token:token,p_value:value??null});
  let leaseError: unknown;
  const heartbeat = setInterval(() => { void transition("heartbeat").catch(e => {leaseError=e;}); },20000);
  try {
    if (!claimed.checkpoint) {
      // Provider exceptions (including journal IO errors) are deliberately not retried here.
      // Recovery must reconcile the durable process journal before another invocation.
      const permit = await transition('provider_started',{journalId:provider.journalId??'injected-test-provider'});
      const result = await provider.run(claimed.binding as Binding,Number(claimed.attempt),permit.recoverOnly===true);
      const validation = result.raw ? result.integrityError ? {ok:false,stage:'source_output_integrity',errors:[result.integrityError],value:null,meaning:'NOT_ASSESSED'} : validateOutput(result.raw,claimed.binding.source) : null;
      const status = result.raw ? validation?.ok ? validation.value!.status : "VALIDATION_FAILED" : "TECHNICAL_FAILED";
      const cp = {status,raw:result.raw,rawHash:sha(result.raw),validated:validation?.value??null,validation,
        provider:result, evidenceRefs:validation?.value ? [...validation.value.current_os,...(validation.value.review?.candidates??[])].flatMap(r=>r.evidence_blocks):[]};
      if (leaseError) throw leaseError;
      await transition("checkpoint",cp);
    }
    const saved = await transition("finish");
    if(!supplied&&['PASS','REVIEW_REQUIRED'].includes(saved.status))await (await import('../projected-offering-dilution/repository.ts')).refreshProjectedForRun(id);
    return {status:saved.status};
  } finally { clearInterval(heartbeat); }
}
