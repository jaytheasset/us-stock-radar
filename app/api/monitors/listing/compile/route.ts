import { NextRequest } from "next/server";
import { getOptionalCurrentUserIdReadOnly } from "@/lib/currentUser";
import { compileNaturalLanguageListingConditions } from "@/lib/monitor/naturalLanguageConditionCompiler";
import { handleListingConditionCompilerPost } from "./handler";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  return handleListingConditionCompilerPost(request, {
    resolveUserId: getOptionalCurrentUserIdReadOnly,
    compile: compileNaturalLanguageListingConditions,
  });
}
