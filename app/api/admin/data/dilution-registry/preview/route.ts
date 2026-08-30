import { NextRequest, NextResponse } from "next/server";
import {
  applyAdminAuthCookies,
  resolveAdminApiAccess,
} from "@/lib/admin/api";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { validateDilutionRegistryOsPreview } from "@/lib/dilution-registry/osPreview";
import { readDilutionRegistryOsSourceBundle } from "@/lib/dilution-registry/osPreviewServer";
import { parseDilutionRegistryJson } from "@/lib/dilution-registry/preview";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  let resolution: Awaited<ReturnType<typeof resolveAdminApiAccess>> | null = null;
  try {
    assertSameOriginAuthRequest(request);
    resolution = await resolveAdminApiAccess(request, "data.read");
    const parsed = parseDilutionRegistryJson(await request.text());
    if (!parsed.ok) {
      const response = NextResponse.json(
        { ok: false, errors: parsed.errors },
        { status: 400, headers: HEADERS },
      );
      applyAdminAuthCookies(response, resolution);
      return response;
    }
    const rows = await validateDilutionRegistryOsPreview(parsed.payload, {
      readSourceBundle: readDilutionRegistryOsSourceBundle,
    });
    const response = NextResponse.json(
      { ok: true, rows },
      { headers: HEADERS },
    );
    applyAdminAuthCookies(response, resolution);
    return response;
  } catch (error) {
    const response = NextResponse.json(
      { ok: false },
      { status: readAdminErrorStatus(error), headers: HEADERS },
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
