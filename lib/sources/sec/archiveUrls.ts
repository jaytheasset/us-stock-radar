const SEC_BASE_URL = "https://www.sec.gov";

const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;

export type SecArchiveFilingUrls = {
  archiveDirectoryUrl: string;
  indexJsonUrl: string;
  indexHtmlUrl: string;
  submissionTextUrl: string;
};

export function buildSecArchiveFilingUrls(
  cik: string | number | null | undefined,
  accessionNumber: string | null | undefined,
): SecArchiveFilingUrls | null {
  const normalizedCik = normalizeArchiveCik(cik);
  const normalizedAccession = normalizeArchiveAccession(accessionNumber);
  if (!normalizedCik || !normalizedAccession) return null;

  const accessionNoDashes = normalizedAccession.replace(/-/g, "");
  const archiveDirectoryUrl = `${SEC_BASE_URL}/Archives/edgar/data/${normalizedCik}/${accessionNoDashes}`;

  return {
    archiveDirectoryUrl,
    indexJsonUrl: `${archiveDirectoryUrl}/index.json`,
    indexHtmlUrl: `${archiveDirectoryUrl}/${normalizedAccession}-index.html`,
    submissionTextUrl: `${archiveDirectoryUrl}/${normalizedAccession}.txt`,
  };
}

export function buildSecArchiveIndexUrlFromMasterFilename(filename: string | null | undefined) {
  const cleaned = String(filename || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
  const match = cleaned.match(
    /^edgar\/data\/(\d+)\/(?:\d{18}\/)?(\d{10}-\d{2}-\d{6})\.txt$/i,
  );
  if (!match) return null;

  return buildSecArchiveFilingUrls(match[1], match[2])?.indexHtmlUrl || null;
}

function normalizeArchiveCik(value: string | number | null | undefined) {
  const digits = String(value ?? "").trim().replace(/^0+/, "");
  if (!/^\d+$/.test(digits)) return null;
  return digits;
}

function normalizeArchiveAccession(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  return ACCESSION_PATTERN.test(normalized) ? normalized : null;
}
