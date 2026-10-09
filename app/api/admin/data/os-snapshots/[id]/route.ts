import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_PRIVATE_RESPONSE_HEADERS, applyAdminAuthCookies, normalizeAdminError, resolveAdminApiAccess, AdminApiError } from '@/lib/admin/api';
import { assertSameOriginAuthRequest } from '@/lib/auth/authRequest';
import { repository, rpc } from '@/lib/sec-os-snapshot/repository';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest,context:{params:Promise<{id:string}>}) {
  let access:Awaited<ReturnType<typeof resolveAdminApiAccess>>|null=null;
  try {
    assertSameOriginAuthRequest(request);access=await resolveAdminApiAccess(request,'data.run');
    const {id}=await context.params,body=await request.json(),requestId=request.headers.get('x-request-id');
    if(!/^[0-9a-f-]{36}$/i.test(id)||!requestId||!/^[0-9a-f-]{36}$/i.test(requestId)||!['approve','hold','reject','retry'].includes(body.action)||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>2000||!Array.isArray(body.candidateIndexes)) throw new AdminApiError('INVALID_INPUT','Invalid decision.',400);
    const result=await rpc(await repository(),'decide_sec_os_snapshot',{p_id:id,p_actor:access.access.userId,p_action:body.action,p_indexes:body.candidateIndexes,p_reason:body.reason,p_request:requestId});
    if(body.action==='approve')await (await import('@/lib/projected-offering-dilution/repository')).refreshProjectedForRun(id);
    const response=NextResponse.json({ok:true,result},{headers:ADMIN_PRIVATE_RESPONSE_HEADERS});applyAdminAuthCookies(response,access);return response;
  } catch(e) {const error=normalizeAdminError(e);const response=NextResponse.json({ok:false,error},{status:error.status,headers:ADMIN_PRIVATE_RESPONSE_HEADERS});if(access)applyAdminAuthCookies(response,access);return response;}
}
