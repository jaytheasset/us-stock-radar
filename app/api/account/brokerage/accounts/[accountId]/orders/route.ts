import { NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import {
  BROKERAGE_PRIVATE_HEADERS,
  brokerageErrorResponse,
} from "@/lib/brokerage/apiResponse";
import {
  BrokeragePolicyError,
  getBrokerageAccountOrders,
} from "@/lib/brokerage/serverRepository";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  try {
    const userId = await getOptionalCurrentUserId();
    if (!userId) {
      throw new BrokeragePolicyError(
        "BROKERAGE_LOGIN_REQUIRED",
        "Sign in to view brokerage orders.",
        401,
      );
    }
    const { accountId } = await context.params;
    return NextResponse.json(
      { ok: true, data: await getBrokerageAccountOrders(userId, accountId) },
      { headers: BROKERAGE_PRIVATE_HEADERS },
    );
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}
