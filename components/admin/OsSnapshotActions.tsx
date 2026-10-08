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
      const body=await r.json();if(!r.ok)throw Error(body.error?.message??'결정을 저장하지 못했습니다.');setMessage(action==='retry'?'기술 재시도를 요청했습니다. 대기 상태와 시도 횟수를 확인하세요.':'검토 결정을 이력에 저장했습니다. AI 원본·분석 상태와 서비스 수치는 변경되지 않습니다.');router.refresh();
    } catch(e) {setMessage(`저장 실패: ${e instanceof Error?e.message:String(e)}`);} finally {setBusy(false);}
  }
  return <section className={styles.actions} aria-busy={busy}>
    <h3>{status==='REVIEW_REQUIRED'?'발행주식 수 후보 비교':'기술 실패 재시도'}</h3>
    {status==='REVIEW_REQUIRED'&&<>
      <p>각 후보의 수량·범위·기준 시점과 원문 근거를 비교하세요. 승인할 후보는 직접 선택하며, 복수 선택도 가능합니다.</p>
      <div className={styles.cards}>{candidateCards.map((card,i)=><article className={styles.record} key={i}>
        {canWrite?<label className={styles.candidate}><input type="checkbox" disabled={busy} checked={selected.includes(i)} onChange={e=>{const checked=e.target.checked;setSelected(previous=>checked?[...previous,i]:previous.filter(n=>n!==i));}}/> 후보 {i+1} 검토 승인 대상으로 선택</label>:<h4>후보 {i+1}</h4>}
        {card}
      </article>)}</div>
      {!candidateCards.length&&<p>제시된 후보가 없습니다. 후보 승인 없이 보류 또는 거절 사유를 기록할 수 있습니다.</p>}
      <div className={styles.notice}>
        <h4>이 결정은 무엇을 바꾸나요?</h4>
        <p>관리자 검토 이력만 저장합니다. 승인해도 AI 원본과 ‘후보 검토 필요’ 상태는 유지되며, 종목의 발행주식 수·시장 데이터에는 반영되지 않습니다.</p>
        <ul><li><strong>검토 승인:</strong> 선택한 후보가 타당하다고 검토한 기록</li><li><strong>판단 보류:</strong> 근거가 부족해 판단을 미룬 기록</li><li><strong>분석 거절:</strong> 이 분석을 받아들이지 않는다는 기록</li></ul>
      </div>
    </>}
    {canWrite&&(status==='REVIEW_REQUIRED'||retrySafe)?<>
      {status==='REVIEW_REQUIRED'&&<><h3>검토 결정 기록</h3><p>{selected.length?`승인 대상으로 선택: ${selected.map(i=>`후보 ${i+1}`).join(', ')}`:'승인하려면 위에서 후보를 선택하세요.'} 보류·거절에는 후보 선택이 필요하지 않습니다.</p></>}
      {status==='TECHNICAL_FAILED'&&retrySafe&&<p>최종 출력이 없는 안전한 기술 실패입니다. 재시도 요청 시 대기열로 돌아가며, Worker가 실행되면 GPT를 다시 호출할 수 있습니다.</p>}
      <label className={styles.reason}>검토 사유 (필수)<textarea value={reason} disabled={busy} maxLength={2000} onChange={e=>setReason(e.target.value)} placeholder="원문에서 확인한 내용과 결정한 이유를 적어주세요."/></label>
      <div className={styles.buttons}>{(status==='REVIEW_REQUIRED'?['approve','hold','reject']:retrySafe?['retry']:[]).map(action=><button key={action} disabled={busy||!reason.trim()||(action==='approve'&&!selected.length)} onClick={()=>void act(action)}>{({approve:'선택 후보 검토 승인',hold:'판단 보류 기록',reject:'분석 거절 기록',retry:'기술 실패 재시도'} as Record<string,string>)[action]}</button>)}</div>
    </>:!canWrite?<p>현재 계정은 조회만 가능합니다. 검토 결정을 기록하려면 운영 권한이 필요합니다.</p>:null}
    {status==='TECHNICAL_FAILED'&&!retrySafe&&<p>실행 상태 확인이 필요합니다. 추가 호출은 차단되어 있습니다.</p>}
    <p role="status">{busy?'저장 중…':message}</p></section>;
}
