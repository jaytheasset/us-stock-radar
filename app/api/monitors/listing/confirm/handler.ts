import { NextResponse } from "next/server.js";
import { confirmEffectDraft } from "../../../../../lib/sec-effect/draft.ts";
import { rejectCrossOriginMutationRequest } from "../../../../../lib/auth/mutationOrigin.ts";
import {
  applyNaturalLanguageMonitorConfirmation,
  NaturalLanguageMonitorConfirmationError,
  parseNaturalLanguageMonitorConfirmationRequest,
} from "../../../../../lib/monitor/naturalLanguageMonitorConfirmation.ts";
import {
  MONITOR_API_NO_STORE_HEADERS,
  monitorAuthRequiredResponse,
} from "../shared.ts";

export type ListingMonitorConfirmationApiDependencies = Readonly<{
  resolveUserId: () => Promise<string | null>;
}>;

export async function handleListingMonitorConfirmationPost(
  request: Request,
  dependencies: ListingMonitorConfirmationApiDependencies,
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
  try {
    if (body && typeof body === "object" && "registrationAccession" in body) {
      try {
        return NextResponse.json({ ok: true, data: await confirmEffectDraft(body) }, { headers: MONITOR_API_NO_STORE_HEADERS });
      } catch (error) {
        return NextResponse.json({ ok: false, error: "REGISTRATION_UNRESOLVED", message: error instanceof Error ? error.message : "Registration could not be verified." }, { status: 422, headers: MONITOR_API_NO_STORE_HEADERS });
      }
    }
    const parsed = parseNaturalLanguageMonitorConfirmationRequest(body);
    return NextResponse.json(
      { ok: true, data: applyNaturalLanguageMonitorConfirmation(parsed) },
      { headers: MONITOR_API_NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof NaturalLanguageMonitorConfirmationError) {
      return NextResponse.json(
        { ok: false, error: error.code, message: error.message },
        { status: error.status, headers: MONITOR_API_NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { ok: false, error: "MONITOR_CONFIRMATION_FAILED", message: "Monitor confirmation failed." },
      { status: 500, headers: MONITOR_API_NO_STORE_HEADERS },
    );
  }
}
