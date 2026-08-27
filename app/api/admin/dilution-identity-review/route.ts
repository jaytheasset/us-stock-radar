import { NextRequest } from "next/server";
import { AdminApiError, respondWithAdminReadAccess } from "@/lib/admin/api";
import {
  DilutionIdentityReviewError,
  getDilutionIdentityReviewPacket,
  listDilutionIdentityReviewCases,
} from "@/lib/dilution/dilutionIdentityReviewExchange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return respondWithAdminReadAccess(request, "data.read", async () => {
    try {
      const observationKey = request.nextUrl.searchParams.get("observationKey");
      if (observationKey) {
        const packet = await getDilutionIdentityReviewPacket({ observationKey });
        return { ok: true, packet };
      }
      const cases = await listDilutionIdentityReviewCases();
      return { ok: true, cases };
    } catch (error) {
      throw asAdminError(error);
    }
  });
}

function asAdminError(error: unknown) {
  return error instanceof DilutionIdentityReviewError
    ? new AdminApiError(error.code, error.message, error.status)
    : error;
}
