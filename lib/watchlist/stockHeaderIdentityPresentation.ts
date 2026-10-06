import type { StockHeaderSecIdentity } from "./stockHeaderSecIdentity.ts";

export function stockHeaderIdentityPresentation(ticker: string | null, identity?: StockHeaderSecIdentity) {
  const matched = identity?.ticker === ticker ? identity : undefined;
  const status = matched?.status ?? "unavailable";
  if (matched?.status === "available") {
    return { status, companyName: matched.companyName, exchange: matched.exchange,
      confirmedAt: matched.confirmedAt,
      confirmationLabel: `SEC checked ${new Date(matched.confirmedAt).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}` };
  }
  return { status, companyName: status === "not-confirmed"
    ? "Company information not yet confirmed" : "Company information temporarily unavailable",
    exchange: "", confirmedAt: null, confirmationLabel: "" };
}
