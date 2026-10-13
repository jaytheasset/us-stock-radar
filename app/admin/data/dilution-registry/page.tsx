import Link from "next/link";
import { DilutionRegistryPreview } from "@/components/admin/DilutionRegistryPreview";
import styles from "@/components/admin/AdminSection.module.css";
import { requireAdminPermission } from "@/lib/admin/server";
import { rolesHavePermission } from "@/lib/admin/policy";
import {OsObservationCorrection} from '@/components/admin/OsObservationCorrection';
import {listOsCorrectionObservations,readOsCorrectionDetail} from '@/lib/dilution-registry/osCorrectionServer';
export const dynamic='force-dynamic';

export default async function DilutionRegistryPreviewPage({searchParams}:{searchParams:Promise<{observation?:string;osAccession?:string;osRun?:string}>}) {
  const access = await requireAdminPermission("data.read");
  const params=await searchParams;
  const [observations,detail]=await Promise.all([
    listOsCorrectionObservations({accession:params.osAccession,runId:params.osRun}).catch(()=>null),
    params.observation?readOsCorrectionDetail(params.observation).catch(()=>null):Promise.resolve(null),
  ]);

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Admin Data</span>
          <h1>Dilution Registry Preview</h1>
          <p>
            Paste one GPT Dilution Registry JSON, Preview it, and use one Apply for the Registry plus independently server-verified Shares Outstanding.
          </p>
        </div>
        <Link className={styles.button} href="/admin/data">
          Back to Data
        </Link>
      </header>

      <DilutionRegistryPreview
        canApply={rolesHavePermission(access.roles, "data.run")}
      />
      <section className={styles.stack} style={{minWidth:0,overflowWrap:'anywhere'}}>
        <h2>Saved Shares Outstanding</h2>
        <p>Open an observation to inspect its SEC source, correct a supported value or date, and review its history. Original records are preserved.</p>
        <form action="/admin/data/dilution-registry" method="get" style={{display:'flex',flexWrap:'wrap',gap:12}}>
          <label>Exact accession <input name="osAccession" defaultValue={params.osAccession??''} placeholder="0000000000-00-000000" pattern="[0-9]{10}-[0-9]{2}-[0-9]{6}" style={{maxWidth:'100%',boxSizing:'border-box'}}/></label>
          <button type="submit" className={styles.button}>Find observations</button>
        </form>
        {params.observation&&!detail&&<p role="alert">The selected observation could not be loaded.</p>}
        {detail&&<OsObservationCorrection key={`${detail.id}:${detail.revision}:${detail.sourceBindingHash}`} detail={detail} canWrite={rolesHavePermission(access.roles,'data.run')}/>}
        {observations===null?<p role="alert">Saved observations could not be loaded.</p>:observations.length?observations.map(row=><article key={row.id} className={styles.card} style={{minWidth:0}}>
          <Link href={`/admin/data/dilution-registry?observation=${row.id}`}><strong>Observation #{row.id} · {row.accession_number}</strong></Link>
          <p>Original: {String(row.shares_outstanding)} shares · As of {row.as_of}</p><p>{row.canonical_security_class_id}</p>
        </article>):<p>No saved observations found.</p>}
      </section>
    </div>
  );
}
