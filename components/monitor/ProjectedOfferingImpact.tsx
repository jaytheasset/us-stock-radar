import type {ImpactHistory} from '@/lib/projected-offering-dilution/history';
import styles from './ProjectedOfferingImpact.module.css';

const reasons:Record<string,string>={
 issuer_quantity_or_role_unavailable:'Issuer quantity or security role was unavailable.',
 share_classes_not_comparable:'The recorded share classes were not comparable.',
 overallotment_unavailable:'Issuer over-allotment quantity or its relationship was unavailable.',
 warrant_underlying_relationship_unavailable:'The warrant underlying relationship was unavailable.',
 base_assumes_no_prefunded_substitution:'The historical base calculation assumed no pre-funded warrant substitution.',
 exact_os_class_or_baseline_unavailable:'An exact share-class O/S baseline was unavailable.',
 direct_post_os_conflict:'The historical calculation recorded a conflict with a stated O/S value.',
 direct_post_scenario_not_comparable:'The stated post-offering scenario was not comparable.',
};
const outcomes:Record<string,string>={CALCULATED:'Calculated at the time',RESALE_ONLY:'Recorded as resale only',PARTIAL:'Partial calculation',UNAVAILABLE:'Calculation unavailable',CONFLICT:'Conflicting values recorded'};
// Preserve the stored number without rounding, recomputing or replacing null with zero.
const value=(n:number|null|undefined,suffix=' shares')=>n==null?'Not recorded':`${String(n)}${suffix}`;
const date=(text:string)=>Number.isFinite(Date.parse(text))?new Date(text).toLocaleString('en-US'):text;
function Metrics({items}:{items:ReadonlyArray<readonly [string,string]>}){
 return <dl className={styles.grid}>{items.map(([label,text])=><div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>;
}

/** Archived display only. Never accepts a current fact or calculates a new value. */
export function ProjectedOfferingHistory({history}:{history:ImpactHistory}){
 const f=history.recorded.facts;
 return <section className={styles.root} aria-label="Historical calculation record">
  <div className={styles.heading}><h2>Historical calculation record</h2>
   <p>Retired — not used for current calculations or new alerts.</p>
   <p>These are the original saved estimates based on offering plans. They may be incomplete or incorrect and do not confirm an actual O/S increase.</p>
  </div>
  <div className={styles.content}>
   <p>Recorded {date(history.createdAt)} · {outcomes[f.calculation_status]??'Historical result'}</p>
   <section><h3>Base scenario — saved estimates</h3><Metrics items={[
    ['Issuer new shares',value(f.issuer_new_shares_base)],['Calculated post-offering O/S',value(f.calculated_post_os_base)],
    ['Estimated O/S increase',value(f.projected_increase_percent_base,'%')],
   ]}/></section>
   <section><h3>Full over-allotment — saved estimates</h3><Metrics items={[
    ['Issuer new shares',value(f.issuer_new_shares_full_overallotment)],['Calculated post-offering O/S',value(f.calculated_post_os_full_overallotment)],
    ['Estimated O/S increase',value(f.projected_increase_percent_full_overallotment,'%')],
   ]}/></section>
   <section><h3>Other saved quantities</h3><Metrics items={[
    ['Resale, recorded underlying shares',value(f.resale_shares)],['Warrant / pre-funded warrant estimate',value(f.potential_warrant_shares)],
   ]}/>
    {f.has_warrants&&<p>Warrants were included in the historical inputs.</p>}
    {f.has_prefunded_warrants&&<p>Pre-funded warrants were included in the historical inputs.</p>}
   </section>
   {!!f.unavailable_reason?.length&&<section className={styles.notice}><h3>Recorded limitations</h3><ul>{f.unavailable_reason.map(r=><li key={r}>{reasons[r]??'A limitation was recorded in the original calculation.'}</li>)}</ul></section>}
   <details><summary>Inputs saved with this record</summary>
    <p>These inputs are preserved as recorded; their presence does not validate the historical calculation.</p>
    {f.pre_offering_os?.map((p,i)=><p key={i}>O/S input: {p.quantity} shares · {p.share_class??'Issuer total'} · {p.as_of_date??p.as_of_text}</p>)}
    {f.resale_components?.map((p,i)=><p key={i}>Resale input: {p.quantity??'Not stated'} {p.unit} · {p.security_label}</p>)}
    {f.direct_post_offering_os?.map((p,i)=><p key={i}>Stated post-offering O/S input: {p.quantity} {p.unit} · {p.security_label}<br/>{p.scenario}</p>)}
   </details>
   <section><h3>Recorded review history</h3>{history.decisions.map(d=><p key={d.domain}>
    {d.domain==='os'?'O/S':'Offering'}: {d.id?(d.approvedAt?`Administrator approval recorded on ${date(d.approvedAt)}`:'Review reference saved; approval could not be confirmed'):'No administrator approval recorded'}
   </p>)}</section>
   <details><summary>Filing and input records</summary><p>Accession {f.accession}</p><p>O/S record: {f.os_run_id}</p><p>Offering record: {f.offering_run_id}</p></details>
   <details><summary>Original source evidence</summary>
    {!history.evidenceAvailable?<p>The original evidence cannot currently be verified. No newer source has been substituted.</p>:<>
     {history.recorded.sourceUrl.startsWith('https://www.sec.gov/')&&<a href={history.recorded.sourceUrl} target="_blank" rel="noreferrer">Open original SEC filing</a>}
     {history.recorded.evidence.map(e=><blockquote key={e.id}>{e.text}</blockquote>)}
    </>}
   </details>
  </div>
 </section>;
}
