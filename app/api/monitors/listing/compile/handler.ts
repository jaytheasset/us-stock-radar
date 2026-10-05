import { NextResponse } from "next/server.js";
import { rejectCrossOriginMutationRequest } from "../../../../../lib/auth/mutationOrigin.ts";
import {
  compileNaturalLanguageListingConditions,
  NaturalLanguageConditionCompilerError,
  parseNaturalLanguageConditionCompilerRequest,
} from "../../../../../lib/monitor/naturalLanguageConditionCompiler.ts";
import { buildNaturalLanguageMonitorDraft } from "../../../../../lib/monitor/naturalLanguageMonitorDraft.ts";
import { resolveEffectDraft } from "../../../../../lib/sec-effect/draft.ts";
import {
  MONITOR_API_NO_STORE_HEADERS,
  monitorAuthRequiredResponse,
} from "../shared.ts";

export type ListingConditionCompilerApiDependencies = Readonly<{
  resolveUserId: () => Promise<string | null>;
  compile: typeof compileNaturalLanguageListingConditions;
}>;

export async function handleListingConditionCompilerPost(
  request: Request,
  dependencies: ListingConditionCompilerApiDependencies,
) {
  const originRejection = rejectCrossOriginMutationRequest(request, MONITOR_API_NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  const userId = await dependencies.resolveUserId();
  if (!userId) return monitorAuthRequiredResponse();
  const body = await request.json().catch(() => undefined);
  if (body === undefined) {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Request body must be valid JSON." },
      { status: 400, headers: MONITOR_API_NO_STORE_HEADERS },
    );
  }
  const parsed = parseNaturalLanguageConditionCompilerRequest(body);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, error: parsed.code, message: parsed.message, errors: parsed.errors },
      { status: parsed.status, headers: MONITOR_API_NO_STORE_HEADERS },
    );
  }

  try {
    const run = await dependencies.compile({ text: parsed.text });
    const draft = await resolveEffectDraft(buildNaturalLanguageMonitorDraft(run.result, parsed.text));
    return NextResponse.json(
      { ok: true, data: draft },
      { headers: MONITOR_API_NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof NaturalLanguageConditionCompilerError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status, headers: MONITOR_API_NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { ok: false, error: "CONDITION_COMPILER_FAILED", message: "Condition Compiler request failed." },
      { status: 500, headers: MONITOR_API_NO_STORE_HEADERS },
    );
  }
}
