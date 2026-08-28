import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import {
  DilutionRegistryApplyError,
  runAuthorizedDilutionRegistryApply,
} from "@/lib/dilution-registry/applyContract";
import { applyDilutionRegistrySourceOnServer } from "@/lib/dilution-registry/applyServer";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null =
    null;

  try {
    assertSameOriginAuthRequest(request);
    const authorized = await runAuthorizedDilutionRegistryApply({
      authorize: async (permission) => {
        resolution = await resolveAdminApiAccess(request, permission);
        return resolution;
      },
      apply: async () =>
        applyDilutionRegistrySourceOnServer(await request.text()),
    });
    const response = NextResponse.json(
      { ok: true, status: authorized.result.status },
      { headers: HEADERS },
    );
    applyAdminAuthCookies(response, authorized.access);
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
