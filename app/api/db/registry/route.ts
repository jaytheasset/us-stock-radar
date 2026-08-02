import type { NextRequest } from "next/server";
import {
  respondToAdminReadHead,
  respondWithAdminReadAccess,
} from "@/lib/admin/api";
import { getDbReadout } from "@/lib/dbReadout";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return respondWithAdminReadAccess(request, "data.read", () =>
    getDbReadout(),
  );
}

export async function HEAD(request: NextRequest) {
  return respondToAdminReadHead(request, "data.read");
}
