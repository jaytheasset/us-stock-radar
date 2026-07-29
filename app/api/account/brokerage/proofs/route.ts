import { NextRequest, NextResponse } from "next/server";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { BROKERAGE_PRIVATE_HEADERS, brokerageErrorResponse } from "@/lib/brokerage/apiResponse";
import {
  BrokeragePolicyError,
  createBrokerageProof,
  listOwnBrokerageProofs,
} from "@/lib/brokerage/serverRepository";

async function requireUser() {
  const userId = await getOptionalCurrentUserId();
  if (!userId) throw new BrokeragePolicyError("BROKERAGE_LOGIN_REQUIRED", "Sign in to use brokerage proofs.", 401);
  return userId;
}

export async function GET() {
  try {
    const data = await listOwnBrokerageProofs(await requireUser());
    return NextResponse.json({ ok: true, data }, { headers: BROKERAGE_PRIVATE_HEADERS });
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOriginAuthRequest(request);
    const input = (await request.json().catch(() => null)) || {};
    const data = await createBrokerageProof(await requireUser(), input);
    return NextResponse.json({ ok: true, data }, { status: 201, headers: BROKERAGE_PRIVATE_HEADERS });
  } catch (error) {
    return brokerageErrorResponse(error);
  }
}
