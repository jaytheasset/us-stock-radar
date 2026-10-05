// Shared syntax checks; no source parsing or server-only dependencies.
export const accessionPattern = /^\d{10}-\d{2}-\d{6}$/;
export const fileNumberPattern = /^333-\d+(?:-\d+)?$/;
export function cik(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{1,10}$/.test(text) && Number(text) > 0 ? text.padStart(10, "0") : "";
}
export function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
export function secDocumentUrl(url: string, accession?: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "www.sec.gov"
      && /^\/Archives\/edgar\/data\/\d+\/\d{18}\/[^/]+$/.test(parsed.pathname)
      && (!accession || parsed.pathname.split("/")[5] === accession.replaceAll("-", ""));
  } catch { return false; }
}
