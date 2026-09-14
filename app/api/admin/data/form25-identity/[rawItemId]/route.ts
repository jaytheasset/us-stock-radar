import { randomUUID } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { applyAdminAuthCookies,normalizeAdminError,resolveAdminApiAccess } from "@/lib/admin/api";
import { assertSameOriginAuthRequest } from "@/lib/auth/authRequest";
import { applySecForm25ForcedOverride,applySecForm25IdentityDecision,registerSecForm25IdentityCandidate,ensureSecForm25Identity,readEffectiveSecForm25Identity } from "@/lib/sec-form25-identity/persistence";
import { AdminApiError } from "@/lib/admin/errors";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest,context:{params:Promise<{rawItemId:string}>}) {
  let access:Awaited<ReturnType<typeof resolveAdminApiAccess>>|null=null;
  try {
    assertSameOriginAuthRequest(request);access=await resolveAdminApiAccess(request,"data.run");
    const {rawItemId}=await context.params;const body=await request.json();
    if(body.action==="forced_approved"||body.action==="forced_withdrawn") {
      await applySecForm25ForcedOverride({rawItemId,actorUserId:access.access.userId,action:body.action,ticker:body.ticker,reference:body.reference,reason:body.reason,expectedEvidenceSha256:body.expectedEvidenceSha256,expectedRevision:body.expectedRevision,requestId:request.headers.get("x-request-id")?.trim().slice(0,240)||randomUUID()});
    } else if(body.action==="register_candidate") {
      await registerSecForm25IdentityCandidate({rawItemId,actorUserId:access.access.userId,ticker:body.ticker,historicalAccessionNumber:body.historicalAccessionNumber,expectedEvidenceSha256:body.expectedEvidenceSha256,expectedRevision:body.expectedRevision,reason:body.reason,requestId:request.headers.get("x-request-id")?.trim().slice(0,240)||randomUUID()});
    } else if(body.action==="historical_evidence") {
      const current=await readEffectiveSecForm25Identity({rawItemId});
      if(current.status!=="available"||current.evidenceSha256!==body.expectedEvidenceSha256||current.revision!==body.expectedRevision)throw new AdminApiError("FORM25_IDENTITY_STALE","Refresh the identity evidence.",409);
      const loaded=await ensureSecForm25Identity({rawItemId,historicalAccessionNumber:String(body.historicalAccessionNumber||"")});
      if(loaded.status!=="available")throw new AdminApiError("FORM25_HISTORICAL_EVIDENCE_UNAVAILABLE","Verified historical SEC observations for this security are not available.",409);
    } else await applySecForm25IdentityDecision({rawItemId,actorUserId:access.access.userId,action:body.action,candidateIndex:body.candidateIndex,expectedEvidenceSha256:body.expectedEvidenceSha256,expectedRevision:body.expectedRevision,reason:body.reason,requestId:request.headers.get("x-request-id")?.trim().slice(0,240)||randomUUID()});
    const response=NextResponse.json({ok:true,data:await readEffectiveSecForm25Identity({rawItemId})},{headers:{"Cache-Control":"private, no-store"}});applyAdminAuthCookies(response,access);return response;
  } catch(error) {const normalized=normalizeAdminError(error);const response=NextResponse.json({ok:false,error:normalized},{status:normalized.status});if(access)applyAdminAuthCookies(response,access);return response;}
}
