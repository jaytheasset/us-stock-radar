import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import {
  BROKERAGE_PRIVATE_HEADERS,
  brokerageErrorResponse,
} from "@/lib/brokerage/apiResponse";
import {
  BrokeragePolicyError,
  acceptBrokerageTerms,
  deleteBrokerageData,
  disconnectBrokerage,
  getBrokerageConnectionStatus,
  syncBrokerageConnection,
} from "@/lib/brokerage/serverRepository";

export const dynamic = "force-dynamic";

async function requireUser() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) throw new BrokeragePolicyError("BROKERAGE_LOGIN_REQUIRED", "Sign in to manage brokerage connections.", 401);
  return userId;
}

export async function GET() {
  try {
    return NextResponse.json(
      { ok: true, data: await getBrokerageConnectionStatus(await requireUser()) },
      { headers: BROKERAGE_PRIVATE_HEADERS },
    );
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const input = (await request.json().catch(() => null)) as { action?: unknown } | null;
    const userId = await requireUser();
    const data =
      input?.action === "accept_terms"
        ? await acceptBrokerageTerms(userId)
        : input?.action === "sync"
          ? await syncBrokerageConnection(userId)
          : input?.action === "disconnect"
            ? await disconnectBrokerage(userId)
            : (() => {
                throw new BrokeragePolicyError("BROKERAGE_INVALID_ACTION", "Choose a valid brokerage action.");
              })();
    return NextResponse.json({ ok: true, data }, { headers: BROKERAGE_PRIVATE_HEADERS });
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const data = await deleteBrokerageData(await requireUser());
    return NextResponse.json({ ok: true, data }, { headers: BROKERAGE_PRIVATE_HEADERS });
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}
