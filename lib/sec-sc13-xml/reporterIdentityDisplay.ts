import type { Sc13VerifiedReporterIdentity } from "./reporterIdentity.ts";

/** Link only the accession-bound originals retained by the verified identity snapshot. */
export function sc13ReporterIdentityLinks(identity: Sc13VerifiedReporterIdentity | undefined) {
  if (!identity || identity.basis !== "sec_header_index_single_reporter" || !/^\d{10}-\d{2}-\d{6}$/.test(identity.accessionNumber)) return [];
  const accession = identity.accessionNumber;
  return [
    { label: "SEC filing header", url: identity.submissionSourceUrl, filename: `${accession}.txt` },
    { label: "SEC filing index", url: identity.indexSourceUrl, filename: `${accession}-index.html` },
  ].flatMap(({ label, url, filename }) => {
    if (typeof url !== "string" || !/^https:\/\/www\.sec\.gov\//.test(url) || /[?#]/.test(url)) return [];
    try {
      const parsed = new URL(url);
      return parsed.pathname === `/Archives/edgar/data/${parsed.pathname.split("/")[4]}/${accession.replaceAll("-", "")}/${filename}`
        && /^\d+$/.test(parsed.pathname.split("/")[4] ?? "") ? [{ label, url }] : [];
    } catch { return []; }
  });
}
