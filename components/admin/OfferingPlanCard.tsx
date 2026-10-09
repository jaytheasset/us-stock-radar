import type {Plan,Block} from '@/lib/sec-offering-plan/contract';
import {evidenceRefs} from '@/lib/sec-offering-plan/contract';
import ui from './OsSnapshotActions.module.css';
const states:Record<string,string>={stated:'기재됨',blank:'빈칸',not_stated:'미기재',fixed:'단일 가격',range:'가격 범위'};
const sellers:Record<string,string>={issuer:'발행사 판매',selling_shareholders:'기존 주주 판매',mixed:'혼합',unclear:'판매 주체 불명확'};
const qualifications:Record<string,string>={proposed:'제안 조건',assumed:'가정 가격',final_stated:'확정 가격 기재',not_stated:'미기재'};
export function OfferingPlanCard({plan,blocks=[]}:{plan:Plan;blocks?:Block[]}){
 const refs=evidenceRefs(plan);
 return <div className={ui.cards}>
  {plan.components.map(c=><article className={ui.record} key={c.id}>
   <h4>{c.security_label}</h4><p>{sellers[c.seller_type]??c.seller_type} · {c.security_type}</p>
   <p>제공 수량: {states[c.quantity.status]} · {c.quantity.value??'—'} {c.quantity.unit}</p>
   <p>가격: {states[c.price.status]} · {c.price.currency} {c.price.status==='range'?`${c.price.low}–${c.price.high}`:c.price.value??'—'} {c.price.per_unit}</p>
   <p>가격 조건: {qualifications[c.price.qualification]??c.price.qualification}</p>{c.scenario&&<p>가정: {c.scenario}</p>}
   {c.depositary&&<p>기초주식: {c.depositary.underlying_share_class??'미기재'} · {c.depositary.underlying_shares_per_security===null?'비율 미기재':`증권 1개당 ${c.depositary.underlying_shares_per_security}주`}</p>}
  </article>)}
  {!!plan.over_allotment.length&&<section><h4>초과배정</h4>{plan.over_allotment.map((o,i)=><p key={i}>{o.seller_type} · {o.security_label} · {states[o.quantity.status]} {o.quantity.value} {o.quantity.unit} · {o.scenario}</p>)}</section>}
  {!!plan.post_offering_os.length&&<section><h4>공시가 직접 제시한 공모 후 주식 수</h4>{plan.post_offering_os.map((o,i)=><p key={i}>{o.security_label} · {o.quantity} {o.unit} · {o.scenario}</p>)}</section>}
  {!!plan.proceeds.length&&<section><h4>직접 기재된 조달금</h4>{plan.proceeds.map((o,i)=><p key={i}>{o.kind} · 귀속: {o.recipient} · {o.currency} {o.amount??'—'} · {o.scenario}</p>)}</section>}
  {!!blocks.length&&<details className={ui.technical}><summary>원문 근거 ({refs.length})</summary>{blocks.filter(b=>refs.includes(b.id)).map(b=><section key={b.id}><h4>{b.id}</h4><p>{b.document_id} · {b.line_start}–{b.line_end}줄</p><pre>{b.text}</pre></section>)}</details>}
 </div>;
}
