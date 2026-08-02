import type { NextRequest } from "next/server";
import {
  respondToAdminReadHead,
  respondWithAdminReadAccess,
} from "@/lib/admin/api";
import { getSourceJobRegistry } from "@/lib/sourceJobs";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return respondWithAdminReadAccess(request, "data.read", () => ({
    ok: true,
    sources: getSourceJobRegistry(),
  }));
}

export async function HEAD(request: NextRequest) {
  return respondToAdminReadHead(request, "data.read");
}
