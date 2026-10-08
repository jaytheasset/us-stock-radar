"use client";
import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import styles from "./OsSnapshotActions.module.css";
export function OsSnapshotActions({id,status,candidateCards,canWrite,retrySafe}:{id:string;status:string;candidateCards:ReactNode[];canWrite:boolean;retrySafe:boolean}) {
  const router=useRouter(),[reason,setReason]=useState(''),[selected,setSelected]=useState<number[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  if(!['REVIEW_REQUIRED','TECHNICAL_FAILED'].includes(status)) return null;
  if(status==='TECHNICAL_FAILED'&&!canWrite) return null;
  async function act(action:string) {
    setBusy(true);setMessage('');
    try {
      const r=await fetch(`/api/admin/data/os-snapshots/${id}`,{method:'POST',headers:{'Content-Type':'application/json','x-request-id':crypto.randomUUID()},
        body:JSON.stringify({action,reason,candidateIndexes:action==='approve'?selected:[]})});
      const body=await r.json();if(!r.ok)throw Error('결정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');setMessage(action==='retry'?'다시 요청했습니다.':'검토 의견을 저장했습니다.');router.refresh();
    } catch {setMessage('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');} finally {setBusy(false);}
  }
  return <section className={styles.actions} aria-busy={busy}>
    <h3>{status==='REVIEW_REQUIRED'?'발행주식 수 후보':'다시 시도'}</h3>
    {status==='REVIEW_REQUIRED'&&<>
      <div className={styles.cards}>{candidateCards.map((card,i)=><article className={styles.record} key={i}>
        {canWrite?<label className={styles.candidate}><input type="checkbox" disabled={busy} checked={selected.includes(i)} onChange={e=>{const checked=e.target.checked;setSelected(previous=>checked?[...previous,i]:previous.filter(n=>n!==i));}}/> 후보 {i+1}</label>:<h4>후보 {i+1}</h4>}
        {card}
      </article>)}</div>
      {!candidateCards.length&&<p>검토할 수량 후보가 없습니다.</p>}
    </>}
    {canWrite&&(status==='REVIEW_REQUIRED'||retrySafe)?<>
      {status==='REVIEW_REQUIRED'&&<><h3>검토 의견</h3><p>{selected.length?`선택: ${selected.map(i=>`후보 ${i+1}`).join(', ')}`:'승인할 후보를 선택하세요.'}</p></>}
      <label className={styles.reason}>사유 (필수)<textarea value={reason} disabled={busy} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="검토 의견을 적어주세요."/></label>
      <div className={styles.buttons}>{(status==='REVIEW_REQUIRED'?['approve','hold','reject']:retrySafe?['retry']:[]).map(action=><button key={action} disabled={busy||!reason.trim()||(action==='approve'&&!selected.length)} onClick={()=>void act(action)}>{({approve:'선택 후보 승인',hold:'보류',reject:'거절',retry:'다시 시도'} as Record<string,string>)[action]}</button>)}</div>
    </>:!canWrite?<p>조회만 가능한 계정입니다.</p>:null}
    {status==='TECHNICAL_FAILED'&&!retrySafe&&<p>현재 다시 시도할 수 없습니다.</p>}
    <p role="status">{busy?'저장 중…':message}</p></section>;
}
