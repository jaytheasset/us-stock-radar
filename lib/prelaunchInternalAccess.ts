import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isPrelaunchMode } from "./prelaunch.ts";
import { consumePrelaunchInternalNonce } from "./prelaunchInternalNonce.ts";

export const PRELAUNCH_INTERNAL_PROOF_HEADER =
  "x-sr-prelaunch-internal-proof";
export const PRELAUNCH_INTERNAL_PROOF_MAX_AGE_SECONDS = 30;

const internalProofVersion = "v1";
const internalProofContext = "us-stock-radar:prelaunch-internal-access:v1";
const allowedTargets = new Set([
  "GET /api/dashboard-v2/movers",
  "GET /api/market/chart",
  "GET /api/market/sector-performance",
  "GET /api/market/theme-performance",
]);

type ProofInput = {
  method?: string;
  nonce?: string;
  now?: number;
  requestUrl: string | URL;
  secret: string;
};

type ConsumeNonce = (input: {
  expiresAt: number;
  nonceDigest: string;
  scopeDigest: string;
}) => Promise<boolean>;

export function createPrelaunchInternalProof({
  method = "GET",
  nonce = randomBytes(18).toString("base64url"),
  now = Date.now(),
  requestUrl,
  secret,
}: ProofInput) {
  if (!secret) throw new Error("CRON_SECRET is required");
  if (!/^[A-Za-z0-9_-]{24}$/.test(nonce)) {
    throw new Error("A 144-bit base64url nonce is required");
  }

  const url = new URL(requestUrl);
  const normalizedMethod = method.toUpperCase();
  if (!isPrelaunchInternalTarget(normalizedMethod, url.pathname)) {
    throw new Error("The request is not an allowed prelaunch internal target");
  }

  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + PRELAUNCH_INTERNAL_PROOF_MAX_AGE_SECONDS;
  const scope = buildInternalScope(normalizedMethod, url);
  const signature = signInternalProof({
    expiresAt,
    issuedAt,
    nonce,
    scope,
    secret,
  });
  return `${internalProofVersion}.${issuedAt}.${expiresAt}.${nonce}.${signature}`;
}

export function prelaunchInternalRequestHeaders(
  requestUrl: string | URL,
  method = "GET",
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  if (!isPrelaunchMode(env)) return {};
  const secret = env.CRON_SECRET || "";
  if (!secret) return {};
  return {
    [PRELAUNCH_INTERNAL_PROOF_HEADER]: createPrelaunchInternalProof({
      method,
      requestUrl,
      secret,
    }),
  };
}

export async function authorizePrelaunchInternalRequest(
  request: Request,
  options: {
    consumeNonce?: ConsumeNonce;
    now?: number;
    secret?: string;
  } = {},
) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (!isPrelaunchInternalTarget(method, url.pathname)) return false;

  const secret = options.secret ?? process.env.CRON_SECRET ?? "";
  const proof = request.headers.get(PRELAUNCH_INTERNAL_PROOF_HEADER) || "";
  const verified = verifyPrelaunchInternalProof({
    candidateProof: proof,
    method,
    now: options.now,
    requestUrl: url,
    secret,
  });
  if (!verified) return false;

  const consumeNonce = options.consumeNonce ?? consumePrelaunchInternalNonce;
  return consumeNonce({
    expiresAt: verified.expiresAt,
    nonceDigest: createHash("sha256").update(verified.nonce).digest("hex"),
    scopeDigest: createHash("sha256").update(verified.scope).digest("hex"),
  });
}

export function isPrelaunchInternalTarget(method: string, pathname: string) {
  return allowedTargets.has(`${method.toUpperCase()} ${pathname}`);
}

function verifyPrelaunchInternalProof({
  candidateProof,
  method,
  now = Date.now(),
  requestUrl,
  secret,
}: {
  candidateProof: string;
  method: string;
  now?: number;
  requestUrl: string | URL;
  secret: string;
}) {
  if (!candidateProof || !secret) return null;
  const match = candidateProof.match(
    /^v1\.(\d{10})\.(\d{10})\.([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{43})$/,
  );
  if (!match) return null;

  const issuedAt = Number(match[1]);
  const expiresAt = Number(match[2]);
  const nonce = match[3];
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt > nowSeconds + 5 ||
    expiresAt <= nowSeconds ||
    expiresAt - issuedAt !== PRELAUNCH_INTERNAL_PROOF_MAX_AGE_SECONDS
  ) {
    return null;
  }

  const scope = buildInternalScope(method, new URL(requestUrl));
  const expectedSignature = signInternalProof({
    expiresAt,
    issuedAt,
    nonce,
    scope,
    secret,
  });
  if (!timingSafeStringEqual(match[4], expectedSignature)) return null;
  return { expiresAt, nonce, scope };
}

function buildInternalScope(method: string, url: URL) {
  return `${method.toUpperCase()}\n${url.origin}\n${url.pathname}${url.search}`;
}

function signInternalProof(input: {
  expiresAt: number;
  issuedAt: number;
  nonce: string;
  scope: string;
  secret: string;
}) {
  return createHmac("sha256", input.secret)
    .update(
      `${internalProofContext}\n${input.issuedAt}\n${input.expiresAt}\n${input.nonce}\n${input.scope}`,
    )
    .digest("base64url");
}

function timingSafeStringEqual(candidate: string, expected: string) {
  const candidateDigest = createHash("sha256").update(candidate).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateDigest, expectedDigest);
}
