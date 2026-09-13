import { parseSecForm25Filing } from "../sources/sec/forms/form25/parser.ts";
import { readStoredDelistingState, type DelistingRepository, type StoredDelistingState } from "./reader.ts";
import { record, validScope } from "./state.ts";

export const FORM25_DELISTING_TRIGGER_VERSION = "form25_delisting_ingest_v1";
export type Form25DelistingRunRecord = {
  version: typeof FORM25_DELISTING_TRIGGER_VERSION;
  rawItemId: string; accession: string; asOf: string;
  status: "completed" | "unavailable" | "failed";
  reasons: string[];
  result?: Pick<StoredDelistingState, "version" | "scope" | "coverage" | "listing" | "trading" | "catalog"> & {
    evidence: Array<{
      rawItemId: string; eventId: string | null; accession: string; sourceUrl: string;
      sourceSha256: string; parserVersion: string; issuerCik: string | null;
      securityTitle: string | null; exchange: string | null; filedByCik: string | null;
      listing: string; trading: string; removalDate: string | null; suspensionDate: string | null;
      reasons: string[]; sourceDocuments: Array<{ url: string; sha256: string }>;
    }>;
  };
};

export function form25DelistingFailure(input: { rawItemId: string; accession: string; asOf: string }, reason: string): Form25DelistingRunRecord {
  return { version: FORM25_DELISTING_TRIGGER_VERSION, ...input, status: "failed", reasons: [reason] };
}

/** Only prepares the XML scope and invokes the existing selected-evidence reader.
 * The ingest owner records this compact outcome in its existing source-run record.
 * No raw metadata, current catalog, analysis, or downstream state is written. */
export async function runForm25DelistingAutomaticTrigger(input: {
  rawItemId: string; accession: string; asOf: string; repository?: DelistingRepository;
}): Promise<Form25DelistingRunRecord> {
  const request = { rawItemId: input.rawItemId, accession: input.accession, asOf: input.asOf };
  const base = { version: FORM25_DELISTING_TRIGGER_VERSION, ...request } as const;
  try {
    const repository = input.repository ?? await defaultRepository();
    const stored = await repository.select("raw_items", { select: "*", id: `eq.${input.rawItemId}`, limit: "2" });
    if (!stored.ok || !Array.isArray(stored.data) || stored.data.length !== 1) {
      return form25DelistingFailure(request, "stored_raw_missing_or_read_failed");
    }
    const raw = record(stored.data[0]);
    const payload = record(raw.raw_payload);
    if (raw.id !== input.rawItemId || raw.source_unique_id !== input.accession || raw.source_code !== "sec_edgar") {
      return { ...base, status: "unavailable", reasons: ["stored_raw_identity_mismatch"] };
    }
    // Deliberately exclude raw_payload.cik/ticker and catalog metadata: Form 25
    // is often filed by the exchange rather than the issuer of the security.
    const identity = parseSecForm25Filing({
      rawItemId: input.rawItemId, sourceUniqueId: input.accession,
      sourceUrl: text(payload.primary_document_url), publishedAt: text(raw.published_at),
      bodyText: text(payload.primary_document_html), rawPayload: { form_type: payload.form_type },
    });
    const facts = identity.facts;
    const scope = {
      issuerCik: facts.subject_company_cik?.value ?? "",
      securityTitle: facts.removed_security?.value ?? "", exchange: facts.exchange?.value ?? "",
    };
    if (!identity.isSupported || !validScope(scope)
      || !facts.subject_company_cik?.source.endsWith(".xml.issuer.cik")
      || !facts.removed_security?.source.endsWith(".xml.description_class_security")
      || !facts.exchange?.source.endsWith(".xml.exchange.entity_name")) {
      return { ...base, status: "unavailable", reasons: ["xml_scope_unavailable"] };
    }
    const result = await readStoredDelistingState({ scope, rawItemIds: [input.rawItemId], asOf: input.asOf, repository });
    const readFailed = result.reasons.some(reason => ["raw_source_missing_or_read_failed", "raw_identity_mismatch",
      "event_read_failed_or_ambiguous", "evidence_reader_failed"].includes(reason));
    return {
      ...base, status: readFailed ? "failed" : "completed", reasons: result.reasons,
      result: {
        version: result.version, scope: result.scope, coverage: result.coverage,
        listing: result.listing, trading: result.trading, catalog: result.catalog,
        evidence: result.evidence.map(({ parser: _parser, analysis: _analysis, listingRisk: _listingRisk,
          sourceDocuments, ...evidence }) => ({ ...evidence,
          sourceDocuments: sourceDocuments.map(({ url, sha256 }) => ({ url, sha256 })),
        })),
      },
    };
  } catch {
    return form25DelistingFailure(request, "delisting_reader_exception");
  }
}

async function defaultRepository(): Promise<DelistingRepository> {
  const { supabaseSelect, supabaseRpc } = await import("../supabase.ts");
  return { select: supabaseSelect, rpc: supabaseRpc };
}

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
