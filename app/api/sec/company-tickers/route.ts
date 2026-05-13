import { NextRequest, NextResponse } from "next/server";
import { fetchSecCompanyTickers } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") || "";
  const result = await fetchSecCompanyTickers(query);

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
