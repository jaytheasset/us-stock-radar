import type { Block, OsRecord } from '@/lib/sec-os-snapshot/contract';
import styles from './OsSnapshotActions.module.css';

/** Present the retained literals only; never resolve, aggregate, or repair an O/S value. */
export function OsSnapshotRecord({ record, blocks }: { record: OsRecord; blocks: Block[] }) {
  return <>
    <dl className={styles.facts}>
      <div><dt>발행주식 수</dt><dd className={styles.quantity}>{record.quantity}<span> 주</span></dd></div>
      <div><dt>수량의 범위</dt><dd>{record.scope === 'issuer_total' ? '발행사 전체' : record.scope === 'class' ? '특정 주식 종류' : record.scope}</dd></div>
      <div><dt>주식 종류</dt><dd>{record.share_class ?? '별도 명시 없음'}</dd></div>
      <div><dt>기준일</dt><dd>{record.as_of_date ?? '명시된 날짜 없음'}</dd></div>
      <div className={styles.fullWidth}><dt>기준 시점 원문</dt><dd>{record.as_of_text}</dd></div>
    </dl>
    <div className={styles.evidence}>
      <p>원문 근거 · {record.evidence_blocks.length}개</p>
      {record.evidence_blocks.map((id, index) => {
        const block = blocks.find(b => b.id === id);
        return <details key={id}>
          <summary>근거 {index + 1} 보기</summary>
          <pre>{block?.text ?? '원문 근거를 읽을 수 없습니다.'}</pre>
        </details>;
      })}
    </div>
  </>;
}
