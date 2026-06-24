import type {
  SecFormAdapterDefinition,
  SecFormAdapterParseResult,
  SecFormAdapterRawItem,
} from "@/lib/sources/sec/forms/common/secFormAdapter";
import { parseSecS3Filing, type SecS3FilingFacts } from "./parser";

export type { SecS3FilingFacts } from "./parser";

export type S3F3FormAdapterResult = SecFormAdapterParseResult<"s3_f3"> & {
  hardParsers: {
    s3: ReturnType<typeof buildS3HardParserPayload>;
  };
  s3Parsed: SecS3FilingFacts;
  ownershipParsed: null;
};

export const s3F3FormAdapter: SecFormAdapterDefinition<
  "s3_f3",
  SecFormAdapterRawItem,
  S3F3FormAdapterResult
> = {
  key: "s3_f3",
  parserGroup: "s3",
  forms: ["S-3", "F-3", "S-3ASR", "F-3ASR", "S-3MEF", "F-3MEF", "S-3/A", "F-3/A"],
  analysisMode: "s3_offering_flow",
  matches: isS3F3CanonicalFormType,
  parse: (rawItem): S3F3FormAdapterResult => {
    const parsed = parseSecS3Filing({
      rawItemId: nullableString(rawItem.id),
      sourceUniqueId: nullableString(rawItem.source_unique_id),
      sourceUrl: nullableString(rawItem.source_url),
      title: nullableString(rawItem.title),
      publishedAt: nullableString(rawItem.published_at),
      bodyText: nullableString(rawItem.body_text),
      analysisText: nullableString(rawItem.analysis_text),
      rawPayload: rawItem.raw_payload,
      metadata: rawItem.metadata,
    });

    return {
      worker: {
        key: "s3_f3",
        parserGroup: "s3",
        analysisMode: "s3_offering_flow",
      },
      hardParsers: {
        s3: buildS3HardParserPayload(parsed),
      },
      s3Parsed: parsed,
      ownershipParsed: null,
    };
  },
};

function isS3F3CanonicalFormType(form: string | null | undefined) {
  return (
    form === "S-3" ||
    form === "S-3/A" ||
    form === "S-3ASR" ||
    form === "S-3MEF" ||
    form === "F-3" ||
    form === "F-3/A" ||
    form === "F-3ASR" ||
    form === "F-3MEF"
  );
}

function buildS3HardParserPayload(parsed: SecS3FilingFacts) {
  return {
    parser_version: parsed.parser_version,
    form_type: parsed.form_type,
    is_s3_family: parsed.is_s3_family,
    registration_statement_kind: parsed.registration_statement_kind?.value || null,
    registration_status: parsed.registration_status?.value || null,
    prospectus_status: parsed.prospectus_status?.value || null,
    primary_or_resale: parsed.primary_or_resale?.value || null,
    securities_registered: parsed.securities_registered.map((item) => item.value),
    shares_registered: parsed.shares_registered?.text || null,
    resale_share_count: parsed.resale_share_count?.text || null,
    current_shares_outstanding: parsed.current_shares_outstanding?.text || null,
    selling_stockholders: {
      count: parsed.selling_stockholders.length,
      rows: parsed.selling_stockholders.map((holder) => ({
        holder_name: holder.holder_name,
        shares_offered_for_resale: holder.shares_offered_for_resale?.text || null,
        beneficially_owned_before: holder.beneficially_owned_before?.text || null,
        beneficially_owned_after: holder.beneficially_owned_after?.text || null,
        percent_after: holder.percent_after?.text || null,
      })),
    },
    fee_table: {
      present: parsed.fee_table.present,
      text_available: parsed.fee_table.text_available,
      row_count: parsed.fee_table.rows.length,
      total_offering_amount: parsed.fee_table.totals.total_offering_amount?.text || null,
      net_fee_due: parsed.fee_table.totals.net_fee_due?.text || null,
    },
    offering_terms: {
      registration_statement_kind: parsed.offering_terms.registration_statement_kind?.value || null,
      offering_type: parsed.offering_terms.offering_type?.value || null,
      security_type: parsed.offering_terms.security_type?.value || null,
      primary_or_resale: parsed.offering_terms.primary_or_resale?.value || null,
      offering_amount: parsed.offering_terms.offering_amount?.text || null,
      shelf_capacity: parsed.offering_terms.shelf_capacity?.text || null,
      atm_program_size: parsed.offering_terms.atm_program_size?.text || null,
      resale_share_count: parsed.offering_terms.resale_share_count?.text || null,
      current_shares_outstanding: parsed.offering_terms.current_shares_outstanding?.text || null,
      warrant_coverage: parsed.offering_terms.warrant_coverage?.value || null,
      conversion_price: parsed.offering_terms.conversion_price?.text || null,
    },
    amendment: parsed.amendment.router_payload,
    needs_human_review: parsed.needs_human_review,
    review_reasons: parsed.review_reasons,
    cleaned_source_blocks: parsed.cleaned_source_blocks,
  };
}

function nullableString(value: unknown) {
  const text = stringValue(value);
  return text || null;
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}
