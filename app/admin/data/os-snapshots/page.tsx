import Link from 'next/link';
import styles from '@/components/admin/AdminSection.module.css';
import { requireAdminPermission } from '@/lib/admin/server';
import { rolesHavePermission } from '@/lib/admin/policy';
import { listSnapshots, readSnapshot } from '@/lib/sec-os-snapshot/repository';
import { OsSnapshotActions } from '@/components/admin/OsSnapshotActions';
export const dynamic='force-dynamic';
const wrap={minWidth:0,maxWidth:'100%',overflowWrap:'anywhere' as const}, pre={whiteSpace:'pre-wrap' as const,overflowWrap:'anywhere' as const};
export default async function OsSnapshotsPage({searchParams}:{searchParams:Promise<{id?:string;status?:string}>}) {
  const access=await requireAdminPermission('data.read'), params=await searchParams;
  const entries=await listSnapshots().catch(()=>null);
  const selected=params.id?await readSnapshot(params.id).catch(()=>null):null;
  const m=selected?.run.metadata, cp=m?.osCheckpoint, source=m?.binding.source;
  return <div className={styles.page} style={wrap}><header><h1>SEC O/S Snapshots</h1><p>자동 추출된 SEC 주식 수와 원문 근거를 검토합니다.</p><Link href="/admin/data">Data operations</Link></header>
    <nav style={{display:'flex',gap:12,flexWrap:'wrap'}}>{['ALL','QUEUED','RUNNING','PASS','REVIEW_REQUIRED','NO_DIRECT_CURRENT_OS','VALIDATION_FAILED','TECHNICAL_FAILED'].map(s=><Link key={s} href={s==='ALL'?'?':`?status=${s}`}>{s}</Link>)}</nav>
    {params.id&&!selected&&<p role="alert">선택한 결과를 읽을 수 없습니다.</p>}
    {selected&&<section className={styles.stack} style={wrap}><h2>{source.filing.issuer} · {m.osStatus}</h2><p>{source.filing.form} · {source.filing.accession} · {source.filing.filing_date}</p>
      <p>현재 원문과 일치: {selected.current?'예':'미확인 또는 과거 원문'}</p>
      <p>Contract: {m.binding.contractVersion} · Fingerprint: {m.binding.sourceFingerprint}</p>
      <p>Schema SHA256: {m.binding.schemaHash} · Prompt SHA256: {m.binding.promptHash}</p>
      <p>Provider: {m.binding.providerProfile} · CLI: {cp?.provider?.cliVersion??'대기'} · Attempt: {m.attempt}</p>
      <p>시작: {cp?.provider?.startedAt??selected.run.started_at??'대기'} · 종료: {cp?.provider?.finishedAt??selected.run.finished_at??'대기'}</p>
      {m.osStatus==='NO_DIRECT_CURRENT_OS'&&<p>직접적인 현재 O/S가 확인되지 않은 정상 완료 결과입니다.</p>}
      <section className={styles.card}><h3>{m.osStatus==='REVIEW_REQUIRED'?'검토 후보':'Current O/S'}</h3><pre style={pre}>{JSON.stringify(cp?.validated??null,null,2)}</pre></section>
      <section><h3>원문 evidence blocks</h3>{source.blocks.filter((b:{id:string})=>cp?.evidenceRefs?.includes(b.id)).map((b:{id:string;document_id:string;text:string})=><details key={b.id}><summary>{b.id}</summary><pre style={pre}>{b.text}</pre></details>)}</section>
      <details><summary>최초 GPT 원문 출력</summary><pre style={pre}>{cp?.raw??'아직 출력 없음'}</pre></details>
      <details><summary>Schema·참조 검사</summary><pre style={pre}>{JSON.stringify(cp?.validation??null,null,2)}</pre></details>
      <details><summary>실행 진단</summary><pre style={pre}>{JSON.stringify(cp?.provider??null,null,2)}</pre></details>
      <OsSnapshotActions id={String(selected.run.id)} status={m.osStatus} candidates={cp?.validated?.review?.candidates?.length??0} canWrite={rolesHavePermission(access.roles,'data.run')} retrySafe={cp?.provider?.retrySafe===true}/>
      <h3>관리자 결정 이력</h3>{selected.decisions.length?selected.decisions.map(d=><article className={styles.card} key={String(d.id)}><p>{d.action} · {d.created_at} · {d.actor_user_id}</p><p>{d.reason}</p><p>후보: {JSON.stringify(d.candidate_indexes)}</p></article>):<p>결정 이력 없음</p>}
    </section>}
    <section className={styles.stack}><h2>Snapshot 목록</h2>{entries===null?<p role="alert">목록을 읽을 수 없습니다.</p>:entries.filter(r=>!params.status||r.metadata.osStatus===params.status).map(r=>{const b=r.metadata.binding,s=b.source;return <article key={r.id} className={styles.card} style={wrap}><Link href={`?id=${r.id}`}><strong>{s.filing.issuer} {s.ticker??''} · {r.metadata.osStatus}</strong></Link><p>{s.filing.form} · {s.filing.accession} · {s.filing.filing_date}</p><p>{b.sourceFingerprint}</p><p>{b.contractVersion} · Attempt {r.metadata.attempt} · {r.started_at??'대기'} → {r.finished_at??'대기'}</p></article>;})}</section>
  </div>;
}
