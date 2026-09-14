import Link from "next/link";
import { Fragment } from "react";
import styles from "@/components/admin/AdminSection.module.css";
import { Form25IdentityReview } from "@/components/admin/Form25IdentityReview";
import { requireAdminPermission } from "@/lib/admin/server";
import { rolesHavePermission } from "@/lib/admin/policy";
import { listSecForm25Identities, readEffectiveSecForm25Identity } from "@/lib/sec-form25-identity/persistence";
export const dynamic="force-dynamic";
export const revalidate=0;
const fit={minWidth:0,maxWidth:"100%",overflowWrap:"anywhere" as const};
function stateLabel(state:string){return state==="HELD"?"HOLD":state==="HUMAN_APPROVED"?"APPROVED":state==="UNRESOLVED"?"REVIEW":state;}
export default async function Form25IdentityPage({searchParams}:{searchParams:Promise<{rawItemId?:string}>}) {
 const access=await requireAdminPermission("system.read");const params=await searchParams;
 const listing=await listSecForm25Identities();const selected=params.rawItemId?await readEffectiveSecForm25Identity({rawItemId:params.rawItemId}):null;
 return <div className={styles.page} style={fit}>
  <header className={styles.heading}><div><h1>Form 25 company identity</h1><p>Confirm which company and security this filing belongs to. Analysis corrections are reviewed separately.</p><Link href="/admin/data/form25-analysis">Analysis Review</Link></div></header>
  {listing.status==="unavailable"?<p role="alert">Identity records unavailable.</p>:<section className={styles.stack} style={fit}><h2>Filings to review</h2>{listing.items.map((item,i)=>item.status==="available"?<Link className={styles.card} style={fit} href={`?rawItemId=${item.rawItemId}`} key={item.rawItemId}><strong>{item.evidence.issuerName||"Company unavailable"}</strong><p>Form 25 · {stateLabel(item.state)} · {item.ticker||"Candidate confirmation needed"}</p></Link>:<p key={i}>A saved identity could not be verified.</p>)}</section>}
  {selected?.status==="available"?<section className={styles.stack} style={fit}>
   <h2>{selected.evidence.issuerName} — {stateLabel(selected.state)}</h2>
   <dl className={styles.definition}>{Object.entries({Ticker:selected.ticker,Security:selected.evidence.security,"Filing exchange":selected.evidence.exchange}).map(([label,value])=><Fragment key={label}><dt>{label}</dt><dd>{value||"Unavailable"}</dd></Fragment>)}</dl>
   <p>{selected.state==="HELD"?"Identity connection is on hold.":selected.ticker?"This effective identity can be used for company links.":"Company links and ticker-dependent evaluations remain unavailable until a verified candidate or administrator override is approved."}</p>
   {selected.evidence.sourceUrl?<a href={selected.evidence.sourceUrl} target="_blank" rel="noreferrer">Open SEC filing evidence</a>:null}
   <Link href={`/admin/data/form25-analysis?rawItemId=${selected.rawItemId}`}>Review this filing's analysis separately</Link>
   {selected.evidence.candidates.length?<details><summary>Retained candidate evidence</summary>{selected.evidence.candidates.map((candidate,i)=><article className={styles.card} style={fit} key={i}><strong>Candidate: {candidate.ticker}</strong><p>{candidate.security||"Current SEC issuer catalog candidate"} · {candidate.exchange||"Exchange unavailable"}</p><a href={candidate.source} target="_blank" rel="noreferrer">Open candidate evidence</a><details><summary>Candidate source details</summary><p>{candidate.accession} · {candidate.context}</p><small>{candidate.sourceSha256}</small></details></article>)}</details>:null}
   <Form25IdentityReview key={`${selected.identityId}:${selected.revision}`} identity={selected} canWrite={rolesHavePermission(access.roles,"data.run")}/>
   <details><summary>Technical filing identifiers</summary><dl className={styles.definition}>{Object.entries({"Subject CIK":selected.evidence.subjectCik,"Filed-by CIK":selected.evidence.filedByCik,Accession:selected.evidence.accession,Reason:selected.reason,"Evidence mode":selected.evidence.mode,SHA:selected.evidenceSha256}).map(([label,value])=><Fragment key={label}><dt>{label}</dt><dd>{value||"Unavailable"}</dd></Fragment>)}</dl></details>
  </section>:selected?<p role="alert">Selected identity unavailable.</p>:null}
 </div>;
}
