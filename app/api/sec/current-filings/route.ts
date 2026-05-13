import { NextRequest, NextResponse } from "next/server";
import { fetchSecCurrentFilings } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const form = request.nextUrl.searchParams.get("form") || "8-K";
  const count = Number(request.nextUrl.searchParams.get("count") || 10);
  const result = await fetchSecCurrentFilings(form, count);

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
