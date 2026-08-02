import { NextResponse } from "next/server";
import { rejectCrossOriginMutationRequest } from "@/lib/auth/mutationOrigin";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

/**
 * Compatibility endpoint for clients that still reference the retired Pro
 * trial. Existing Pro trial rows are read by effectivePlan.ts until they end,
 * but no new Pro trial may be created.
 */
export async function POST(request: Request) {
  const originRejection = rejectCrossOriginMutationRequest(request, NO_STORE_HEADERS);
  if (originRejection) return originRejection;
  return NextResponse.json(
    {
      ok: false,
      error: "PRO_TRIAL_RETIRED",
      message: "The Pro trial has been retired. The current offer is a card-backed 14-day Advanced trial.",
    },
    { status: 410, headers: NO_STORE_HEADERS },
  );
}
