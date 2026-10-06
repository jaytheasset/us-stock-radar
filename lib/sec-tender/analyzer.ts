import { getServerEnv } from "../env.ts";
import { buildTenderStructuredRequest, parseTenderStructured, type TenderStructuredCanonical } from "./contract.ts";
import {
  TENDER_STRUCTURED_MODEL,
  type TenderProviderSource,
  type TenderStructuredSource,
} from "./source.ts";

type GeminiBody = {
  modelVersion?: string;
  candidates?: Array<{
    finishReason?: string;
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
  }>;
  usageMetadata?: Record<string, unknown>;
  error?: { message?: string };
};

export type TenderAnalyzerResult =
  | Readonly<{
      ok: true;
      request: ReturnType<typeof buildTenderStructuredRequest>;
      outputText: string;
      canonical: TenderStructuredCanonical;
      evidence: readonly unknown[];
      usage: Record<string, unknown> | null;
      modelVersion: string;
    }>
  | Readonly<{
      ok: false;
      request: ReturnType<typeof buildTenderStructuredRequest>;
      outputText: string;
      canonical: null;
      evidence: readonly unknown[];
      usage: Record<string, unknown> | null;
      modelVersion: string | null;
      error: string;
    }>;

export async function runTenderStructuredAnalyzer(
  source: TenderStructuredSource,
  providerSource: TenderProviderSource,
  options: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<TenderAnalyzerResult> {
  const apiKey = options.apiKey ?? getServerEnv().geminiApiKey;
  const request = buildTenderStructuredRequest(providerSource);
  if (!apiKey) return {
    ok: false,
    request,
    outputText: "",
    canonical: null,
    evidence: [],
    usage: null,
    modelVersion: null,
    error: "tender_structured_provider_unavailable",
  };

  let response: Response;
  let bodyText = "";
  try {
    response = await (options.fetchImpl ?? fetch)(
      `https://generativelanguage.googleapis.com/v1beta/models/${TENDER_STRUCTURED_MODEL}:generateContent`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(60_000),
      },
    );
    bodyText = await response.text();
  } catch (error) {
    return {
      ok: false,
      request,
      outputText: "",
      canonical: null,
      evidence: [],
      usage: null,
      modelVersion: null,
      error: error instanceof Error ? error.message : "tender_structured_transport_failed",
    };
  }

  let body: GeminiBody | null = null;
  try { body = JSON.parse(bodyText) as GeminiBody; } catch { body = null; }
  const candidate = body?.candidates?.length === 1 ? body.candidates[0] : null;
  const outputText = (candidate?.content?.parts ?? [])
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text!)
    .join("");
  const modelVersion = body?.modelVersion ?? null;
  const usage = body?.usageMetadata ?? null;
  if (
    !response.ok
    || !candidate
    || candidate.finishReason !== "STOP"
    || modelVersion !== TENDER_STRUCTURED_MODEL
  ) {
    return {
      ok: false,
      request,
      outputText,
      canonical: null,
      evidence: [],
      usage,
      modelVersion,
      error: body?.error?.message || `tender_structured_provider_invalid:${response.status}:${candidate?.finishReason ?? "none"}`,
    };
  }

  const parsed = parseTenderStructured(outputText, source, providerSource);
  if (!parsed.ok) {
    return {
      ok: false,
      request,
      outputText,
      canonical: null,
      evidence: [],
      usage,
      modelVersion,
      error: `tender_structured_validation:${parsed.errors.join(";")}`,
    };
  }
  return {
    ok: true,
    request,
    outputText,
    canonical: parsed.result.canonical,
    evidence: parsed.result.evidence,
    usage,
    modelVersion,
  };
}
