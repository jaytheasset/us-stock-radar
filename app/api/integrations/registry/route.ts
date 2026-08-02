import type { NextRequest } from "next/server";
import {
  respondToAdminReadHead,
  respondWithAdminReadAccess,
} from "@/lib/admin/api";
import { getIntegrationRegistry } from "@/lib/integrationRegistry";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return respondWithAdminReadAccess(request, "system.read", () =>
    getIntegrationRegistry(),
  );
}

export async function HEAD(request: NextRequest) {
  return respondToAdminReadHead(request, "system.read");
}
