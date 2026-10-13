'use client';
import {useState} from 'react';
import type {ImpactHistory} from '@/lib/projected-offering-dilution/history';
import {ProjectedOfferingHistory} from '@/components/monitor/ProjectedOfferingImpact';

export function ProjectedAlertDetails({id,scenario}:{id:string;scenario:string}){
 const [detail,setDetail]=useState<ImpactHistory|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 async function load(){
  if(detail||loading)return;setLoading(true);setError('');
  try{
   const response=await fetch(`/api/monitors/listing/alerts/${encodeURIComponent(id)}`,{cache:'no-store'});
   if(!response.ok)throw Error('Details are unavailable.');const body=await response.json();setDetail(body.data);
  }catch{setError('Details could not be loaded. Close and reopen to try again.');}
  finally{setLoading(false);}
 }
 return <div style={{minWidth:0,width:'100%',overflowWrap:'anywhere'}}>
  <strong>Historical calculation alert</strong>
  <p>{scenario==='base'?'Base scenario':scenario==='combined'?'Base and full over-allotment scenarios':'Full over-allotment scenario'}</p>
  <p>Retired — not used for current calculations or new alerts.</p>
  <details onToggle={event=>{if(event.currentTarget.open)void load();}}>
   <summary>View historical values and evidence</summary>
   {loading&&<p role="status">Loading historical record…</p>}{error&&<p role="alert">{error}</p>}
   {detail&&<ProjectedOfferingHistory history={detail}/>}
  </details>
 </div>;
}
