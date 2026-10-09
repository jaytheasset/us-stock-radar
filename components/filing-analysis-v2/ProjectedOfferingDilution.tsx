import type { ReadResult } from '@/lib/projected-offering-dilution/repository';
import styles from './ProjectedOfferingDilution.module.css';

const reasons:Record<string,string>={
 issuer_quantity_or_role_unavailable:'회사 신규 발행 수량 또는 증권 역할이 명확하지 않습니다.',
 share_classes_not_comparable:'서로 다른 주식 클래스는 합산하지 않습니다.',
 overallotment_unavailable:'회사 초과배정 수량·연결 관계가 명확하지 않습니다.',
 warrant_underlying_relationship_unavailable:'Warrant와 기초주식의 직접 연결 관계가 부족하여 잠재 수량을 계산할 수 없습니다.',
 base_assumes_no_prefunded_substitution:'기본 예상량은 pre-funded warrant로 대체하지 않는 경우입니다. 대체분과 기본 수량을 합산하지 않습니다.',
 exact_os_class_or_baseline_unavailable:'동일 클래스의 직접 기재 O/S 기준값을 확인할 수 없습니다.',
 direct_post_os_conflict:'계산값과 동일 조건의 직접 기재값이 다릅니다. 두 값을 별도로 보존합니다.',
 direct_post_scenario_not_comparable:'직접 기재 post-O/S의 조건을 기본·초과배정 시나리오와 정확히 대조할 수 없습니다.',
};
const value=(n:number|null,suffix='주')=>n===null?'계산 불가':`${n.toLocaleString('en-US',{maximumFractionDigits:4})}${suffix}`;
export function ProjectedOfferingDilution({read}:{read:ReadResult}){
 if(read.status!=='available')return null;
 const f=read.facts;
 return <section id="projected-offering-dilution" className={styles.root} aria-label="공모 계획 기준 예상 희석">
  <h2 className="text-lg font-semibold">예상 O/S 증가·희석</h2>
  <p className="text-sm">공모 계획 기준 · 실제 공모 완료 또는 실제 O/S 증가를 의미하지 않습니다.</p>
  <dl className={styles.grid}>
   <div><dt>현재 SEC 공시 기준 O/S</dt><dd>{f.pre_offering_os.map((p,i)=><p className="break-words" key={i}>{p.share_class??'회사 전체'}: {p.quantity}주 · {p.as_of_date??p.as_of_text}</p>)}</dd></div>
   {([
    ['회사 신규 발행 예상량',value(f.issuer_new_shares_base)],['기존 주주 재판매량 (기초주식)',value(f.resale_shares)],
    ['예상 post-offering O/S',value(f.calculated_post_os_base)],['예상 O/S 증가율',value(f.projected_increase_percent_base,'%')],
    ['초과배정 전량 행사 시 신규 발행 예상량',value(f.issuer_new_shares_full_overallotment)],
    ['초과배정 전량 행사 시 예상 post-O/S',value(f.calculated_post_os_full_overallotment)],
    ['초과배정 전량 행사 시 예상 증가율',value(f.projected_increase_percent_full_overallotment,'%')],
    ['Warrant·pre-funded warrant 잠재 추가 희석',value(f.potential_warrant_shares)],
   ] as const).map(([label,v])=><div className="min-w-0 break-words" key={label}><dt>{label}</dt><dd className="font-semibold">{v}</dd></div>)}
  </dl>
  {f.resale_components.map((c,i)=><p className="break-words text-sm" key={i}>기존 주주 재판매: {c.quantity??'수량 미기재'} {c.unit} · {c.security_label}</p>)}
  {f.resale_only?<p>기존 주주 재판매만 포함: 회사 신규 발행 예상량 0주.</p>:null}
  {f.has_warrants||f.has_prefunded_warrants?<p>{f.has_warrants?'Warrant 포함. ':''}{f.has_prefunded_warrants?'Pre-funded warrant 포함. ':''}행사·대체 수량은 기본 예상량과 합산하지 않습니다.</p>:null}
  {f.unavailable_reason.length?<ul className="space-y-2 text-sm">{f.unavailable_reason.map(r=><li key={r}>{reasons[r]??'직접 기재 근거가 충분하지 않습니다.'}</li>)}</ul>:null}
  {f.direct_post_offering_os.length?<details><summary>공시에 직접 기재된 post-offering O/S</summary>{f.direct_post_offering_os.map((d,i)=><p className="break-words py-2 text-sm" key={i}>{d.quantity} {d.unit} · {d.security_label}<br/>{d.scenario}</p>)}</details>:null}
  <details><summary>원문 근거</summary>{read.sourceUrl.startsWith('https://www.sec.gov/')?<a href={read.sourceUrl} target="_blank" rel="noreferrer" className="underline">SEC 원문 열기</a>:null}{read.evidence.map(e=><blockquote className="my-3 whitespace-pre-wrap break-words border-l-2 pl-3 text-sm" key={e.id}>{e.text}</blockquote>)}</details>
 </section>;
}
