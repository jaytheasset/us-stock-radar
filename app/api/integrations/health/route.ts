import type { NextRequest } from "next/server";
import {
  respondToAdminReadHead,
  respondWithAdminReadAccess,
} from "@/lib/admin/api";
import { probeAllIntegrations } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return respondWithAdminReadAccess(request, "system.read", async () => {
    const integrations = await probeAllIntegrations();
    return {
      ok: integrations.every((integration) => integration.ok),
      integrations,
    };
  });
}

export async function HEAD(request: NextRequest) {
  return respondToAdminReadHead(request, "system.read");
}
