import {NextRequest,NextResponse} from 'next/server';
import {resolveAdminApiAccess,applyAdminAuthCookies,ADMIN_PRIVATE_RESPONSE_HEADERS,normalizeAdminError} from '@/lib/admin/api';
import {assertSameOriginAuthRequest} from '@/lib/auth/authRequest';
import {OsCorrectionError,readOsCorrectionDetail,previewOsCorrection,saveOsCorrection} from '@/lib/dilution-registry/osCorrectionServer';
export const dynamic='force-dynamic';
type Context={params:Promise<{id:string}>};
async function handle(request:NextRequest,context:Context,write:boolean){
 let access:Awaited<ReturnType<typeof resolveAdminApiAccess>>|null=null;
 try{
  assertSameOriginAuthRequest(request);
  access=await resolveAdminApiAccess(request,write?'data.run':'data.read');
  const {id}=await context.params;
  let result;
  if(!write)result=await readOsCorrectionDetail(id);
  else{
   let input:unknown;
   try{input=await request.json();}catch{throw new OsCorrectionError(400,'A valid correction request is required.');}
   if(!input||typeof input!=='object'||Array.isArray(input))throw new OsCorrectionError(400,'A valid correction request is required.');
   const {mode,...draft}=input as Record<string,unknown>;
   if(mode!=='preview'&&mode!=='save')throw new OsCorrectionError(400,'Choose Preview or Save.');
   result=mode==='preview'?await previewOsCorrection(id,draft):await saveOsCorrection(id,draft,access.auth.user!.id);
  }
  const response=NextResponse.json({ok:true,result},{headers:ADMIN_PRIVATE_RESPONSE_HEADERS});applyAdminAuthCookies(response,access);return response;
 }catch(e){
  const error=e instanceof OsCorrectionError?{status:e.status,message:e.message}:normalizeAdminError(e);
  const response=NextResponse.json({ok:false,error:{message:error.message}},{status:error.status,headers:ADMIN_PRIVATE_RESPONSE_HEADERS});
  if(access)applyAdminAuthCookies(response,access);return response;
 }
}
export const GET=(r:NextRequest,c:Context)=>handle(r,c,false);
export const POST=(r:NextRequest,c:Context)=>handle(r,c,true);
