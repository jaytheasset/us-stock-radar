import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { BROKERAGE_PRIVATE_HEADERS, brokerageErrorResponse } from "@/lib/brokerage/apiResponse";
import { BrokeragePolicyError, createBrokeragePortal } from "@/lib/brokerage/serverRepository";

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const userId = await getOptionalCurrentUserId();
    if (!userId) throw new BrokeragePolicyError("BROKERAGE_LOGIN_REQUIRED", "Sign in to connect a brokerage.", 401);
    const origin = new URL(
      request.headers.get("origin") || request.nextUrl.origin,
    ).origin;
    const data = await createBrokeragePortal(userId, origin);
    return NextResponse.json({ ok: true, data }, { headers: BROKERAGE_PRIVATE_HEADERS });
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}
