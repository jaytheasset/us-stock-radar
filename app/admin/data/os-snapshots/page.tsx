import Link from 'next/link';
import styles from '@/components/admin/AdminSection.module.css';
import ui from '@/components/admin/OsSnapshotActions.module.css';
import { requireAdminPermission } from '@/lib/admin/server';
import { rolesHavePermission } from '@/lib/admin/policy';
import { listSnapshots, readSnapshot } from '@/lib/sec-os-snapshot/repository';
import type { Block, OsRecord } from '@/lib/sec-os-snapshot/contract';
import { OsSnapshotActions } from '@/components/admin/OsSnapshotActions';
import { OsSnapshotRecord } from '@/components/admin/OsSnapshotRecord';
export const dynamic = 'force-dynamic';
const labels: Record<string, string> = { ALL: '전체', QUEUED: '실행 대기', RUNNING: '분석 중', PASS: '추출 완료', REVIEW_REQUIRED: '후보 검토 필요', NO_DIRECT_CURRENT_OS: '현재 O/S 직접 근거 없음', VALIDATION_FAILED: '출력 검증 실패', TECHNICAL_FAILED: '실행 실패' };
const reasons: Record<string, string> = {
  CONFLICTING_CURRENT_OS: '현재 발행주식 수로 제시된 값들이 서로 충돌합니다.',
  AMBIGUOUS_CURRENT_SCOPE: '현재 발행주식 수가 발행사 전체인지 특정 주식 종류인지 명확하지 않습니다.',
  CURRENT_ACTUAL_NOT_ISOLATABLE: '현재 실제 발행주식 수를 다른 수량과 명확히 분리하지 못했습니다.',
};
const actions: Record<string, string> = { approve: '검토 승인', hold: '판단 보류', reject: '분석 거절', retry: '기술 재시도 요청' };
const candidateNames = (indexes: number[]) => indexes.map(i => `후보 ${i + 1}`).join(', ');
export default async function OsSnapshotsPage({ searchParams }: { searchParams: Promise<{ id?: string; status?: string }> }) {
  const access = await requireAdminPermission('data.read'), params = await searchParams;
  const [entries, selected] = await Promise.all([listSnapshots().catch(() => null), params.id ? readSnapshot(params.id).catch(() => null) : Promise.resolve(null)]);
  const m = selected?.run.metadata, cp = m?.osCheckpoint, source = m?.binding.source;
  const candidates: OsRecord[] = cp?.validated?.review?.candidates ?? [];
  const latest = selected?.decisions.at(-1);
  const blocks: Block[] = source?.blocks ?? [];
  const recordCard = (row: OsRecord, index = 0) => <OsSnapshotRecord key={index} record={row} blocks={blocks.filter(b => row.evidence_blocks.includes(b.id))} />;
  return <div className={styles.page} style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
    <header><h1>SEC 발행주식 수 검토</h1>
      <p>공시에서 AI가 추출한 발행주식 수(O/S), 기준 시점과 원문 근거를 확인하는 화면입니다.</p>
      <p>후보 검토가 필요한 분석에는 관리자 의견을 기록할 수 있습니다. 이 화면의 승인은 종목 수치를 변경하거나 서비스에 게시하는 작업이 아닙니다.</p>
      <Link href="/admin/data">데이터 운영으로</Link>
    </header>
    <nav className={ui.filters} aria-label="AI 분석 상태 필터">{Object.entries(labels).map(([status, label]) => <Link key={status} aria-current={(params.status ?? 'ALL') === status ? 'page' : undefined} href={status === 'ALL' ? '?' : `?status=${status}`}>{label}</Link>)}</nav>
    {params.id && !selected && <p role="alert">선택한 결과를 읽을 수 없습니다.</p>}
    {selected && <section className={styles.stack}>
      <header><h2>{source.filing.issuer}</h2><p>{source.filing.form} · {source.filing.accession} · 공시일 {source.filing.filing_date}</p>
        <p><strong>AI 분석 상태: {labels[m.osStatus] ?? m.osStatus}</strong> <small>({m.osStatus})</small></p>
        <p>현재 저장된 원문과 일치: {selected.current ? '예' : '미확인 또는 과거 원문'}</p>
      </header>
      <div className={ui.notice} aria-label="최근 관리자 결정">
        <strong>최근 관리자 결정: {latest ? actions[latest.action] ?? latest.action : '아직 없음'}</strong>
        {latest ? <><p>{latest.action === 'approve' ? `검토 승인 대상: ${candidateNames(latest.candidate_indexes)}` : '후보 선택 없는 결정'}</p><p>{latest.reason}</p><small>{latest.created_at}</small><p>AI 분석 상태와 관리자 검토 결정은 별도로 보존됩니다. 전체 기록은 아래 결정 이력에서 확인할 수 있습니다.</p></> : <p>아직 관리자 검토 결정을 기록하지 않았습니다.</p>}
      </div>
      {m.osStatus === 'REVIEW_REQUIRED' && <div className={ui.notice}><h3>왜 검토가 필요한가요?</h3><p>{reasons[cp?.validated?.review?.code] ?? 'AI가 현재 발행주식 수를 확정하지 못했습니다. 후보와 원문 근거를 확인하세요.'}</p><p>아래 수량은 확정값이 아닌 AI 후보입니다. 근거를 확인한 뒤 검토 승인·판단 보류·분석 거절 중 하나를 기록하세요.</p></div>}
      {m.osStatus === 'PASS' && <section><h3>AI가 추출한 현재 발행주식 수</h3><p>출력 형식과 근거 참조 검사를 통과한 결과입니다. 관리자 승인이 필요한 상태는 아닙니다.</p><div className={ui.cards}>{(cp?.validated?.current_os ?? []).map((row: OsRecord, i: number) => <article className={ui.record} key={i}>{recordCard(row)}</article>)}</div></section>}
      {m.osStatus === 'NO_DIRECT_CURRENT_OS' && <p className={ui.notice}>직접적인 현재 발행주식 수를 확인하지 못한 정상 완료 결과입니다. 실패가 아니며, 다른 수량으로 자동 보충하지 않습니다.</p>}
      {m.osStatus === 'VALIDATION_FAILED' && <p className={ui.notice}>출력 형식 또는 근거 참조 검사를 통과하지 못했습니다. 검토 승인 대상이 없으며, 원본 출력은 아래에 보존됩니다.</p>}
      {m.osStatus === 'TECHNICAL_FAILED' && <p className={ui.notice}>분석 실행 중 기술 오류가 발생했습니다. 수량 후보를 승인하는 상태가 아닙니다.</p>}
      {['QUEUED', 'RUNNING'].includes(m.osStatus) && <p className={ui.notice}>아직 검토할 결과가 없습니다. {m.osStatus === 'QUEUED' ? 'Worker 실행을 기다리고 있습니다.' : '분석이 진행 중입니다.'}</p>}
      <OsSnapshotActions key={String(selected.run.id)} id={String(selected.run.id)} status={m.osStatus} candidateCards={candidates.map(recordCard)} canWrite={rolesHavePermission(access.roles, 'data.run')} retrySafe={cp?.provider?.retrySafe === true} />
      <section><h3>관리자 결정 이력</h3><p>결정은 새 기록으로 추가되며 AI 원본을 덮어쓰지 않습니다.</p>
        {selected.decisions.length ? selected.decisions.slice().reverse().map(d => <article className={styles.card} key={String(d.id)}><strong>{actions[d.action] ?? d.action}</strong><p>{d.reason}</p><p>{d.action === 'approve' ? `검토 승인 대상: ${candidateNames(d.candidate_indexes)}` : '후보 선택 없음'}</p><p>{d.created_at} · 검토자 {d.actor_user_id}</p></article>) : <p>결정 이력 없음</p>}
      </section>
      <details className={ui.technical}><summary>AI 원본 JSON·검증 결과·실행 정보</summary>
        <h3>최초 GPT 원문 출력</h3><pre>{cp?.raw || '출력 없음'}</pre>
        <h3>검증된 JSON</h3><pre>{JSON.stringify(cp?.validated ?? null, null, 2)}</pre>
        <h3>Schema·근거 참조 검사</h3><pre>{JSON.stringify(cp?.validation ?? null, null, 2)}</pre>
        <p>Contract: {m.binding.contractVersion} · Fingerprint: {m.binding.sourceFingerprint}</p>
        <p>Schema SHA256: {m.binding.schemaHash} · Prompt SHA256: {m.binding.promptHash}</p>
        <p>Provider: {m.binding.providerProfile} · CLI: {cp?.provider?.cliVersion ?? '대기'} · Attempt: {m.attempt}</p>
        <p>시작: {cp?.provider?.startedAt ?? selected.run.started_at ?? '대기'} · 종료: {cp?.provider?.finishedAt ?? selected.run.finished_at ?? '대기'}</p>
        <details><summary>실행 진단</summary><pre>{JSON.stringify(cp?.provider ?? null, null, 2)}</pre></details>
      </details>
    </section>}
    <section className={styles.stack}><h2>공시별 AI 분석 결과</h2><p>목록의 상태는 AI 분석 상태입니다. 관리자 결정은 각 상세 화면에서 별도로 확인하세요.</p>
      {entries === null ? <p role="alert">목록을 읽을 수 없습니다.</p> : entries.filter(r => !params.status || r.metadata.osStatus === params.status).map(r => { const b = r.metadata.binding, s = b.source;
        return <article key={r.id} className={styles.card} style={{ minWidth: 0 }}><Link href={`?id=${r.id}`}><strong>{s.filing.issuer} {s.ticker ?? ''}</strong></Link><p>AI 분석: {labels[r.metadata.osStatus] ?? r.metadata.osStatus}</p><p>{s.filing.form} · {s.filing.accession} · 공시일 {s.filing.filing_date}</p><p>{b.contractVersion} · 시도 {r.metadata.attempt} · {r.finished_at ?? r.started_at ?? '실행 대기'}</p><details className={ui.technical}><summary>원문 식별 정보</summary><p>{b.sourceFingerprint}</p></details></article>;
      })}
    </section>
  </div>;
}
