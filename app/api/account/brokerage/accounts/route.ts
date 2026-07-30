import { NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import {
  BROKERAGE_PRIVATE_HEADERS,
  brokerageErrorResponse,
} from "@/lib/brokerage/apiResponse";
import {
  BrokeragePolicyError,
  listBrokerageAccounts,
} from "@/lib/brokerage/serverRepository";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await getOptionalCurrentUserId();
    if (!userId) {
      throw new BrokeragePolicyError(
        "BROKERAGE_LOGIN_REQUIRED",
        "Sign in to view brokerage accounts.",
        401,
      );
    }
    return NextResponse.json(
      { ok: true, data: await listBrokerageAccounts(userId) },
      { headers: BROKERAGE_PRIVATE_HEADERS },
    );
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}
