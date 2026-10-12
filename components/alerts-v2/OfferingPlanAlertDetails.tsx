'use client';
import {useState} from 'react';
import type {publicOfferingPlanEvidence} from '@/lib/monitor/offeringPlanFacts';
import {formatListingMonitorConditionPreview} from '@/lib/monitor/listingMonitorDraftReview';
type Evidence=NonNullable<ReturnType<typeof publicOfferingPlanEvidence>>;
export function OfferingPlanAlertDetails({id,evidence:e}:{id:string;evidence:Evidence}){
 const [validity,setValidity]=useState(''),[loading,setLoading]=useState(false);
 async function load(){if(loading)return;setLoading(true);try{
  const response=await fetch(`/api/monitors/listing/alerts/${encodeURIComponent(id)}`,{cache:'no-store'});
  if(!response.ok)throw Error();const body=await response.json();
  if(body.data?.kind!=='offering_plan_match_v1')throw Error();
  setValidity(body.data.currentValidity==='current'?'The recorded source and review selection are still current.':'The current source or review selection is unavailable or has changed. The recorded match remains historical evidence.');
 }catch{setValidity('Current validity could not be checked. The recorded match remains historical evidence.');}finally{setLoading(false);}}
 return <div style={{minWidth:0,width:'100%',overflowWrap:'anywhere'}}>
  <strong>Stated offering plan matched</strong><p>{e.component.quantity} {e.component.unit} · {e.component.label}</p>
  <p>Offering plan disclosure only. This is not confirmation of a completed sale or issuance.</p>
  <details onToggle={event=>{if(event.currentTarget.open)void load();}}>
   <summary>View matched component and SEC evidence</summary>
   <p>{e.component.seller.replaceAll('_',' ')} · {e.component.security.replaceAll('_',' ')}</p>
   <p>One directly stated component; conditional and unclear scenarios excluded.</p>
   {e.component.scenario&&<p>Stated context: {e.component.scenario}</p>}
   <p>Filing {e.accession} · {e.filedAt}</p><p>Recorded source run: {e.runId}</p>
   <p>Evidence recorded at the time of matching. Later condition or review changes do not rewrite this record.</p>
   {loading?<p role="status">Checking source…</p>:<p role="status">{validity}</p>}
   <ul>{e.conditions.map(c=><li key={c.key}>{formatListingMonitorConditionPreview(c).text}</li>)}</ul>
   {e.component.references.map(r=><p key={r.blockId}><a href={r.url} target="_blank" rel="noreferrer">SEC evidence · lines {r.lineStart}–{r.lineEnd}</a></p>)}
  </details>
 </div>;
}
