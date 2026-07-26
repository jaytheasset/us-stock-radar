import { NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { ADVANCED_TRIAL_POLICY } from "@/lib/subscriptionPolicy";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

/**
 * Trial activation must happen only after a successful card-backed checkout.
 * This endpoint deliberately performs no database write until the payment
 * integration can provide a verified checkout session.
 */
export async function POST() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      {
        ok: false,
        guestMode: true,
        error: "ACCOUNT_REQUIRED",
        message: "Create an account or log in before starting an Advanced trial checkout.",
      },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: "CHECKOUT_REQUIRED",
      message: "A card-backed checkout is required. Advanced trial checkout is not connected yet.",
      trialPolicy: ADVANCED_TRIAL_POLICY,
    },
    { status: 503, headers: NO_STORE_HEADERS },
  );
}
