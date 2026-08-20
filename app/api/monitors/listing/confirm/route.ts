import { NextRequest } from "next/server";
import { getOptionalCurrentUserIdReadOnly } from "@/lib/currentUser";
import { handleListingMonitorConfirmationPost } from "./handler";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleListingMonitorConfirmationPost(request, {
    resolveUserId: getOptionalCurrentUserIdReadOnly,
  });
}
