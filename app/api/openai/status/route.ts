import type { NextRequest } from "next/server";
import {
  respondToAdminReadHead,
  respondWithAdminReadAccess,
} from "@/lib/admin/api";
import { probeOpenAI } from "@/lib/integrations";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return respondWithAdminReadAccess(
    request,
    "system.read",
    () => probeOpenAI(),
    { status: (result) => (result.ok ? 200 : result.status || 502) },
  );
}

export async function HEAD(request: NextRequest) {
  return respondToAdminReadHead(request, "system.read");
}
