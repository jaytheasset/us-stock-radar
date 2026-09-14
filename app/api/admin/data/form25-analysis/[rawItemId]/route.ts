import {randomUUID} from "node:crypto";
import {NextRequest,NextResponse} from "next/server";
import {applyAdminAuthCookies,normalizeAdminError,resolveAdminApiAccess} from "@/lib/admin/api";
import {assertSameOriginAuthRequest} from "@/lib/auth/authRequest";
import {applyForm25AnalysisDecision,retryForm25Analysis,readEffectiveForm25AnalysisReview} from "@/lib/sec-form25-analysis-review/persistence";
import {AdminApiError} from "@/lib/admin/errors";
export const dynamic="force-dynamic";
export async function POST(request:NextRequest,context:{params:Promise<{rawItemId:string}>}){
 let access:Awaited<ReturnType<typeof resolveAdminApiAccess>>|null=null;
 try{assertSameOriginAuthRequest(request);access=await resolveAdminApiAccess(request,"data.run");const {rawItemId}=await context.params,body=await request.json();const input={rawItemId,actorUserId:access.access.userId,reason:String(body.reason||""),expectedVersion:String(body.expectedVersion||""),expectedRevision:Number(body.expectedRevision),requestId:request.headers.get("x-request-id")?.slice(0,220)||randomUUID()};
 if(!["retry","corrected","unavailable","awaiting_filing","withdrawn","retry_cancelled"].includes(body.action))throw new AdminApiError("INVALID_ANALYSIS_ACTION","Unsupported administrator action.",400);
 if(body.action==="retry")await retryForm25Analysis(input);else await applyForm25AnalysisDecision({...input,action:String(body.action),corrections:body.corrections});
 const response=NextResponse.json({ok:true,data:await readEffectiveForm25AnalysisReview({rawItemId})},{headers:{"Cache-Control":"private, no-store"}});applyAdminAuthCookies(response,access);return response;
 }catch(error){const normalized=normalizeAdminError(error);const response=NextResponse.json({ok:false,error:normalized},{status:normalized.status});if(access)applyAdminAuthCookies(response,access);return response;}
}
