import type {Plan,Block} from '@/lib/sec-offering-plan/contract';
import ui from './OsSnapshotActions.module.css';

const states:Record<string,string>={stated:'기재됨',blank:'공시의 빈칸',not_stated:'미기재',fixed:'단일 가격',range:'가격 범위'};
const sellers:Record<string,string>={issuer:'발행사 판매',selling_shareholders:'기존 주주 재판매',mixed:'혼합',unclear:'판매 주체 불명확'};
const securities:Record<string,string>={ordinary_shares:'Ordinary shares',common_stock:'Common stock',ads:'ADS',warrants:'Warrants',prefunded_warrants:'Pre-funded warrants'};
const qualifications:Record<string,string>={proposed:'제안 조건',assumed:'가정 가격',final_stated:'확정 가격 기재',not_stated:'미기재'};
const atmKinds:Record<string,string>={offering_limit:'공모 한도',remaining_offering_amount:'잔여 공모 금액',increase_amount:'증액분',decrease_amount:'감액분'};

function Evidence({refs,blocks,label='이 항목의 원문 근거'}:{refs:string[];blocks:Block[];label?:string}){
 return <div className={ui.evidence}>
  {refs.length?refs.map((id,index)=>{
   const block=blocks.find(b=>b.id===id);
   return <details key={id}><summary>{label} {index+1}</summary>
    {block?<><small>{block.document_id} · {block.line_start}–{block.line_end}줄</small><pre>{block.text}</pre></>:<p>이 결과에 연결된 원문 근거를 확인할 수 없습니다.</p>}
   </details>;
  }):<p>연결된 원문 근거가 없습니다.</p>}
 </div>;
}

/** Display the extracted literals and their own references; never infer a security relationship. */
export function OfferingPlanCard({plan,blocks=[]}:{plan:Plan;blocks?:Block[]}){
 return <div className={ui.cards}>
  <p className={ui.fullWidth}>공시에 적힌 증권 단위와 조건을 그대로 표시합니다. 실제 발행·판매·행사 완료를 확인한 값이 아닙니다.</p>
  {plan.components.map(c=><article className={ui.record} key={c.id}>
   <h4>{c.security_label}</h4><p>{sellers[c.seller_type]??c.seller_type} · {securities[c.security_type]??c.security_type}</p>
   <dl className={ui.facts}>
    <div><dt>기재 수량</dt><dd>{states[c.quantity.status]} · {c.quantity.value??'—'} {c.quantity.unit}</dd></div>
    <div><dt>가격</dt><dd>{states[c.price.status]} · {c.price.currency??'통화 미기재'} {c.price.status==='range'?`${c.price.low??'—'}–${c.price.high??'—'}`:c.price.value??'—'} {c.price.per_unit??''}</dd></div>
    <div><dt>가격 조건</dt><dd>{qualifications[c.price.qualification]??c.price.qualification}</dd></div>
    <div className={ui.fullWidth}><dt>공시의 조건·시나리오</dt><dd>{c.scenario??'별도 조건 미기재'}</dd></div>
   </dl>
   <Evidence refs={c.evidence_blocks} blocks={blocks} label="수량·가격·조건의 원문"/>
   {c.depositary&&<section><h5>직접 기재된 기초주식 관계</h5>
    <p>{c.depositary.underlying_share_class??'주식 종류 미기재'} · {c.depositary.underlying_shares_per_security===null?'비율 미기재':`증권 1개당 ${c.depositary.underlying_shares_per_security}주`}</p>
    <Evidence refs={c.depositary.evidence_blocks} blocks={blocks}/>
   </section>}
  </article>)}
  {!!plan.over_allotment.length&&<section className={ui.fullWidth}><h4>초과배정 직접 기재 조건</h4>{plan.over_allotment.map((o,i)=><article className={ui.record} key={i}>
   <p>{sellers[o.seller_type]??o.seller_type} · {o.security_label} · {states[o.quantity.status]} · {o.quantity.value??'—'} {o.quantity.unit}</p><p>{o.scenario??'별도 조건 미기재'}</p><Evidence refs={o.evidence_blocks} blocks={blocks}/>
  </article>)}</section>}
  {!!plan.post_offering_os.length&&<section className={ui.fullWidth}><h4>공시가 직접 제시한 공모 후 주식 수</h4>{plan.post_offering_os.map((o,i)=><article className={ui.record} key={i}>
   <p>{o.security_label} · {o.quantity} {o.unit}</p><p>{o.scenario??'별도 조건 미기재'}</p><Evidence refs={o.evidence_blocks} blocks={blocks}/>
  </article>)}</section>}
  {!!plan.proceeds.length&&<section className={ui.fullWidth}><h4>직접 기재된 조달금</h4>{plan.proceeds.map((o,i)=><article className={ui.record} key={i}>
   <p>{o.kind} · 귀속: {o.recipient} · {o.currency??'통화 미기재'} {o.amount??'금액 미기재'}</p><p>{o.scenario??'별도 조건 미기재'}</p><Evidence refs={o.evidence_blocks} blocks={blocks}/>
  </article>)}</section>}
  <section className={ui.fullWidth} aria-label="ATM 직접 기재 조건"><h4>ATM 직접 기재 조건</h4>
   {plan.atm_terms===undefined?<p>이전 형식의 결과에는 ATM 전용 항목이 없습니다. ATM 여부는 이 항목으로 확인할 수 없습니다.</p>
    :plan.atm_terms.length===0?<p>이 결과에 기록된 ATM 전용 항목이 없습니다.</p>
    :plan.atm_terms.map((term,i)=><article className={ui.record} key={i}>
     <h5>{term.status==='current'?'현재 조건':'이전 조건'} · {atmKinds[term.kind]}</h5>
     <dl className={ui.facts}>
      <div><dt>직접 기재 금액</dt><dd>{term.currency} {term.amount}</dd></div>
      <div><dt>명시된 기준일</dt><dd>{term.as_of_date??'날짜 미기재'}</dd></div>
      <div className={ui.fullWidth}><dt>기준 시점 원문</dt><dd>{term.as_of_text??'미기재'}</dd></div>
      <div className={ui.fullWidth}><dt>조건</dt><dd>{term.qualification??'별도 조건 미기재'}</dd></div>
      <div className={ui.fullWidth}><dt>기재 기준</dt><dd>{term.basis}</dd></div>
      <div className={ui.fullWidth}><dt>연결된 증권</dt><dd>{term.component_ids.map(id=>plan.components.find(c=>c.id===id)?.security_label??id).join(' · ')}</dd></div>
     </dl><Evidence refs={term.evidence_blocks} blocks={blocks}/>
    </article>)}
  </section>
 </div>;
}
