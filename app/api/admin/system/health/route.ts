import type { NextRequest } from "next/server";
import {
  respondToAdminReadHead,
  respondWithAdminReadAccess,
} from "@/lib/admin/api";
import { getDetailedSystemHealth } from "@/lib/admin/systemHealth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return respondWithAdminReadAccess(request, "system.read", () =>
    getDetailedSystemHealth(),
  );
}

export async function HEAD(request: NextRequest) {
  return respondToAdminReadHead(request, "system.read");
}
