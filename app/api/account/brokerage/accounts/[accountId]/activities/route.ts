import { NextRequest, NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import {
  BROKERAGE_PRIVATE_HEADERS,
  brokerageErrorResponse,
} from "@/lib/brokerage/apiResponse";
import {
  BrokeragePolicyError,
  getBrokerageAccountActivities,
} from "@/lib/brokerage/serverRepository";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const userId = await getOptionalCurrentUserId();
    if (!userId) {
      throw new BrokeragePolicyError(
        "BROKERAGE_LOGIN_REQUIRED",
        "Sign in to view brokerage activities.",
        401,
      );
    }
    const { accountId } = await context.params;
    return NextResponse.json(
      {
        ok: true,
        data: await getBrokerageAccountActivities(userId, accountId, {
          limit: Number(request.nextUrl.searchParams.get("limit") || 50),
          offset: Number(request.nextUrl.searchParams.get("offset") || 0),
        }),
      },
      { headers: BROKERAGE_PRIVATE_HEADERS },
    );
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}
