import type {Repository} from '../sec-os-snapshot/repository.ts';

const purpose = 'sec_combined_offering';
const pending = ['QUEUED', 'RUNNING', 'TECHNICAL_FAILED'] as const;
type Domain = 'sec_os_snapshot' | 'sec_offering_plan';
export type CommonExecution = {
 id: string; status: typeof pending[number]; filing: Record<string, string>; ticker: string | null;
 startedAt: string | null; finishedAt: string | null; reason: 'source_unavailable_or_mismatch' | null;
};
export const commonSummaryFields = 'prompt_key,combinedStatus:metadata->>combinedStatus,commonFiling:metadata->binding->filing,commonTicker:metadata->binding->ticker';
/** Filter before ordering/limiting: completed parents are represented by their domain children. */
export const adminHistoryFilter = (domain: Domain) =>
 `(prompt_key.eq.${domain},and(prompt_key.eq.${purpose},metadata->>combinedStatus.in.(${pending.join(',')})))`;

export function commonExecution(run: Record<string, any>): CommonExecution | null {
 if (run.prompt_key !== purpose) return null;
 const status = run.metadata?.combinedStatus ?? run.combinedStatus;
 if (!pending.includes(status)) throw Error('common_execution_status_invalid');
 const binding = run.metadata?.binding;
 return {id: String(run.id), status, filing: binding?.filing ?? run.commonFiling,
  ticker: binding?.ticker ?? run.commonTicker ?? null,
  startedAt: run.started_at ?? null, finishedAt: run.finished_at ?? null,
  reason: status === 'TECHNICAL_FAILED' && run.metadata?.combinedCheckpoint?.reason === 'source_unavailable_or_mismatch'
   ? 'source_unavailable_or_mismatch' : null};
}

async function exact(repo: Repository, id: string, prompt: string) {
 const result = await repo.select('ai_runs', {id: `eq.${id}`, prompt_key: prompt, select: '*', limit: '1'});
 if (!result.ok || !Array.isArray(result.data)) throw Error('ai_runs: read_failed');
 return result.data[0] as Record<string, any> | undefined;
}
/** Only follows the designated child of this exact invocation, never a latest/family result. */
export async function readAdminHistoryRun(id: string, domain: Domain, repo: Repository) {
 let run = await exact(repo, id, `in.(${domain},${purpose})`);
 if (!run) throw Error('admin_run_missing');
 if (run.prompt_key !== purpose) return {run, commonExecution: null};
 if (run.metadata?.combinedStatus !== 'COMPLETE') return {run, commonExecution: commonExecution(run)};
 const parent = run, binding = parent.metadata.binding;
 const childId = domain === 'sec_os_snapshot' ? binding?.osRunId : binding?.offeringRunId;
 if (binding?.id !== parent.id || binding?.rawItemId !== parent.raw_item_id || typeof childId !== 'string' || !/^[0-9a-f-]{36}$/i.test(childId)) throw Error('common_child_mismatch');
 run = await exact(repo, childId, `eq.${domain}`);
 if (!run || run.id !== childId || run.prompt_key !== domain || run.raw_item_id !== parent.raw_item_id ||
  run.metadata?.executionKind !== 'derived_domain_view' || run.metadata?.combinedInvocationId !== parent.id) throw Error('common_child_mismatch');
 return {run, commonExecution: null};
}
