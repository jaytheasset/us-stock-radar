import Link from "next/link";
import { Fragment } from "react";
import styles from "@/components/admin/AdminSection.module.css";
import { Form25IdentityReview } from "@/components/admin/Form25IdentityReview";
import { requireAdminPermission } from "@/lib/admin/server";
import { rolesHavePermission } from "@/lib/admin/policy";
import { listSecForm25Identities,readEffectiveSecForm25Identity } from "@/lib/sec-form25-identity/persistence";
export const dynamic="force-dynamic";
export const revalidate=0;
export default async function Form25IdentityPage({searchParams}:{searchParams:Promise<{rawItemId?:string}>}) {
 const access=await requireAdminPermission("system.read");const params=await searchParams;
 const listing=await listSecForm25Identities();const selected=params.rawItemId?await readEffectiveSecForm25Identity({rawItemId:params.rawItemId}):null;
 return <div className={styles.page} style={{minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}}><header className={styles.heading}><div><h1>Form 25 ticker identity</h1><p>Official subject-company identity. AI ticker output is not an identity source.</p><Link href="/admin/data/ticker-resolution">Ticker-change relationships</Link></div></header>
 {listing.status==="unavailable"?<p className={styles.error}>Identity records unavailable.</p>:<section className={styles.stack} style={{minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}}><h2>Latest filing identities</h2><p>Bounded to the latest 100 evidence records.</p>{listing.items.map((item,i)=>item.status==="available"?<Link className={styles.card} style={{minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}} href={`?rawItemId=${item.rawItemId}`} key={item.rawItemId}><strong>{item.state} · {item.ticker||"Ticker unavailable"}</strong><p>{item.evidence.issuerName} · CIK {item.evidence.subjectCik} · {item.evidence.accession}</p><small>{item.reason}</small></Link>:<p key={i}>A saved identity could not be verified.</p>)}</section>}
 {selected?.status==="available"?<section className={styles.stack} style={{minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}}><h2>{selected.evidence.issuerName} — {selected.state}</h2><dl className={styles.definition}>
 {Object.entries({"Subject CIK":selected.evidence.subjectCik,"Filed-by CIK":selected.evidence.filedByCik,Accession:selected.evidence.accession,Security:selected.evidence.security,"Original filing exchange":selected.evidence.exchange,"Effective identity ticker":selected.ticker,Reason:selected.reason,"Evidence mode":selected.evidence.mode,SHA:selected.evidenceSha256}).map(([label,value])=><Fragment key={label}><dt>{label}</dt><dd>{value||"Unavailable"}</dd></Fragment>)}
 </dl>{selected.evidence.sourceUrl?<a href={selected.evidence.sourceUrl} target="_blank" rel="noreferrer">SEC filing source</a>:null}
 {selected.evidence.candidates.map((candidate,i)=><article className={styles.card} style={{minWidth:0,maxWidth:"100%",overflowWrap:"anywhere"}} key={i}><strong>{candidate.ticker}</strong><p>{candidate.security||"Current SEC issuer catalog candidate"} · {candidate.exchange}</p><p>{candidate.accession} {candidate.context}</p><a href={candidate.source} target="_blank" rel="noreferrer">Official candidate evidence</a><small>{candidate.sourceSha256}</small></article>)}
 <Form25IdentityReview key={`${selected.identityId}:${selected.revision}`} identity={selected} canWrite={rolesHavePermission(access.roles,"data.run")}/></section>:selected?<p className={styles.error}>Selected identity unavailable.</p>:null}</div>;
}
