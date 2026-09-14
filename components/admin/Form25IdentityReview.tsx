"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./AdminSection.module.css";
import type { Form25EffectiveIdentity } from "@/lib/sec-form25-identity/persistence";

export function Form25IdentityReview({identity,canWrite}:{identity:Extract<Form25EffectiveIdentity,{status:"available"}>;canWrite:boolean}) {
  const router=useRouter();const [reason,setReason]=useState("");const [candidate,setCandidate]=useState("0");
  const [accession,setAccession]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const [retry,setRetry]=useState<{key:string;id:string}|null>(null);
  async function submit(action:string) {
    const body={action,candidateIndex:Number(candidate),reason,expectedEvidenceSha256:identity.evidenceSha256,expectedRevision:identity.revision,historicalAccessionNumber:accession};
    const key=JSON.stringify(body);const requestId=retry?.key===key?retry.id:crypto.randomUUID();setRetry({key,id:requestId});setBusy(true);setError("");
    try {const response=await fetch(`/api/admin/data/form25-identity/${identity.rawItemId}`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Request-Id":requestId},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(data.error?.message||"Review failed");setRetry(null);setReason("");router.refresh();
    } catch(e){setError(e instanceof Error?e.message:"Review failed");}finally{setBusy(false);}
  }
  const approve=identity.evidence.status==="AUTO"||identity.evidence.mode==="historical_replay";
  return <section className={styles.stack} style={{minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}}>
    <h3>Human identity review</h3>
    <p>Identity decisions do not change the original filing or its AI analysis. Historical evidence requires explicit review.</p>
    {canWrite?<>
      <label className={styles.field} style={{minWidth:0,maxWidth:"100%"}}>Retained SEC candidate<select className={styles.select} style={{minWidth:0,width:"100%",maxWidth:"100%"}} value={candidate} onChange={e=>setCandidate(e.target.value)}>
        {identity.evidence.candidates.map((row,i)=><option key={`${row.ticker}-${i}`} value={i}>{row.ticker} · {row.exchange||"Exchange unavailable"} · {row.security||"Current SEC catalog"}</option>)}
      </select></label>
      <label className={styles.field} style={{minWidth:0,maxWidth:"100%"}}>Decision reason<textarea className={styles.input} style={{minWidth:0,width:"100%",maxWidth:"100%"}} value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></label>
      <div className={styles.actions} style={{flexWrap:"wrap",minWidth:0}}>
        <button className={styles.button} disabled={busy||!approve||!identity.evidence.candidates.length||reason.trim().length<4} onClick={()=>submit("approved")}>Approve candidate</button>
        <button className={styles.button} disabled={busy||reason.trim().length<4} onClick={()=>submit("held")}>Hold identity</button>
        <button className={styles.button} disabled={busy||!identity.history.length||identity.history.at(-1)?.action==="withdrawn"||reason.trim().length<4} onClick={()=>submit("withdrawn")}>Withdraw decision</button>
      </div>
      {!approve?<p>Current issuer candidates alone do not identify the removed security. Add retained historical SEC evidence for review.</p>:null}
      <label className={styles.field} style={{minWidth:0,maxWidth:"100%"}}>Historical SEC accession (already retained)<input className={styles.input} style={{minWidth:0,width:"100%",maxWidth:"100%"}} value={accession} onChange={e=>setAccession(e.target.value)} placeholder="0000000000-00-000000"/></label>
      <button className={styles.button} disabled={busy||!/^\d{10}-\d{2}-\d{6}$/.test(accession)} onClick={()=>submit("historical_evidence")}>Load historical evidence for review</button>
    </>:<p>Read-only access.</p>}
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    <h3>Append-only decision history</h3>
    {identity.history.length?identity.history.map(row=><article className={styles.card} style={{minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}} key={String(row.id)}><strong>#{String(row.revision)} {String(row.action)}</strong><p>{String(row.reason)}</p><p>{String(row.actor_user_id)} · {String(row.created_at)}</p><small>Evidence {String(row.identity_id)} · Audit {String(row.audit_log_id)}</small></article>):<p>No human decisions.</p>}
  </section>;
}
