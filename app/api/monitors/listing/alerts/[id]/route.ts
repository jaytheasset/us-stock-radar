import {readOfferingPlanAlertForOwner} from '@/lib/monitor/offeringPlanReader';
import {NextRequest,NextResponse} from 'next/server';
import {getOptionalCurrentUserId} from '@/lib/currentUser';
import {allowsProjectedDetailRead} from '@/lib/projected-offering-dilution/access';
import {readProjectedAlertForOwner} from '@/lib/projected-offering-dilution/history';
import {MONITOR_API_NO_STORE_HEADERS,monitorAuthRequiredResponse} from '../../shared';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
 if(!allowsProjectedDetailRead(request))return NextResponse.json({ok:false,message:'Invalid request origin.'},{status:403,headers:MONITOR_API_NO_STORE_HEADERS});
 const owner=await getOptionalCurrentUserId();if(!owner)return monitorAuthRequiredResponse();
 try{
  const id=(await params).id;
  const data=await readOfferingPlanAlertForOwner(owner,id) ?? await readProjectedAlertForOwner(owner,id);
  return NextResponse.json(data?{ok:true,data}:{ok:false,message:'Alert details unavailable.'},{status:data?200:404,headers:MONITOR_API_NO_STORE_HEADERS});
 }catch{return NextResponse.json({ok:false,message:'Alert details could not be read.'},{status:503,headers:MONITOR_API_NO_STORE_HEADERS});}
}
