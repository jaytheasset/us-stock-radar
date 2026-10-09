'use client';
import {useState} from 'react';
import type {ImpactHistory} from '@/lib/projected-offering-dilution/history';
import {ProjectedOfferingImpact} from '@/components/monitor/ProjectedOfferingImpact';

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
  <strong>Projected O/S increase and dilution — based on offering plans</strong>
  <p>{scenario==='base'?'Base scenario':scenario==='combined'?'Base and full over-allotment scenarios':'Full over-allotment scenario'}</p>
  <p>Your saved conditions matched this recorded estimate.</p>
  <details onToggle={event=>{if(event.currentTarget.open)void load();}}>
   <summary>Estimate and source evidence</summary>
   {loading&&<p role="status">Loading recorded estimate…</p>}{error&&<p role="alert">{error}</p>}
   {detail&&<>
    {!detail.current&&<p>This historical estimate is no longer eligible for new matches. Its recorded values are preserved.</p>}
    {!detail.evidenceAvailable&&<p>The original evidence cannot currently be verified. No newer source has been substituted.</p>}
    <p>Recorded {new Date(detail.createdAt).toLocaleString('en-US')}</p>
    {detail.decisions.map(d=><p key={d.domain}>{d.domain==='os'?'O/S':'Offering'} input: {d.id?'administrator reviewed':'accepted without candidate selection'}{d.approvedAt?` on ${new Date(d.approvedAt).toLocaleString('en-US')}`:''}</p>)}
    <ProjectedOfferingImpact read={detail.read}/>
   </>}
  </details>
 </div>;
}
