import { NextRequest, NextResponse } from "next/server";
import { getOptionalCurrentUserIdReadOnly } from "@/lib/currentUser";
import {
  DILUTION_PRIVATE_RESPONSE_HEADERS,
  projectStockDilutionForPlan,
} from "@/lib/dilution-registry/stockDilutionMembership";
import { fetchStockDilution } from "@/lib/dilution-registry/stockDilutionServer";
import {
  comparePlanRank,
  getEffectiveUserPlan,
} from "@/lib/subscription/effectivePlan";
import { normalizeStockTicker } from "@/lib/watchlist/stockOverview";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const symbol = normalizeStockTicker(request.nextUrl.searchParams.get("symbol"));
  if (!symbol) {
    return dilutionJson(
      { error: "A valid stock symbol is required.", ok: false },
      400,
    );
  }

  try {
    const [snapshot, plan] = await Promise.all([
      fetchStockDilution(symbol),
      getCurrentDilutionPlan(),
    ]);
    const data = snapshot
      ? projectStockDilutionForPlan(snapshot, plan, comparePlanRank)
      : null;
    return dilutionJson(
      { data, ok: Boolean(data) },
      data ? 200 : 404,
    );
  } catch {
    return dilutionJson(
      { error: "Dilution data is temporarily unavailable.", ok: false },
      503,
    );
  }
}

async function getCurrentDilutionPlan() {
  const userId = await getOptionalCurrentUserIdReadOnly();
  return userId
    ? (await getEffectiveUserPlan(userId)).effectivePlan
    : "free";
}

function dilutionJson(body: unknown, status: number) {
  return NextResponse.json(body, {
    headers: DILUTION_PRIVATE_RESPONSE_HEADERS,
    status,
  });
}
