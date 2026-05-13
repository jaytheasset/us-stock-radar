import { NextResponse } from "next/server";
import { getIntegrationRegistry } from "@/lib/integrationRegistry";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getIntegrationRegistry());
}
