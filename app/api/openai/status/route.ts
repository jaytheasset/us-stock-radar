import { NextResponse } from "next/server";
import { probeOpenAI } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await probeOpenAI();

  return NextResponse.json(result, {
    status: result.ok ? 200 : result.status || 502,
  });
}
