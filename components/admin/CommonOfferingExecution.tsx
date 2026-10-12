import Link from 'next/link';
import type {CommonExecution} from '@/lib/sec-combined-offering/adminHistory';
import styles from './AdminSection.module.css';

export function CommonOfferingExecution({execution,domain,detail=false}:{execution:CommonExecution;domain:'os-snapshots'|'offering-plans';detail?:boolean}) {
 const {filing,status}=execution;
 const label={QUEUED:'대기 중',RUNNING:'분석 중',TECHNICAL_FAILED:'분석 실패'}[status];
 const peer=domain==='os-snapshots'?'offering-plans':'os-snapshots';
 return <article className={styles.card} style={{minWidth:0,overflowWrap:'anywhere'}} aria-label={`공통 Offering 실행 · ${label}`}>
  {detail?<h2>{filing.issuer} {execution.ticker}</h2>:<Link href={`?id=${execution.id}&status=${status}`}><strong>{filing.issuer} {execution.ticker}</strong></Link>}
  <p>공통 Offering 실행 · <strong>{label}</strong></p>
  <p>{filing.form} · {filing.accession} · 공시일 {filing.filing_date}</p>
  {detail&&<>
   <p>{status==='QUEUED'?'공통 분석을 기다리고 있습니다.':status==='RUNNING'?'공통 분석이 진행 중입니다.':'공통 분석을 완료하지 못했습니다.'} O/S·Offering 개별 결과는 아직 생성되지 않았습니다.</p>
   {execution.reason&&<p>공시 원문을 읽을 수 없거나 실행 당시 원문과 일치하지 않습니다.</p>}
   <p>공통 실행 ID: {execution.id}</p>
   <p><Link href={`/admin/data/${peer}?id=${execution.id}`}>다른 검토 화면에서 같은 공통 실행 보기</Link></p>
  </>}
  <p>시작: {execution.startedAt??'대기 중'} · 종료: {execution.finishedAt??'미완료'}</p>
 </article>;
}
