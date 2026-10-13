"use client";
import {useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import type {readOsCorrectionDetail} from '@/lib/dilution-registry/osCorrectionServer';
import styles from './OsObservationCorrection.module.css';
type Detail=Awaited<ReturnType<typeof readOsCorrectionDetail>>;

export function OsObservationCorrection({detail,canWrite}:{detail:Detail;canWrite:boolean}){
 const router=useRouter(),[quantity,setQuantity]=useState(detail.correction?.quantity??detail.originalQuantity),
  [asOf,setAsOf]=useState(detail.correction?.asOf??detail.originalAsOf),[evidence,setEvidence]=useState(detail.correction?.evidence??detail.originalEvidence),
  [reason,setReason]=useState(''),[action,setAction]=useState<'correct'|'revoke'>('correct'),[busy,setBusy]=useState(false),
  [message,setMessage]=useState(''),[verified,setVerified]=useState<string|null>(null);
 const running=useRef(false),request=useRef<{signature:string;id:string}|null>(null);
 const values={action,quantity:action==='correct'?quantity:null,asOf:action==='correct'?asOf:null,evidence:action==='correct'?evidence:null,reason,
  expectedRevision:detail.revision,observationHash:detail.observationHash,sourceBindingHash:detail.sourceBindingHash};
 const signature=JSON.stringify(values),canRevoke=detail.history[0]?.action==='correct';
 const ready=canWrite&&Boolean(reason.trim())&&Boolean(detail.sourceBindingHash)&&
  (action==='revoke'?canRevoke:detail.sourceAvailable&&/^[1-9][0-9]{0,77}$/.test(quantity)&&Boolean(asOf)&&Boolean(evidence.trim()));
 async function submit(mode:'preview'|'save'){
  if(running.current||!ready||(mode==='save'&&verified!==signature))return;
  running.current=true;setBusy(true);setMessage('');
  if(request.current?.signature!==signature)request.current={signature,id:crypto.randomUUID()};
  let retrySameRequest=mode==='save';
  try{
   const response=await fetch(`/api/admin/data/dilution-registry/observations/${detail.id}`,{method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'content-type':'application/json'},body:JSON.stringify({mode,...values,requestId:request.current.id})});
   const body=await response.json();
   if(!response.ok){if(response.status<500)retrySameRequest=false;throw Error(body.error?.message??'The request could not be completed.');}
   if(mode==='preview'){setVerified(signature);setMessage(action==='correct'?'Verified against the retained SEC source. Ready to save.':'Withdrawal checked. Ready to save.');}
   else{setVerified(null);setMessage(body.result.deduped?'This request was already saved.':action==='correct'?'Correction saved. The original observation is preserved.':'Correction withdrawn. The complete history is preserved.');router.refresh();}
  }catch(e){if(!retrySameRequest)setVerified(null);setMessage(e instanceof Error?e.message:'The request could not be completed. Retry the same request.');}
  finally{running.current=false;setBusy(false);}
 }
 return <section className={styles.panel} aria-label="Saved O/S observation" aria-busy={busy}>
  <header><h2>Saved O/S observation #{detail.id}</h2><p>{detail.form} · {detail.accession}</p></header>
  <dl className={styles.facts}>
   <div><dt>Original shares outstanding</dt><dd>{detail.originalQuantity} shares</dd></div>
   <div><dt>Original as-of date</dt><dd>{detail.originalAsOf}</dd></div>
   <div><dt>Effective shares outstanding</dt><dd>{detail.observationEligible?`${detail.correction?.quantity??detail.originalQuantity} shares`:'Not currently eligible'}</dd></div>
   <div><dt>Effective as-of date</dt><dd>{detail.observationEligible?detail.correction?.asOf??detail.originalAsOf:'Unavailable'}</dd></div>
   <div className={styles.wide}><dt>Fixed security class</dt><dd>{detail.classTitle}</dd><dd><small>{detail.classId}</small></dd></div>
  </dl>
  {!detail.sourceAvailable&&<p role="status">{detail.unavailableReason??'The source could not be verified.'} A new correction cannot be saved.</p>}
  {detail.history[0]?.action==='correct'&&!detail.correction&&<p>The recorded correction is not in use because its source binding is no longer current.</p>}
  <p>Corrections affect this observation only. Later dated observations and independent same-date conflicts still follow the existing selection rules.</p>
  <a href={detail.sourceUrl} target="_blank" rel="noreferrer">Open the original SEC document</a>
  <details><summary>Original observation evidence</summary><blockquote>{detail.originalEvidence||'See the retained SEC document.'}</blockquote><p>Source SHA-256: {detail.sourceHash}</p></details>
  {detail.sourceText&&<details><summary>Retained SEC document text</summary><pre className={styles.source}>{detail.sourceText}</pre></details>}
  {canWrite?<fieldset disabled={busy} className={styles.form}>
   <legend>Correct this observation</legend>
   <div className={styles.buttons}>
    <label><input type="radio" name={`correction-action-${detail.id}`} checked={action==='correct'} onChange={()=>setAction('correct')}/> Correct value or date</label>
    {canRevoke&&<label><input type="radio" name={`correction-action-${detail.id}`} checked={action==='revoke'} onChange={()=>setAction('revoke')}/> Withdraw correction</label>}
   </div>
   {action==='correct'&&<>
    <div className={styles.inputs}>
     <label>Corrected shares outstanding<input inputMode="numeric" value={quantity} maxLength={78} onChange={e=>setQuantity(e.target.value)} /></label>
     <label>Corrected as-of date<input type="date" value={asOf} onChange={e=>setAsOf(e.target.value)} /></label>
    </div>
    <label>Exact SEC evidence<textarea value={evidence} maxLength={600} rows={5} onChange={e=>setEvidence(e.target.value)} /></label>
   </>}
   <label>Reason (required)<textarea value={reason} maxLength={2000} rows={3} onChange={e=>setReason(e.target.value)} /></label>
   <p>Issuer, accession, security class and shares unit are fixed. Source evidence is checked again when saving.</p>
   <div className={styles.buttons}>
    <button type="button" disabled={!ready||busy} onClick={()=>void submit('preview')}>{action==='correct'?'Preview correction':'Preview withdrawal'}</button>
    <button type="button" disabled={!ready||busy||verified!==signature} onClick={()=>void submit('save')}>{action==='correct'?'Save correction':'Withdraw correction'}</button>
   </div>
  </fieldset>:<p>Your account can view this history but cannot change it.</p>}
  <p role="status" aria-live="polite">{busy?'Checking and saving…':message}</p>
  <h3>Correction history</h3>
  {!detail.history.length?<p>No corrections recorded.</p>:detail.history.map(h=><article className={styles.history} key={h.id}>
   <strong>{h.action==='correct'?'Correction':'Withdrawal'} · Revision {h.revision}</strong>
   {h.action==='correct'&&<p>{h.quantity} shares · As of {h.as_of}</p>}
   <p>{h.reason}</p>{h.evidence&&<blockquote>{h.evidence}</blockquote>}
   <p><time dateTime={h.created_at}>{new Date(h.created_at).toISOString()}</time></p><p>Administrator: {h.actor_user_id}</p>
  </article>)}
 </section>;
}
