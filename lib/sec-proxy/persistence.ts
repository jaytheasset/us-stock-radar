import { buildProxySource, hash, PURPOSE, record, stable, text, VERSION } from "./source.ts";
import { runProxyProposalRouting } from "../sources/sec/forms/proxy/proposalRouting.ts";
import type { ProxyFinalStructuredResult } from "../sources/sec/forms/proxy/finalStructured.ts";

type Row = Record<string, unknown>;
type Result = { ok: boolean; data: unknown; error?: string };
export type ProxyRepository = { select(table: string, query: Record<string,string>): Promise<Result>; rpc(name: string, payload: Row): Promise<Result> };
export async function proxyRepository(): Promise<ProxyRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}
export function rows(result: Result): Row[] {
  if (!result.ok || !Array.isArray(result.data)) throw Error(result.error || "proxy_read_failed");
  return result.data.map(record);
}
export async function rpc(repo: ProxyRepository, name: string, payload: Row) {
  const result = await repo.rpc(name,payload);
  if (!result.ok) throw Error(`${name}:${result.error || "failed"}`);
  return record(result.data);
}
export async function loadInput(rawItemId: string, repo: ProxyRepository, verificationKey?: string) {
  if (!/^[0-9a-f-]{36}$/i.test(rawItemId)) throw Error("proxy_invalid_raw_id");
  const raw = rows(await repo.select("raw_items",{select:"*",id:`eq.${rawItemId}`,limit:"2"}));
  if (raw.length !== 1) throw Error("proxy_raw_missing");
  return buildProxySource(raw[0],verificationKey);
}
export type ProxyInput = Awaited<ReturnType<typeof loadInput>>;
export async function readRun(repo: ProxyRepository, id: string) {
  return rows(await repo.select("ai_runs",{select:"*",id:`eq.${id}`,prompt_key:`eq.${PURPOSE}`,limit:"1"}))[0];
}
/** No network path: replay revalidates BOTH frozen schemas and their evidence bridge. */
export async function replayCheckpoints(input: ProxyInput, stages: Row) {
  let index = 0;
  return runProxyProposalRouting({ apiKey:"checkpoint-revalidation",sourcePackage:input.source,formType:input.formType,
    fetchImpl:async (_url, init) => {
      const stage = record(stages[index++ === 0 ? "call1" : "call2"]), response = record(stage.response);
      if (stage.state !== "complete" || stage.requestHash !== hash(text(init?.body))
        || response.bodyHash !== hash(text(response.body))) throw Error("proxy_checkpoint_integrity_invalid");
      return new Response(text(response.body),{status:Number(response.status)});
    } });
}
export type ProxyReadResult = {status:"not_ready";reason:string} | {
  status:"available";rawItemId:string;sourceExecutionId:string;persistedAt:string;filedAt:string;
  canonical:ProxyFinalStructuredResult; source:ProxyInput["source"]; binding:ProxyInput["binding"]; usage:unknown;
};
export async function readProxyStructured(rawItemId: string, supplied?: ProxyRepository, verificationKey?: string): Promise<ProxyReadResult> {
  try {
    const repo = supplied ?? await proxyRepository(), input = await loadInput(rawItemId,repo,verificationKey);
    const run = await readRun(repo,input.executionId);
    if (!run) {
      const previous = rows(await repo.select("ai_runs",{select:"id",raw_item_id:`eq.${rawItemId}`,prompt_key:`eq.${PURPOSE}`,
        "metadata->binding->>attempt":`eq.${input.binding.attempt}`,limit:"1"}));
      return {status:"not_ready",reason:previous.length ? "stale_source_or_version" : "structured_missing"};
    }
    const m = record(run.metadata), stages = record(m.stages);
    if (run.raw_item_id !== rawItemId || run.prompt_version !== VERSION || stable(m.binding) !== stable(input.binding)) throw Error("proxy_binding_mismatch");
    if (run.status !== "succeeded") {
      const abandoned = Object.values(stages).some(v => record(v).state === "started" && Date.parse(text(record(v).startedAt)) <= Date.now()-180000);
      return {status:"not_ready",reason:abandoned || m.state === "uncertain" ? "provider_outcome_uncertain" : `execution_${text(m.state)}`};
    }
    const output = rows(await repo.select("ai_outputs",{select:"*",ai_run_id:`eq.${input.executionId}`,output_type:`eq.${PURPOSE}`,limit:"2"}));
    if (output.length !== 1) throw Error("proxy_output_count_invalid");
    const payload = record(output[0].payload);
    if (stable(payload.binding) !== stable(input.binding) || payload.canonicalHash !== hash(stable(payload.canonical))) throw Error("proxy_output_integrity_invalid");
    const validated = await replayCheckpoints(input,stages);
    if (!validated.ok || stable(validated.call2?.run.validation.value) !== stable(payload.canonical)) throw Error("proxy_stored_validation_failed");
    if (!Number.isFinite(Date.parse(text(run.finished_at)))) throw Error("proxy_completion_date_invalid");
    return {status:"available",rawItemId,sourceExecutionId:input.executionId,persistedAt:text(run.finished_at),filedAt:input.binding.filedAt,
      canonical:validated.call2!.run.validation.value!,source:input.source,binding:input.binding,usage:run.usage};
  } catch (error) { return {status:"not_ready",reason:error instanceof Error ? error.message : "reader_unavailable"}; }
}
export async function readProxyAccession(accession: string, supplied?: ProxyRepository): Promise<ProxyReadResult> {
  try {
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) throw Error("proxy_invalid_accession");
    const repo = supplied ?? await proxyRepository();
    const raw = rows(await repo.select("raw_items",{select:"id",source_code:"eq.sec_edgar",source_unique_id:`eq.${accession}`,limit:"2"}));
    if (raw.length !== 1) throw Error("proxy_accession_not_unique");
    return readProxyStructured(text(raw[0].id),repo);
  } catch (error) { return {status:"not_ready",reason:String(error)}; }
}
