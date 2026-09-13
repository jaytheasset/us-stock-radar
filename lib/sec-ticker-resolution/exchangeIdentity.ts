// Existing product-projection equivalence, shared with Alert cover identity checks.
export function normalizeSecTickerProjectionExchange(value: unknown) {
  const normalized = (typeof value === "string" ? value.trim() : "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("nasdaq")) return "nasdaq";
  if (normalized.includes("newyorkstockexchange") || normalized === "nyse") return "nyse";
  if (normalized.includes("nyseamerican") || normalized.includes("americanstockexchange")) return "nyse-american";
  return normalized;
}
