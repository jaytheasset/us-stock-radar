import { NextRequest } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { AdminApiError, respondWithAdminReadAccess } from "@/lib/admin/api";
import {
  DilutionIdentityReviewError,
  validateCurrentDilutionIdentityReviewDecision,
} from "@/lib/dilution/dilutionIdentityReviewExchange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return respondWithAdminReadAccess(request, "data.read", async () => {
    assertSameOriginAuthRequest(request);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    try {
      const result = await validateCurrentDilutionIdentityReviewDecision({
        observationKey: typeof body?.observationKey === "string" ? body.observationKey : "",
        pastedDecision: typeof body?.pastedDecision === "string" ? body.pastedDecision : "",
      });
      return { ok: result.validation.ok, validation: result.validation };
    } catch (error) {
      throw asAdminError(error);
    }
  }, { status: (data) => data.ok ? 200 : 400 });
}

function asAdminError(error: unknown) {
  return error instanceof DilutionIdentityReviewError
    ? new AdminApiError(error.code, error.message, error.status)
    : error;
}
