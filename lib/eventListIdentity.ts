import { themeGroups, themeSubThemes } from "./taxonomyRegistry.ts";

export type EventListIdentityKind = "market" | "ticker";

export type EventListIdentity = {
  kind: EventListIdentityKind;
  primary: string;
  secondary: string;
};

export function getEventListIdentity({
  companyName,
  eventType,
  marketScope,
  sector,
  subTheme,
  themeGroup,
  ticker,
}: {
  companyName?: string | null;
  eventType?: string | null;
  marketScope?: string | null;
  sector?: string | null;
  subTheme?: string | null;
  themeGroup?: string | null;
  ticker?: string | null;
}): EventListIdentity {
  const normalizedEventType = normalizeTaxonomyValue(eventType);
  const normalizedScope = normalizeTaxonomyValue(marketScope) || "company";

  if (normalizedEventType === "policy_regulation") {
    return {
      kind: "market",
      primary: "POLICY",
      secondary: taxonomyLabel(subTheme) || "Policy & Regulation",
    };
  }

  if (normalizedEventType === "macro_market") {
    return {
      kind: "market",
      primary: "MACRO",
      secondary:
        taxonomyLabel(subTheme) || taxonomyLabel(themeGroup) || "Macro Market",
    };
  }

  if (normalizedScope === "company") {
    return {
      kind: "ticker",
      primary: normalizeTicker(ticker) || "N/A",
      secondary: companyName?.trim() || "Company name unavailable",
    };
  }

  if (normalizedScope === "sector") {
    return {
      kind: "market",
      primary: "SECTOR",
      secondary: readableLabel(sector) || "Sector-wide",
    };
  }

  if (normalizedScope === "theme") {
    return {
      kind: "market",
      primary: "THEME",
      secondary:
        taxonomyLabel(subTheme) || taxonomyLabel(themeGroup) || "Theme-wide",
    };
  }

  if (normalizedScope === "macro") {
    return {
      kind: "market",
      primary: "MACRO",
      secondary:
        taxonomyLabel(subTheme) || taxonomyLabel(themeGroup) || "Macro Market",
    };
  }

  return {
    kind: "market",
    primary: "THEME",
    secondary:
      taxonomyLabel(subTheme) || taxonomyLabel(themeGroup) || "Theme-wide",
  };
}

function taxonomyLabel(value?: string | null) {
  const normalized = normalizeTaxonomyValue(value);
  if (!normalized) return "";

  const subTheme = themeSubThemes.find(
    (item) =>
      normalizeTaxonomyValue(item.slug) === normalized ||
      normalizeTaxonomyValue(item.name) === normalized,
  );
  if (subTheme) return subTheme.name;

  const themeGroup = themeGroups.find(
    (item) =>
      normalizeTaxonomyValue(item.slug) === normalized ||
      normalizeTaxonomyValue(item.name) === normalized,
  );
  return themeGroup?.name || readableLabel(value);
}

function readableLabel(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bAi\b/g, "AI")
    .replace(/\bUs\b/g, "US");
}

function normalizeTaxonomyValue(value?: string | null) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeTicker(value?: string | null) {
  const ticker = String(value || "").trim().toUpperCase();
  return /^(?:N\/A|MARKET)$/.test(ticker) ? "" : ticker;
}
