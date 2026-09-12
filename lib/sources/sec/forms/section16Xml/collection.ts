import {
  fetchSecEdgarRawItems,
  type SecParsedRawItem,
  type SecRawFetchResult,
} from "../../parser.ts";
import {
  SECTION_16_XML_FORMS,
  Section16XmlParseError,
  parseSection16XmlFiling,
  preserveSection16XmlSource,
  type Section16XmlForm,
  type Section16XmlParserOutput,
} from "./parser.ts";

export interface FetchSection16XmlFilingOptions {
  accessionNumber: string;
  formType: Section16XmlForm;
}

export interface FetchedSection16XmlFiling {
  rawItem: SecParsedRawItem;
  parsed: Section16XmlParserOutput;
  diagnostics: SecRawFetchResult["diagnostics"];
}

/**
 * Explicit, non-persisting collection path for Forms 3/3-A/5/5-A.
 * It reuses the production SEC archive fetcher, preserves its exact ownership
 * XML response with a SHA-256, and immediately applies the XML-only parser.
 */
export async function fetchAndParseSection16XmlFiling(
  options: FetchSection16XmlFilingOptions,
): Promise<FetchedSection16XmlFiling> {
  if (!SECTION_16_XML_FORMS.includes(options.formType)) {
    throw new Section16XmlParseError("unsupported_form", `Unsupported Section 16 XML form: ${options.formType}`);
  }

  const fetched = await fetchSecEdgarRawItems({
    accessionNumber: options.accessionNumber,
    formTypes: [options.formType],
    includeDocuments: true,
  });
  if (!fetched.ok) {
    throw new Section16XmlParseError(
      "collection_failed",
      fetched.error || `SEC collection failed with status ${fetched.status}`,
    );
  }
  if (fetched.items.length !== 1) {
    throw new Section16XmlParseError(
      "collection_identity_mismatch",
      `SEC collection returned ${fetched.items.length} items for one accession`,
    );
  }

  const collected = fetched.items[0];
  const rawPayload = asRecord(collected.raw_payload);
  const formType = requiredString(rawPayload.form_type, "Collected SEC form type is missing");
  if (formType !== options.formType) {
    throw new Section16XmlParseError("collection_identity_mismatch", "Collected SEC form type does not match the requested form");
  }
  const accessionNumber = requiredString(rawPayload.accession_number, "Collected SEC accession number is missing");
  if (accessionNumber !== options.accessionNumber || collected.source_unique_id !== options.accessionNumber) {
    throw new Section16XmlParseError("collection_identity_mismatch", "Collected SEC accession identity does not match the request");
  }
  parseSection16XmlFiling(collected);
  const sourceUrl = requiredString(rawPayload.ownership_source_url, "Collected SEC ownership XML URL is missing");
  const sourceText = requiredSourceText(rawPayload.ownership_source_text);
  const preserved = preserveSection16XmlSource({ formType, sourceUrl, text: sourceText });
  const rawItem: SecParsedRawItem = {
    ...collected,
    raw_payload: {
      ...rawPayload,
      ...preserved,
    },
  };

  return {
    rawItem,
    parsed: parseSection16XmlFiling(rawItem),
    diagnostics: fetched.diagnostics,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function requiredString(value: unknown, message: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Section16XmlParseError("collection_source_missing", message);
  }
  return value.trim();
}

function requiredSourceText(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Section16XmlParseError("collection_source_missing", "Collected SEC ownership XML text is missing");
  }
  return value;
}
