import type { SecFilingAnalysisInput } from "../prompts/secFilingAnalysis.ts";
import { readSec425ParserOutput } from "./sec425AnalysisAdapter.ts";
import { SEC425_FACT_CANDIDATE_VERSION, SEC425_FACT_LOCAL_SCHEMA, SEC425_FACT_SYSTEM } from "../sources/sec/forms/425/factsCandidate.ts";
import { sec425FilingRoles, sec425OfficialCompanies, sec425SourceCompanies } from "../sources/sec/forms/425/verification.ts";

/** Fresh raw package → candidate FACT input. No Router/Primary response, saved prompt,
 * persistence, model dispatch, role assignment or source supplementation. */
export function buildSec425FactInput(input: SecFilingAnalysisInput) {
  const parser = readSec425ParserOutput(input), filing = input.filing_package as Record<string, unknown> | undefined;
  if (!parser || !filing || filing.form_type !== "425") throw Error("sec425_current_package_required");
  const source = filing.sec425_primary_source as { url?: unknown; sourceSha256?: unknown; complete?: unknown; representation?: unknown } | undefined;
  const accession = String(filing.accession_number ?? "");
  let validSource = false;
  try {
    const url = new URL(String(source?.url));
    validSource = url.origin === "https://www.sec.gov" && url.pathname.startsWith("/Archives/edgar/data/") &&
      /^\d{10}-\d{2}-\d{6}$/.test(accession) && url.pathname.includes(`/${accession.replaceAll("-", "")}/`) && !url.search && !url.hash;
  } catch { /* unavailable source */ }
  if (!validSource || source?.complete !== true || source.representation !== "stored_primary_html_utf8" ||
      typeof source.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(source.sourceSha256) || !parser.raw.cleaned_source_blocks.length) {
    throw Error("sec425_complete_primary_source_required");
  }
  return {
    key: "sec425_fact_input_v2", candidateVersion: SEC425_FACT_CANDIDATE_VERSION,
    system: `${SEC425_FACT_SYSTEM}\nOfficial company observations identify only the listed SEC filing roles and observed catalog symbols. They do not assign acquirer/target roles. Do not map another party by partial name or copy the filer CIK. Missing company identity remains unresolved. The filing timestamp is not the action timestamp.`,
    user: JSON.stringify({
      source: { accession, sourceUrl: source.url, sourceSha256: source.sourceSha256, representation: source.representation },
      filing_timestamp: filing.filed_at ?? null,
      filing_timestamps: filing.sec425_filing_timestamps ?? null,
      filing_roles: sec425FilingRoles(filing, parser.facts),
      official_company_observations: sec425OfficialCompanies(filing),
      source_company_observations: sec425SourceCompanies(filing, parser.raw.cleaned_source_blocks),
      scope: "All cleaned blocks of this freshly packaged filing and collected attachments; no Router selection or prior analysis. The primary source hash does not authenticate attachment bytes.",
      cleaned_source_blocks: parser.raw.cleaned_source_blocks.map(({ block_id, heading, text, source_ref, origin, document_role }) => ({ block_id, heading, text, source_ref, origin, document_role })),
    }),
    responseFormat: { type: "json_schema", json_schema: { name: SEC425_FACT_CANDIDATE_VERSION, strict: true, schema: SEC425_FACT_LOCAL_SCHEMA } },
    providerCalls: 0 as const,
  };
}
