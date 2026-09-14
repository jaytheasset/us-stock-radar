"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./AdminSection.module.css";
import type { Form25EffectiveIdentity } from "@/lib/sec-form25-identity/persistence";
import { activeForm25IdentityDecision } from "@/lib/sec-form25-identity/forcedOverride";

export function Form25IdentityReview({identity,canWrite}:{identity:Extract<Form25EffectiveIdentity,{status:"available"}>;canWrite:boolean}) {
  const router=useRouter();const [reason,setReason]=useState("");const [candidate,setCandidate]=useState("0");
  const [accession,setAccession]=useState("");const [typedTicker,setTypedTicker]=useState("");const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const [retry,setRetry]=useState<{key:string;id:string}|null>(null);
  const [overrideTicker,setOverrideTicker]=useState("");const [overrideReason,setOverrideReason]=useState("");const [overrideReference,setOverrideReference]=useState("");
  const activeDecision=activeForm25IdentityDecision(identity.history);const forcedActive=activeDecision?.action==="forced_approved";
  async function submit(action:string) {
    const forced=action.startsWith("forced_");
    const body={action,candidateIndex:Number(candidate),reason:forced?overrideReason:reason,expectedEvidenceSha256:identity.evidenceSha256,expectedRevision:identity.revision,historicalAccessionNumber:accession,ticker:forced?overrideTicker:typedTicker,reference:forced?overrideReference:undefined};
    const key=JSON.stringify(body);const requestId=retry?.key===key?retry.id:crypto.randomUUID();setRetry({key,id:requestId});setBusy(true);setError("");
    try {const response=await fetch(`/api/admin/data/form25-identity/${identity.rawItemId}`,{method:"POST",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Request-Id":requestId},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok)throw new Error(data.error?.message||"Review failed");setRetry(null);setReason("");setOverrideReason("");router.refresh();
    } catch(e){setError(e instanceof Error?e.message:"Review failed");}finally{setBusy(false);}
  }
  const candidateHelpId=`form25-candidate-help-${identity.rawItemId}`;
  const approve=identity.evidence.status==="AUTO"||identity.evidence.mode==="historical_replay";
  return <section className={styles.stack} style={{minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}}>
    <h3>Human identity review</h3>
    <p>Identity decisions do not change the original filing or its AI analysis. Historical evidence requires explicit review.</p>
    {canWrite?<>
      <section className={styles.card} style={{minWidth:0,maxWidth:"100%"}}>
        <h4>Administrator ticker override</h4>
        <p>Automatic result: {identity.evidence.status} · Automatic ticker: {identity.evidence.status==="AUTO"&&identity.evidence.candidates.length===1?identity.evidence.candidates[0].ticker:"Unavailable"} · Effective ticker: {identity.ticker||"Unavailable"}{identity.reason==="forced_manual_override"?" (administrator override)":""}</p>
        <p>Use your judgment when automatic identification is unavailable. Parser confirmation is not required. Known issuer or security conflicts are blocked; the original filing and analysis stay unchanged.</p>
        <label className={styles.field}>Override ticker<input className={styles.input} style={{minWidth:0,maxWidth:"100%"}} value={overrideTicker} onChange={e=>setOverrideTicker(e.target.value.toUpperCase())} maxLength={10}/></label>
        <label className={styles.field}>Override reason (required, at least 4 characters)<textarea className={styles.input} style={{minWidth:0,maxWidth:"100%"}} value={overrideReason} onChange={e=>setOverrideReason(e.target.value)} maxLength={2000}/></label>
        <label className={styles.field}>SEC accession or URL (optional audit reference)<input className={styles.input} style={{minWidth:0,maxWidth:"100%"}} value={overrideReference} onChange={e=>setOverrideReference(e.target.value)} maxLength={2000}/></label>
        <div className={styles.actions} style={{flexWrap:"wrap",minWidth:0}}>
          <button className={styles.button} disabled={busy||overrideReason.trim().length<4||!/^[A-Z][A-Z0-9.-]{0,9}$/.test(overrideTicker.trim())} onClick={()=>submit("forced_approved")}>Approve administrator override</button>
          <button className={styles.button} disabled={busy||!forcedActive||overrideReason.trim().length<4} onClick={()=>submit("forced_withdrawn")}>Withdraw administrator override</button>
        </div>
        <p>Withdrawal restores the previous still-valid decision. Enter a reason above for either action.</p>
      </section>
      <details><summary>Verified candidate workflow</summary>
      <label className={styles.field} style={{minWidth:0,maxWidth:"100%"}}>Retained SEC candidate<select className={styles.select} style={{minWidth:0,width:"100%",maxWidth:"100%"}} value={candidate} onChange={e=>setCandidate(e.target.value)}>
        {identity.evidence.candidates.map((row,i)=><option key={`${row.ticker}-${i}`} value={i}>{row.ticker} · {row.exchange||"Exchange unavailable"} · {row.security||"Current SEC catalog"}</option>)}
      </select></label>
      <label className={styles.field} style={{minWidth:0,maxWidth:"100%"}}>Decision reason (required, at least 4 characters)<textarea className={styles.input} style={{minWidth:0,width:"100%",maxWidth:"100%"}} value={reason} onChange={e=>setReason(e.target.value)} maxLength={2000}/></label>
      <div className={styles.actions} style={{flexWrap:"wrap",minWidth:0}}>
        <button className={styles.button} disabled={busy||!approve||!identity.evidence.candidates.length||reason.trim().length<4} onClick={()=>submit("approved")}>Approve candidate</button>
        <button className={styles.button} disabled={busy||reason.trim().length<4} onClick={()=>submit("held")}>Hold identity</button>
        <button className={styles.button} disabled={busy||forcedActive||!identity.history.length||identity.history.at(-1)?.action==="withdrawn"||reason.trim().length<4} onClick={()=>submit("withdrawn")}>Withdraw decision</button>
      </div>
      {!approve?<p>Current issuer candidates alone do not identify the removed security. Add retained historical SEC evidence for review.</p>:null}
      <section className={styles.card} style={{minWidth:0,maxWidth:"100%"}}><h4>Add a source-backed candidate</h4><p>Enter a ticker found in retained official SEC evidence. It becomes a review candidate only; a separate approval is required.</p>
      <label className={styles.field}>Ticker from SEC source<input className={styles.input} value={typedTicker} onChange={e=>setTypedTicker(e.target.value.toUpperCase())} maxLength={10}/></label>
      <label className={styles.field}>Retained evidence accession<input className={styles.input} value={accession} onChange={e=>setAccession(e.target.value)} placeholder="0000000000-00-000000"/></label>
      <p id={candidateHelpId} aria-live="polite">{busy?"Verification is in progress.":reason.trim().length<4?"Enter a Decision reason above (at least 4 characters) to enable verification.":!typedTicker.trim()?"Enter the ticker shown in the retained SEC source.":!/^\d{10}-\d{2}-\d{6}$/.test(accession)?"Enter a retained SEC accession in 0000000000-00-000000 format.":"The required inputs are complete. Verification will check the retained SEC evidence."}</p>
      <button className={styles.button} aria-describedby={candidateHelpId} disabled={busy||reason.trim().length<4||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||!typedTicker.trim()} onClick={()=>submit("register_candidate")}>Verify and add candidate</button></section>
      <details><summary>Additional historical evidence</summary><label className={styles.field} style={{minWidth:0,maxWidth:"100%"}}>Historical SEC accession (already retained)<input className={styles.input} style={{minWidth:0,width:"100%",maxWidth:"100%"}} value={accession} onChange={e=>setAccession(e.target.value)} placeholder="0000000000-00-000000"/></label>
      <button className={styles.button} disabled={busy||!/^\d{10}-\d{2}-\d{6}$/.test(accession)} onClick={()=>submit("historical_evidence")}>Load historical evidence for review</button></details>
      </details>
    </>:<p>Read-only access.</p>}
    {error?<p className={styles.error} role="alert">{error}</p>:null}
    <details><summary>Decision and audit history</summary>
    {identity.history.length?identity.history.map(row=><article className={styles.card} style={{minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}} key={String(row.id)}><strong>#{String(row.revision)} {String(row.action)}</strong><p>{String(row.reason)}</p>{row.override_ticker?<p>Administrator ticker: {String(row.override_ticker)}</p>:null}{row.override_reference?<p>Audit reference: {String(row.override_reference)}</p>:null}<p>{String(row.actor_user_id)} · {String(row.created_at)}</p><small>Evidence {String(row.identity_id)} · Audit {String(row.audit_log_id)}</small></article>):<p>No human decisions.</p>}</details>
  </section>;
}
