type UnknownRecord = Record<string, unknown>;

export type NewsCompanyIdentityInput = {
  configuredSourceName?: string | null;
  rawPayload?: UnknownRecord | null;
  sourceCode?: string | null;
  title?: string | null;
};

export function resolveNewsCompanyName({
  configuredSourceName,
  rawPayload,
  sourceCode,
  title,
}: NewsCompanyIdentityInput) {
  const payload = rawPayload || {};
  const corporateAction = readRecord(payload.corporate_action);
  const tradeHalt = readRecord(payload.trade_halt);
  const normalizedSourceCode = normalize(sourceCode);
  const rejectedSourceNames = new Set(
    [
      configuredSourceName,
      readString(payload.source_name),
      readString(payload.provider),
      ...knownProviderNames(normalizedSourceCode),
    ]
      .map(normalize)
      .filter(Boolean),
  );
  const structuredCandidates = normalizedSourceCode === "nasdaq_corporate_actions"
    ? [
        readString(corporateAction?.company_name),
        readString(payload.company_name),
        readString(payload.issuer_name),
        readString(payload.issuer),
        extractNasdaqCorporateActionTitleCompany(title),
      ]
    : normalizedSourceCode === "nasdaq_trader"
      ? [
          readString(tradeHalt?.issueName),
          readString(payload.company_name),
          readString(payload.issuer_name),
          readString(payload.issuer),
        ]
      : [
          readString(payload.company_name),
          readString(payload.issuer_name),
          readString(payload.issuer),
        ];

  for (const candidate of structuredCandidates) {
    const companyName = cleanCompanyName(candidate);
    if (companyName && !rejectedSourceNames.has(normalize(companyName))) {
      return companyName;
    }
  }

  return null;
}

function cleanCompanyName(value: string | null | undefined) {
  const cleaned = readString(value)
    ?.replace(/^Control of\s+/i, "")
    .replace(/\s+(?:Class\s+[A-Z]\s+)?(?:Common Stock|Common Shares|Ordinary Shares|American Depositary Shares)$/i, "")
    .replace(/\s+(?:Rights?|Units?|Warrants?)$/i, "")
    .replace(/\s+\d+(?:\.\d+)?%\s+.*$/i, "")
    .replace(/\s+(?:Fixed\s*-\s*Rate\s+Reset\s+)?Series\s+[A-Z]\s+.*$/i, "")
    .replace(/\s+(?:Cumulative\s+)?(?:Perpetual\s+)?Redeemable\s+Preferred\s+Shares?$/i, "")
    .replace(/\s+Notes?\s+due\s+\d{4}$/i, "")
    .trim();
  return cleaned || null;
}

function extractNasdaqCorporateActionTitleCompany(title: string | null | undefined) {
  const text = readString(title) || "";
  return (
    /\bfor\s+(.+?)\s+\([A-Z][A-Z0-9./&\s-]{0,40}\)\s*$/i.exec(text)?.[1] ||
    /\bof\s+(.+?)\s+\([A-Z][A-Z0-9./&\s-]{0,40}\)\s*$/i.exec(text)?.[1] ||
    /\bregarding\s+(.+?)\s+\([A-Z][A-Z0-9./&\s-]{0,40}\)/i.exec(text)?.[1] ||
    null
  );
}

function readRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalize(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function knownProviderNames(sourceCode: string) {
  if (sourceCode === "nasdaq_corporate_actions") {
    return ["Nasdaq Trader", "Nasdaq Corporate Actions"];
  }
  if (sourceCode === "nasdaq_trader") return ["Nasdaq Trader"];
  return [];
}
