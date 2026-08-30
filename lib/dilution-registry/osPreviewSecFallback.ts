import { SecRequestPolicy } from "../sec-structured-data/secRequestPolicy.ts";
import { buildSecArchiveFilingUrls } from "../sources/sec/archiveUrls.ts";
import { decodeSecHtmlEntities } from "../sources/sec/htmlEntities.ts";

export type OsPreviewSecDocument = {
  source_ref: string;
  source_url: string;
  document_name: string;
  label: string;
  text: string;
};

export type OsPreviewSecRequestPolicy = Pick<SecRequestPolicy, "fetch">;

export type OfficialSecFilingDocumentResult =
  | {
      ok: true;
      document: OsPreviewSecDocument;
      filingForm: string;
      indexUrl: string;
    }
  | { ok: false; reason: string };

const MAX_REDIRECTS = 4;
const INDEX_JSON_BYTES = 2 * 1024 * 1024;
const INDEX_HTML_BYTES = 3 * 1024 * 1024;
const FILING_DOCUMENT_BYTES = 12 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

export function isSafeSecSourceRef(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 255 &&
    value === value.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) &&
    !value.includes("..") &&
    !/[\\/%?#]/.test(value)
  );
}

export async function fetchOfficialSecFilingDocument(input: {
  issuerCik: string;
  accessionNumber: string;
  sourceForm: string;
  sourceRef: string;
  requestPolicy: OsPreviewSecRequestPolicy;
}): Promise<OfficialSecFilingDocumentResult> {
  if (!/^[0-9]{10}$/.test(input.issuerCik) || input.issuerCik === "0000000000") {
    return { ok: false, reason: "The issuer CIK is not canonical." };
  }
  if (!/^[0-9]{10}-[0-9]{2}-[0-9]{6}$/.test(input.accessionNumber)) {
    return { ok: false, reason: "The SEC accession is not canonical." };
  }
  if (!isSafeSecSourceRef(input.sourceRef)) {
    return { ok: false, reason: "The SEC source_ref is not one safe filename." };
  }
  if (!isStrictForm(input.sourceForm)) {
    return { ok: false, reason: "The SEC form is not canonical." };
  }

  const urls = buildSecArchiveFilingUrls(input.issuerCik, input.accessionNumber);
  if (!urls) return { ok: false, reason: "The official SEC Archives URL could not be constructed." };
  const expectedDirectory = `/Archives/edgar/data/${stripCikZeros(input.issuerCik)}/${input.accessionNumber.replaceAll("-", "")}`;

  try {
    const indexJson = await fetchBoundedOfficialSecText({
      acceptedTypes: ["application/json", "text/json"],
      maxBytes: INDEX_JSON_BYTES,
      requestPolicy: input.requestPolicy,
      url: urls.indexJsonUrl,
    });
    const directory = readDirectoryIndex(indexJson.text);
    if (directory.name !== expectedDirectory) {
      return { ok: false, reason: "The official SEC directory does not match the requested CIK and accession." };
    }
    if (!directory.documentNames.includes(input.sourceRef)) {
      return { ok: false, reason: "The source_ref is not listed in the exact official SEC filing." };
    }

    const indexHtml = await fetchBoundedOfficialSecText({
      acceptedTypes: ["text/html", "application/xhtml+xml"],
      maxBytes: INDEX_HTML_BYTES,
      requestPolicy: input.requestPolicy,
      url: urls.indexHtmlUrl,
    });
    const liveForm = readFilingForm(indexHtml.text);
    if (!liveForm || normalizeForm(liveForm) !== normalizeForm(input.sourceForm)) {
      return { ok: false, reason: "The official SEC filing form does not exactly match source_form." };
    }

    const documentUrl = `${urls.archiveDirectoryUrl}/${input.sourceRef}`;
    const filingDocument = await fetchBoundedOfficialSecText({
      acceptedTypes: ["text/html", "application/xhtml+xml", "text/plain"],
      maxBytes: FILING_DOCUMENT_BYTES,
      requestPolicy: input.requestPolicy,
      url: documentUrl,
    });
    return {
      ok: true,
      filingForm: liveForm,
      indexUrl: indexHtml.finalUrl,
      document: {
        source_ref: input.sourceRef,
        source_url: filingDocument.finalUrl,
        document_name: input.sourceRef,
        label: input.sourceRef,
        text: normalizeSecDocumentText(filingDocument.text),
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "The official SEC source check failed closed.",
    };
  }
}

export function normalizeSecDocumentText(source: string) {
  const withoutHidden = source
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<ix:hidden[\s\S]*?<\/ix:hidden>/gi, " ")
    .replace(/<\?xml[\s\S]*?\?>/gi, " ");
  const withBreaks = withoutHidden
    .replace(/<\/(p|div|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ");
  return decodeSecHtmlEntities(withBreaks)
    .replace(/<[^>]+>/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function fetchBoundedOfficialSecText(input: {
  acceptedTypes: string[];
  maxBytes: number;
  requestPolicy: OsPreviewSecRequestPolicy;
  url: string;
}) {
  let currentUrl = input.url;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    assertOfficialSecUrl(currentUrl);
    const response = await input.requestPolicy.fetch(currentUrl, {
      cache: "no-store",
      headers: { Accept: input.acceptedTypes.join(", ") },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The official SEC response redirected without a location.");
      currentUrl = new URL(location, currentUrl).href;
      continue;
    }
    if (!response.ok) throw new Error(`The official SEC source returned HTTP ${response.status}.`);
    assertOfficialSecUrl(response.url || currentUrl);
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!input.acceptedTypes.some((type) => contentType.includes(type))) {
      throw new Error("The official SEC source returned an unsupported content type.");
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > input.maxBytes) {
      throw new Error("The official SEC source exceeded the response-size limit.");
    }
    return {
      finalUrl: response.url || currentUrl,
      text: await readBoundedBody(response, input.maxBytes),
    };
  }
  throw new Error("The official SEC source exceeded the redirect limit.");
}

async function readBoundedBody(response: Response, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("The official SEC source exceeded the response-size limit.");
    }
    chunks.push(chunk.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function assertOfficialSecUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    (url.hostname.toLowerCase() !== "sec.gov" &&
      url.hostname.toLowerCase() !== "www.sec.gov") ||
    !url.pathname.startsWith("/Archives/edgar/data/")
  ) {
    throw new Error("The SEC source or redirect target is not an allowed official Archives URL.");
  }
}

function readDirectoryIndex(source: string) {
  const parsed = JSON.parse(source) as unknown;
  const root = record(parsed);
  const directory = record(root?.directory);
  const name = typeof directory?.name === "string" ? directory.name : "";
  const documentNames = Array.isArray(directory?.item)
    ? directory.item.flatMap((value) => {
        const item = record(value);
        return typeof item?.name === "string" ? [item.name] : [];
      })
    : [];
  return { documentNames, name };
}

function readFilingForm(source: string) {
  const container = source.match(
    /<div\b[^>]*(?:id|class)\s*=\s*["'][^"']*\bformName\b[^"']*["'][^>]*>([\s\S]{0,300}?)<\/div>/i,
  );
  const label = decodeSecHtmlEntities(container?.[1]?.replace(/<[^>]+>/g, " ") ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return label.match(/\bForm\s+([A-Za-z0-9-]+(?:\/A)?)/i)?.[1] ?? null;
}

function normalizeForm(value: string) {
  return value.trim().toUpperCase();
}

function isStrictForm(value: string) {
  return value === value.trim() && /^[A-Za-z0-9][A-Za-z0-9-]*(?:\/A)?$/.test(value);
}

function stripCikZeros(cik: string) {
  return cik.replace(/^0+/, "") || "0";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
