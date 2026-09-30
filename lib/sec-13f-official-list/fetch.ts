import { SecRequestPolicy } from "../sec-structured-data/secRequestPolicy.ts";
import { officialListQuarterFromUrl, parseSec13fOfficialList } from "./parser.ts";

const MAX_SOURCE_BYTES = 16 * 1024 * 1024;

export async function fetchSec13fOfficialList(input: {
  sourceUrl: string;
  expectedQuarter: string;
  userAgent: string;
  requestPolicy?: SecRequestPolicy;
}) {
  if (officialListQuarterFromUrl(input.sourceUrl) !== input.expectedQuarter) {
    throw new Error("SEC Official List URL does not match the requested quarter");
  }
  const policy = input.requestPolicy ?? new SecRequestPolicy(input.userAgent);
  const response = await policy.fetch(input.sourceUrl, { headers: { Accept: "text/plain" } });
  if (!response.ok) throw new Error(`SEC Official List request failed (${response.status})`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_SOURCE_BYTES) {
    await response.body?.cancel();
    throw new Error("SEC Official List source is unexpectedly large");
  }
  const sourceBytes = new Uint8Array(await response.arrayBuffer());
  if (sourceBytes.byteLength > MAX_SOURCE_BYTES) throw new Error("SEC Official List source is unexpectedly large");
  return parseSec13fOfficialList({
    sourceUrl: input.sourceUrl,
    expectedQuarter: input.expectedQuarter,
    sourceBytes,
    fetchedAt: new Date().toISOString(),
  });
}
