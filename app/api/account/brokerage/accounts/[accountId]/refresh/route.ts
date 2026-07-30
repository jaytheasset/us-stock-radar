import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import {
  BROKERAGE_PRIVATE_HEADERS,
  brokerageErrorResponse,
} from "@/lib/brokerage/apiResponse";
import {
  BrokeragePolicyError,
  refreshBrokerageAccount,
} from "@/lib/brokerage/serverRepository";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    assertSameOriginAuthRequest(request);
    const userId = await getOptionalCurrentUserId();
    if (!userId) {
      throw new BrokeragePolicyError(
        "BROKERAGE_LOGIN_REQUIRED",
        "Sign in to refresh brokerage data.",
        401,
      );
    }
    const { accountId } = await context.params;
    return NextResponse.json(
      { ok: true, data: await refreshBrokerageAccount(userId, accountId) },
      { headers: BROKERAGE_PRIVATE_HEADERS },
    );
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}
