type StoredRecord = Record<string, unknown>;

type StoredSourceContentInput = {
  event?: StoredRecord | null;
  metadata?: StoredRecord | null;
  rawItem?: StoredRecord | null;
  rawPayload?: StoredRecord | null;
  nestedPayload?: StoredRecord | null;
};

export function readStoredNewsSourceContent(input: StoredSourceContentInput) {
  const records = orderedRecords(input);
  return {
    html: firstStoredString(records, [
      "full_text_html",
      "original_html",
      "article_html",
      "content_html",
      "raw_html",
    ]),
    text: firstStoredString(records, ["body_text", "article_text", "full_text", "original_text"]),
  };
}

export function readStoredFilingSourceContent(input: StoredSourceContentInput) {
  const records = orderedRecords(input);
  return {
    html: firstStoredString(records, [
      "primary_document_html",
      "filing_html",
      "full_text_html",
      "original_html",
      "raw_html",
    ]),
    text: firstStoredString(records, [
      "body_text",
      "filing_text",
      "primary_document_text",
      "original_text",
      "analysis_text",
    ]),
  };
}

function orderedRecords(input: StoredSourceContentInput) {
  return [input.rawPayload, input.nestedPayload, input.rawItem, input.metadata, input.event];
}

function firstStoredString(
  records: Array<StoredRecord | null | undefined>,
  keys: string[],
) {
  for (const record of records) {
    if (!record) continue;
    for (const key of keys) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}
