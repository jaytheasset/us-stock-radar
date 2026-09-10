import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  DilutionRegistryApplyError,
} from "@/lib/dilution-registry/applyContract";
import { applyDilutionRegistryAndHumanVerifiedOsOnServer } from "@/lib/dilution-registry/applyServer";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;

  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "data.run");
    const approverUserId = resolution.auth.user?.id;
    if (!approverUserId) {
      throw Object.assign(new Error("ADMIN_AUTH_REQUIRED"), { status: 401 });
    }
    const result = await applyDilutionRegistryAndHumanVerifiedOsOnServer({
      source: await request.text(),
      approverUserId,
    });
    const response = NextResponse.json(
      {
        ok:
          result.registry.status !== "failed" &&
          result.sharesOutstanding.status !== "failed" &&
          result.offeringMonitorAlerts.status !== "failed",
        ...result,
      },
      { headers: HEADERS },
    );
    applyAdminAuthCookies(response, resolution);
    return response;
  } catch (error) {
    const status =
      error instanceof DilutionRegistryApplyError
        ? error.kind === "invalid_source"
          ? 400
          : 503
        : readAdminErrorStatus(error);
    const response = NextResponse.json(
      { ok: false },
      { status, headers: HEADERS },
    );
    if (resolution) applyAdminAuthCookies(response, resolution);
    return response;
  }
}

function readAdminErrorStatus(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    Number.isInteger((error as { status?: unknown }).status)
  ) {
    return Number((error as { status: number }).status);
  }
  return 503;
}
