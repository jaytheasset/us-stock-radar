export type SecFormFetchRule = {
  id: string;
  reason: string;
  maxDocuments?: number;
  typePrefixes?: readonly string[];
  typePatterns?: readonly RegExp[];
  labelPatterns?: readonly RegExp[];
  filenamePatterns?: readonly RegExp[];
  preserveRawText?: boolean;
};

export type SecFormFetchPlan = {
  room: string;
  forms: readonly string[];
  defaultAttachmentLimit: number;
  notes: readonly string[];
  rules: readonly SecFormFetchRule[];
};

export type SecFetchCandidate = {
  type?: string | null;
  description?: string | null;
  document?: string | null;
  url?: string | null;
  isPrimary?: boolean | null;
};

export function matchesSecFormFetchRule(candidate: SecFetchCandidate, rule: SecFormFetchRule) {
  if (!isSecTextFetchCandidate(candidate)) return false;

  const type = stringValue(candidate.type).toUpperCase();
  const label = [candidate.type, candidate.description, candidate.document, candidate.url].map(stringValue).join(" ");
  const filename = stringValue(candidate.document) || stringValue(candidate.url);

  if (rule.typePrefixes?.some((prefix) => type.startsWith(prefix.toUpperCase()))) return true;
  if (rule.typePatterns?.some((pattern) => pattern.test(type))) return true;
  if (rule.labelPatterns?.some((pattern) => pattern.test(label))) return true;
  if (rule.filenamePatterns?.some((pattern) => pattern.test(filename))) return true;

  return false;
}

export function isSecTextFetchCandidate(candidate: SecFetchCandidate) {
  const type = stringValue(candidate.type).toUpperCase();
  const filename = `${stringValue(candidate.document)} ${stringValue(candidate.url)}`;

  if (/^(?:GRAPHIC|PDF|ZIP|EXCEL|XLS|XLSX|POWERPOINT|PPT|PPTX|BINARY)$/.test(type)) return false;
  if (/\.(?:avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp|pdf|zip|7z|rar|gz|xlsx?|xlsm|pptx?)(?:$|[?#])/i.test(filename)) {
    return false;
  }

  return true;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
