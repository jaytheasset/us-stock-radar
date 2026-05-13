import { NextResponse } from "next/server";
import { probeAllIntegrations } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET() {
  const integrations = await probeAllIntegrations();

  return NextResponse.json({
    ok: integrations.every((integration) => integration.ok),
    integrations,
  });
}
