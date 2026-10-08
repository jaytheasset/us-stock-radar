"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./OsSnapshotActions.module.css";
export function OsSnapshotActions({id,status,candidates,canWrite,retrySafe}:{id:string;status:string;candidates:number;canWrite:boolean;retrySafe:boolean}) {
  const router=useRouter(),[reason,setReason]=useState(''),[selected,setSelected]=useState<number[]>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  if(!canWrite || !['REVIEW_REQUIRED','TECHNICAL_FAILED'].includes(status)) return null;
  async function act(action:string) {
    setBusy(true);setMessage('');
    try {
      const r=await fetch(`/api/admin/data/os-snapshots/${id}`,{method:'POST',headers:{'Content-Type':'application/json','x-request-id':crypto.randomUUID()},
        body:JSON.stringify({action,reason,candidateIndexes:action==='approve'?selected:[]})});
      const body=await r.json();if(!r.ok)throw Error(body.error?.message??'Decision failed');setMessage('Decision recorded.');router.refresh();
    } catch(e) {setMessage(String(e));} finally {setBusy(false);}
  }
  return <section className={styles.actions} aria-busy={busy}><h3>관리자 결정</h3>
    {status==='REVIEW_REQUIRED' && Array.from({length:candidates},(_,i)=><label key={i} className={styles.candidate}><input type="checkbox" disabled={busy} checked={selected.includes(i)} onChange={e=>{const checked=e.target.checked;setSelected(previous=>checked?[...previous,i]:previous.filter(n=>n!==i));}}/> 후보 {i+1}</label>)}
    <label className={styles.reason}>검토 사유<textarea value={reason} disabled={busy} maxLength={2000} onChange={e=>setReason(e.target.value)}/></label>
    <div className={styles.buttons}>{(status==='REVIEW_REQUIRED'?['approve','hold','reject']:retrySafe?['retry']:[]).map(action=><button key={action} disabled={busy||!reason.trim()||(action==='approve'&&!selected.length)} onClick={()=>void act(action)}>{({approve:'선택 후보 승인',hold:'보류',reject:'분석 거절',retry:'기술 실패 재시도'} as Record<string,string>)[action]}</button>)}</div>
    {status==='TECHNICAL_FAILED'&&!retrySafe&&<p>실행 상태 확인이 필요합니다. 추가 호출은 차단되어 있습니다.</p>}
    <p role="status">{busy?'저장 중…':message}</p></section>;
}
