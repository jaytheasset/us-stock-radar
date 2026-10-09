import Link from 'next/link';
import styles from '@/components/admin/AdminSection.module.css';
import ui from '@/components/admin/OsSnapshotActions.module.css';
import {requireAdminPermission} from '@/lib/admin/server';
import {rolesHavePermission} from '@/lib/admin/policy';
import {listOfferingPlans,readOfferingPlan} from '@/lib/sec-offering-plan/repository';
import type {Plan,Block} from '@/lib/sec-offering-plan/contract';
import {OfferingPlanCard} from '@/components/admin/OfferingPlanCard';
import {OfferingPlanActions} from '@/components/admin/OfferingPlanActions';
export const dynamic='force-dynamic';
const labels:Record<string,string>={ALL:'전체',QUEUED:'대기 중',RUNNING:'분석 중',PASS:'분석 완료',REVIEW_REQUIRED:'검토 필요',NO_DIRECT_OFFERING_PLAN:'직접 기재된 계획 없음',VALIDATION_FAILED:'검증 실패',TECHNICAL_FAILED:'실행 실패'};
const actions:Record<string,string>={approve:'승인',hold:'보류',reject:'거절',retry:'재시도'};
export default async function OfferingPlansPage({searchParams}:{searchParams:Promise<{id?:string;status?:string}>}){
 const access=await requireAdminPermission('data.read'),params=await searchParams;
 const [entries,selected]=await Promise.all([listOfferingPlans().catch(()=>null),params.id?readOfferingPlan(params.id).catch(()=>null):null]);
 const m=selected?.run.metadata,cp=m?.offeringCheckpoint,source=selected?.source,identity=selected?.identity,blocks=source?.blocks??[];
 const candidates:Plan[]=cp?.validated?.review?.candidates??[];
 return <div className={styles.page} style={{minWidth:0,overflowWrap:'anywhere'}}>
  <header><h1>SEC Offering 계획 검토</h1><Link href="/admin/data">데이터 운영으로</Link><p>각 F-1/F-1A의 계획·수정 조건입니다. 실제 판매나 closing 완료를 뜻하지 않습니다.</p></header>
  <nav className={ui.filters} aria-label="분석 상태 필터">{Object.entries(labels).map(([k,v])=><Link key={k} href={k==='ALL'?'?':`?status=${k}`} aria-current={(params.status??'ALL')===k?'page':undefined}>{v}</Link>)}</nav>
  {params.id&&!selected&&<p role="alert">선택한 결과를 읽을 수 없습니다.</p>}
  {selected&&<section className={styles.stack}>
   <header><h2>{identity!.filing.issuer} {identity!.ticker}</h2><p>{identity!.filing.form} · {identity!.filing.accession} · {identity!.filing.filing_date}</p><p>접수: {identity!.filing.accepted_at??'미확인'} · 등록번호: {m.binding.family.number??'미확인'}</p><strong>{labels[m.offeringStatus]}</strong></header>
   {selected.sourceError&&<p role="alert">Source mismatch: 원문을 읽을 수 없거나 분석 당시 fingerprint와 일치하지 않아 근거를 표시하지 않습니다.</p>}
   {cp?.validated?.status==='PASS'&&<OfferingPlanCard plan={cp.validated.plan} blocks={blocks}/>}
   {m.offeringStatus==='NO_DIRECT_OFFERING_PLAN'&&<p>직접 기재된 Offering 계획이 없습니다.</p>}
   {m.offeringStatus==='REVIEW_REQUIRED'&&<p>검토 사유: {cp.validated.review.code}. 후보를 자동 선택하지 않았습니다.</p>}
   {cp?.validated?.review&&source&&<details className={ui.technical}><summary>충돌·모호성의 직접 근거</summary>{blocks.filter((b:Block)=>cp.validated.review.evidence_blocks.includes(b.id)).map((b:Block)=><section key={b.id}><h4>{b.id}</h4><pre>{b.text}</pre></section>)}</details>}
   {m.offeringStatus==='VALIDATION_FAILED'&&<p>원본 결과를 보존했습니다. 아래 검증 기록을 확인해 주세요.</p>}
   <OfferingPlanActions key={selected.run.id} id={selected.run.id} status={m.offeringStatus} candidateCards={candidates.map((p,i)=><OfferingPlanCard key={i} plan={p} blocks={blocks}/>)} canWrite={rolesHavePermission(access.roles,'data.run')} retrySafe={cp?.provider?.retrySafe===true}/>
   <section><h3>관리자 결정 이력</h3>{selected.decisions.length?selected.decisions.map(d=><article className={styles.card} key={d.id}><strong>{actions[d.action]}</strong><p>{d.reason}</p>{d.action==='approve'&&<p>승인 후보 {d.candidate_indexes.map((i:number)=>i+1).join(', ')}</p>}<small>{d.created_at} · {d.actor_user_id}</small></article>):<p>아직 없음</p>}</section>
   <section><h3>같은 등록신고서의 공시별 조건</h3><p>{m.binding.family.key??(m.binding.family.status==='conflicting'?'등록번호 충돌: 연결하지 않음':'공식 등록번호 미확인: 연결하지 않음')}</p>
    <div className={ui.cards}>{selected.family.map(r=><article className={ui.record} key={r.id}><h4><Link href={`?id=${r.id}`}>{r.filing.form} · {r.filing.accession}</Link></h4><p>{r.filing.filing_date} · {labels[r.status]}</p>{r.plan&&<OfferingPlanCard plan={r.plan}/>}</article>)}</div>
   </section>
   <details className={ui.technical}><summary>분석 기록 보기</summary><h3>Raw GPT output</h3><pre>{cp?.raw||'출력 없음'}</pre>{cp?.provider?.rawBytesBase64&&<><p>UTF-8 검증 실패 원본 바이트 (Base64)</p><pre>{cp.provider.rawBytesBase64}</pre></>}
    <h3>Schema·identity·근거 참조 검사</h3><pre>{JSON.stringify(cp?.validation??null,null,2)}</pre><h3>검증 JSON</h3><pre>{JSON.stringify(cp?.validated??null,null,2)}</pre>
    <p>Raw SHA256: {cp?.rawHash}</p><p>Contract: {m.binding.contractVersion}</p><p>Fingerprint: {m.binding.sourceFingerprint}</p><p>Schema: {m.binding.schemaHash} · Prompt: {m.binding.promptHash}</p><p>Provider: {m.binding.providerProfile} · Attempt: {m.attempt}</p>
   </details>
  </section>}
  <section className={styles.stack}><h2>공시 목록</h2>{entries===null?<p role="alert">목록을 읽을 수 없습니다.</p>:entries.filter(r=>!params.status||r.status===params.status).map(r=><article className={styles.card} key={r.id}>
   <Link href={`?id=${r.id}`}><strong>{r.filing.issuer} {r.ticker}</strong></Link><p>{labels[r.status]} · {r.filing.form} · {r.filing.accession}</p><p>공시일 {r.filing.filing_date} · 등록번호 {r.family.number??'미확인'}</p><p>Family: {r.family.key??'미확인'}</p><p>{r.plan?.components.map((c:{seller_type:string;security_label:string})=>`${c.seller_type}: ${c.security_label}`).join(' / ')}</p><p>실행: {r.finished_at??r.started_at??'대기 중'}</p>
  </article>)}</section>
 </div>;
}
