import Link from 'next/link';
import styles from '@/components/admin/AdminSection.module.css';
import ui from '@/components/admin/OsSnapshotActions.module.css';
import { requireAdminPermission } from '@/lib/admin/server';
import { rolesHavePermission } from '@/lib/admin/policy';
import { listSnapshots, readSnapshot, readMatchingOfferingRun, repository } from '@/lib/sec-os-snapshot/repository';
import type { Block, OsRecord } from '@/lib/sec-os-snapshot/contract';
import { OsSnapshotActions } from '@/components/admin/OsSnapshotActions';
import { OsSnapshotRecord } from '@/components/admin/OsSnapshotRecord';
export const dynamic = 'force-dynamic';
const labels: Record<string, string> = { ALL: '전체', QUEUED: '대기 중', RUNNING: '분석 중', PASS: '분석 완료', REVIEW_REQUIRED: '검토 필요', NO_DIRECT_CURRENT_OS: '수량 확인 불가', VALIDATION_FAILED: '결과 확인 필요', TECHNICAL_FAILED: '분석 실패' };
const reasons: Record<string, string> = {
  CONFLICTING_CURRENT_OS: '현재 발행주식 수로 제시된 값들이 서로 충돌합니다.',
  AMBIGUOUS_CURRENT_SCOPE: '현재 발행주식 수가 발행사 전체인지 특정 주식 종류인지 명확하지 않습니다.',
  CURRENT_ACTUAL_NOT_ISOLATABLE: '현재 실제 발행주식 수를 다른 수량과 명확히 분리하지 못했습니다.',
};
const actions: Record<string, string> = { approve: '승인', hold: '보류', reject: '거절', retry: '재시도 요청' };
const candidateNames = (indexes: number[]) => indexes.map(i => `후보 ${i + 1}`).join(', ');
const displayTime = (value: string) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
export default async function OsSnapshotsPage({ searchParams }: { searchParams: Promise<{ id?: string; status?: string }> }) {
  const access = await requireAdminPermission('data.read'), params = await searchParams;
  const [entries, selected] = await Promise.all([listSnapshots().catch(() => null), params.id ? readSnapshot(params.id).catch(() => null) : Promise.resolve(null)]);
  const m = selected?.run.metadata, cp = m?.osCheckpoint, source = m?.binding.source;
  const candidates: OsRecord[] = cp?.validated?.review?.candidates ?? [];
  const latest = selected?.decisions.at(-1);
  const offeringRunId = selected ? await readMatchingOfferingRun(selected.run, await repository()).catch(() => null) : null;
  const blocks: Block[] = source?.blocks ?? [];
  const recordCard = (row: OsRecord, index = 0) => <OsSnapshotRecord key={index} record={row} blocks={blocks.filter(b => row.evidence_blocks.includes(b.id))} />;
  return <div className={styles.page} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <header><h1>SEC 발행주식 수 검토</h1>
      <Link href="/admin/data">데이터 운영으로</Link>
    </header>
    <nav className={ui.filters} aria-label="분석 상태 필터">{Object.entries(labels).map(([status, label]) => <Link key={status} aria-current={(params.status ?? 'ALL') === status ? 'page' : undefined} href={status === 'ALL' ? '?' : `?status=${status}`}>{label}</Link>)}</nav>
    {params.id && !selected && <p role="alert">선택한 결과를 읽을 수 없습니다.</p>}
    {selected && <section className={styles.stack}>
      <header><h2>{source.filing.issuer}</h2><p>{source.filing.form} · {source.filing.accession} · 공시일 {source.filing.filing_date}</p>
        <p><strong>분석 결과: {labels[m.osStatus] ?? '확인 필요'}</strong></p>
        {!selected.current && <p>현재 공시 원문과 일치하는지 확인이 필요합니다.</p>}
      </header>
      {m.commonInvocation&&<p>공통 호출 {m.commonInvocation.id}의 O/S 직접 추출 결과입니다.</p>}
      {offeringRunId&&<p><Link href={`/admin/data/offering-plans?id=${offeringRunId}`}>같은 공시의 Offering 직접 추출 결과 보기</Link></p>}
      <div className={ui.notice} aria-label="최근 관리자 결정">
        <strong>최근 검토: {latest ? actions[latest.action] ?? latest.action : '아직 없음'}</strong>
        {latest && <>{latest.action === 'approve' && <p>{candidateNames(latest.candidate_indexes)}</p>}<p>{latest.reason}</p><small>{displayTime(latest.created_at)}</small></>}
      </div>
      {m.osStatus === 'REVIEW_REQUIRED' && <p>{reasons[cp?.validated?.review?.code] ?? '후보의 수량과 원문 근거를 확인해 주세요.'}</p>}
      {m.osStatus === 'PASS' && <section><h3>현재 발행주식 수</h3><div className={ui.cards}>{(cp?.validated?.current_os ?? []).map((row: OsRecord, i: number) => <article className={ui.record} key={i}>{recordCard(row)}</article>)}</div></section>}
      {m.osStatus === 'NO_DIRECT_CURRENT_OS' && <p>공시에서 현재 발행주식 수를 확인하지 못했습니다.</p>}
      {m.osStatus === 'VALIDATION_FAILED' && <p>분석 결과를 확인하지 못했습니다.</p>}
      {m.osStatus === 'TECHNICAL_FAILED' && <p>분석을 완료하지 못했습니다.</p>}
      {['QUEUED', 'RUNNING'].includes(m.osStatus) && <p>{m.osStatus === 'QUEUED' ? '분석을 기다리고 있습니다.' : '분석이 진행 중입니다.'}</p>}
      <OsSnapshotActions key={String(selected.run.id)} id={String(selected.run.id)} status={m.osStatus} candidateCards={candidates.map(recordCard)} canWrite={rolesHavePermission(access.roles, 'data.run')} retrySafe={cp?.provider?.retrySafe === true} />
      <section><h3>검토 이력</h3>
        {selected.decisions.length ? selected.decisions.slice().reverse().map(d => <article className={styles.card} key={String(d.id)}><strong>{actions[d.action] ?? d.action}</strong><p>{d.reason}</p>{d.action === 'approve' && <p>{candidateNames(d.candidate_indexes)}</p>}<p>{displayTime(d.created_at)}</p><details><summary>작성 정보</summary><p>{d.actor_user_id}</p></details></article>) : <p>검토 이력 없음</p>}
      </section>
      <details className={ui.technical}><summary>분석 기록 보기</summary>
        <h3>{m.commonInvocation?'공통 호출 원본 결과':'원본 결과'}</h3><pre>{m.commonInvocation?.raw || cp?.raw || '출력 없음'}</pre>
        <h3>검증된 JSON</h3><pre>{JSON.stringify(cp?.validated ?? null, null, 2)}</pre>
        <h3>Schema·근거 참조 검사</h3><pre>{JSON.stringify(cp?.validation ?? null, null, 2)}</pre>
        <p>Contract: {m.binding.contractVersion} · Fingerprint: {m.binding.sourceFingerprint}</p>
        <p>Schema SHA256: {m.binding.schemaHash} · Prompt SHA256: {m.binding.promptHash}</p>
        <p>Provider: {m.binding.providerProfile} · CLI: {cp?.provider?.cliVersion ?? '대기'} · Attempt: {m.attempt}</p>
        <p>시작: {cp?.provider?.startedAt ?? selected.run.started_at ?? '대기'} · 종료: {cp?.provider?.finishedAt ?? selected.run.finished_at ?? '대기'}</p>
        <details><summary>실행 진단</summary><pre>{JSON.stringify(cp?.provider ?? null, null, 2)}</pre></details>
      </details>
    </section>}
    <section className={styles.stack}><h2>공시 목록</h2>
      {entries === null ? <p role="alert">목록을 읽을 수 없습니다.</p> : entries.filter(r => !params.status || r.metadata.osStatus === params.status).map(r => { const b = r.metadata.binding, s = b.source;
        return <article key={r.id} className={styles.card} style={{ minWidth: 0 }}><Link href={`?id=${r.id}`}><strong>{s.filing.issuer} {s.ticker ?? ''}</strong></Link><p>{labels[r.metadata.osStatus] ?? '확인 필요'}</p><p>{s.filing.form} · {s.filing.accession} · 공시일 {s.filing.filing_date}</p><p>{r.finished_at || r.started_at ? displayTime(r.finished_at ?? r.started_at) : '대기 중'}</p></article>;
      })}
    </section>
  </div>;
}
