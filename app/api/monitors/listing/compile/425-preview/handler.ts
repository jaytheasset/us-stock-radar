import { NextResponse } from "next/server.js";
import { rejectCrossOriginMutationRequest } from "../../../../../../lib/auth/mutationOrigin.ts";
import { parseNaturalLanguageConditionCompilerRequest, NaturalLanguageConditionCompilerError } from "../../../../../../lib/monitor/naturalLanguageConditionCompiler.ts";
import { compileSec425MonitorPreview } from "../../../../../../lib/monitor/sec425CandidatePreview.ts";
import { MONITOR_API_NO_STORE_HEADERS, monitorAuthRequiredResponse } from "../../shared.ts";

export async function handleSec425PreviewPost(request: Request, dependencies: {
  resolveUserId: () => Promise<string | null>;
  compile: typeof compileSec425MonitorPreview;
}) {
  const rejection = rejectCrossOriginMutationRequest(request, MONITOR_API_NO_STORE_HEADERS);
  if (rejection) return rejection;
  if (!await dependencies.resolveUserId()) return monitorAuthRequiredResponse();
  const parsed = parseNaturalLanguageConditionCompilerRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.code, message: parsed.message }, { status: parsed.status, headers: MONITOR_API_NO_STORE_HEADERS });
  try {
    const result = await dependencies.compile(parsed.text);
    return NextResponse.json({ ok: true, data: result.draft, preview: result.preview }, { headers: MONITOR_API_NO_STORE_HEADERS });
  } catch (error) {
    const status = error instanceof NaturalLanguageConditionCompilerError ? error.status : 500;
    return NextResponse.json({ ok: false, error: "SEC425_PREVIEW_UNAVAILABLE", message: "The 425 preview is unavailable. No monitor was created." }, { status, headers: MONITOR_API_NO_STORE_HEADERS });
  }
}
