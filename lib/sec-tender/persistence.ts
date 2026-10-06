import {
  buildTenderBinding,
  hash,
  stable,
  TENDER_STRUCTURED_MODEL,
  TENDER_STRUCTURED_PURPOSE,
  TENDER_STRUCTURED_VERSION,
} from "./source.ts";
import { buildTenderStructuredRequest, parseTenderStructured, type TenderStructuredCanonical } from "./contract.ts";

type Row = Record<string, unknown>;
type Result = { ok: boolean; data: unknown; error?: string; status?: number };
export type TenderRepository = {
  select(table: string, query: Record<string, string>): Promise<Result>;
  rpc(name: string, payload: Row): Promise<Result>;
};

const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";

export function rows(result: Result): Row[] {
  if (!result.ok || !Array.isArray(result.data)) throw new Error(result.error || "tender_read_failed");
  return result.data.map(record);
}

export async function tenderRepository(): Promise<TenderRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}

export async function tenderRpc(repo: TenderRepository, name: string, payload: Row) {
  const result = await repo.rpc(name, payload);
  if (!result.ok) throw new Error(`${name}:${result.error || "failed"}`);
  return record(result.data);
}

export async function loadTenderStructuredInput(
  rawItemId: string,
  repo: TenderRepository,
) {
  if (!/^[0-9a-f-]{36}$/i.test(rawItemId)) throw new Error("tender_invalid_raw_item_id");
  const rawRows = rows(await repo.select("raw_items", { select: "*", id: `eq.${rawItemId}`, limit: "2" }));
  if (rawRows.length !== 1) throw new Error("tender_raw_missing");
  const built = buildTenderBinding(rawRows[0]);
  return { raw: rawRows[0], ...built };
}

export type TenderStructuredInput = Awaited<ReturnType<typeof loadTenderStructuredInput>>;

export async function readTenderRun(repo: TenderRepository, executionId: string) {
  return rows(await repo.select("ai_runs", {
    select: "*",
    id: `eq.${executionId}`,
    prompt_key: `eq.${TENDER_STRUCTURED_PURPOSE}`,
    limit: "1",
  }))[0];
}

export async function reserveTenderStructured(
  rawItemId: string,
  repo: TenderRepository,
) {
  const input = await loadTenderStructuredInput(rawItemId, repo);
  const reserved = await tenderRpc(repo, "reserve_sec_tender_structured", {
    p_id: input.executionId,
    p_binding: input.binding,
  });
  return { ...input, reserved: reserved.inserted === true };
}

export type TenderReadResult =
  | Readonly<{ status: "not_ready"; reason: string }>
  | Readonly<{
      status: "available";
      rawItemId: string;
      sourceExecutionId: string;
      persistedAt: string;
      filedAt: string;
      canonical: TenderStructuredCanonical;
      evidence: readonly unknown[];
      source: TenderStructuredInput["source"];
      binding: TenderStructuredInput["binding"];
      usage: unknown;
    }>;

export async function readTenderStructured(
  rawItemId: string,
  supplied?: TenderRepository,
): Promise<TenderReadResult> {
  try {
    const repo = supplied ?? await tenderRepository();
    const input = await loadTenderStructuredInput(rawItemId, repo);
    const run = await readTenderRun(repo, input.executionId);
    if (!run) {
      const previous = rows(await repo.select("ai_runs", {
        select: "id",
        raw_item_id: `eq.${rawItemId}`,
        prompt_key: `eq.${TENDER_STRUCTURED_PURPOSE}`,
        limit: "1",
      }));
      return { status: "not_ready", reason: previous.length ? "stale_source_or_version" : "structured_missing" };
    }
    const metadata = record(run.metadata);
    if (
      run.raw_item_id !== rawItemId
      || run.prompt_version !== TENDER_STRUCTURED_VERSION
      || run.model !== TENDER_STRUCTURED_MODEL
      || stable(metadata.binding) !== stable(input.binding)
    ) throw new Error("stale_source_or_version");

    if (run.status !== "succeeded") {
      const stage = record(record(metadata.stages).structured);
      const uncertain = stage.state === "started" || metadata.state === "uncertain";
      return {
        status: "not_ready",
        reason: uncertain ? "provider_outcome_uncertain" : `execution_${text(metadata.state) || text(run.status)}`,
      };
    }

    const outputs = rows(await repo.select("ai_outputs", {
      select: "*",
      ai_run_id: `eq.${input.executionId}`,
      output_type: `eq.${TENDER_STRUCTURED_PURPOSE}`,
      limit: "2",
    }));
    if (outputs.length !== 1) throw new Error("tender_output_count_invalid");
    const payload = record(outputs[0].payload);
    if (
      stable(payload.binding) !== stable(input.binding)
      || typeof payload.outputText !== "string"
      || payload.outputSha256 !== hash(payload.outputText)
    ) throw new Error("tender_output_binding_mismatch");

    const checkpoint = record(record(metadata.stages).structured);
    const response = record(checkpoint.response);
    if (checkpoint.state !== "complete" || response.bodyHash !== hash(text(response.body))
      || checkpoint.requestHash !== hash(JSON.stringify(buildTenderStructuredRequest(input.providerSource)))
      || stable(checkpoint.request) !== stable(buildTenderStructuredRequest(input.providerSource))) {
      throw new Error("tender_checkpoint_binding_mismatch");
    }
    const envelope = JSON.parse(text(response.body));
    const candidates = envelope.candidates;
    if (response.status !== 200 || envelope.modelVersion !== TENDER_STRUCTURED_MODEL
      || !Array.isArray(candidates) || candidates.length !== 1 || candidates[0].finishReason !== "STOP"
      || (candidates[0].content?.parts ?? []).filter((p: {text?: unknown; thought?: boolean}) => typeof p.text === "string" && !p.thought)
        .map((p: {text: string}) => p.text).join("") !== payload.outputText) throw new Error("tender_checkpoint_output_mismatch");

    const validated = parseTenderStructured(payload.outputText, input.source, input.providerSource);
    if (!validated.ok) throw new Error("tender_stored_output_invalid");
    if (stable(payload.canonical) !== stable(validated.result.canonical)
      || stable(payload.evidence) !== stable(validated.result.evidence)
      || payload.canonicalHash !== hash(stable(validated.result.canonical))) {
      throw new Error("tender_canonical_hash_mismatch");
    }
    if (!Number.isFinite(Date.parse(text(run.finished_at)))) throw new Error("tender_completion_date_invalid");

    return {
      status: "available",
      rawItemId,
      sourceExecutionId: input.executionId,
      persistedAt: text(run.finished_at),
      filedAt: input.binding.filedAt,
      canonical: validated.result.canonical,
      evidence: validated.result.evidence,
      source: input.source,
      binding: input.binding,
      usage: run.usage,
    };
  } catch (error) {
    return { status: "not_ready", reason: error instanceof Error ? error.message : "tender_reader_failed" };
  }
}

export async function readTenderAccession(
  accession: string,
  supplied?: TenderRepository,
): Promise<TenderReadResult> {
  try {
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) throw new Error("tender_invalid_accession");
    const repo = supplied ?? await tenderRepository();
    const raw = rows(await repo.select("raw_items", {
      select: "id",
      source_code: "eq.sec_edgar",
      source_unique_id: `eq.${accession}`,
      limit: "2",
    }));
    if (raw.length !== 1) throw new Error("tender_accession_not_unique");
    return readTenderStructured(text(raw[0].id), repo);
  } catch (error) {
    return { status: "not_ready", reason: error instanceof Error ? error.message : "tender_accession_reader_failed" };
  }
}
