import type { ImpactRead } from '@/lib/projected-offering-dilution/history';
import styles from './ProjectedOfferingImpact.module.css';

const reasons: Record<string, string> = {
  issuer_quantity_or_role_unavailable: 'Issuer quantity or security role is unavailable.',
  share_classes_not_comparable: 'Different share classes cannot be combined.',
  overallotment_unavailable: 'Issuer over-allotment quantity or component relationship is unavailable.',
  warrant_underlying_relationship_unavailable: 'Potential warrant shares are unavailable because the underlying relationship is not directly linked.',
  base_assumes_no_prefunded_substitution: 'The base estimate assumes no pre-funded warrant substitution. Substituted securities are not added to the base.',
  exact_os_class_or_baseline_unavailable: 'A directly stated O/S baseline for the exact share class is unavailable.',
  direct_post_os_conflict: 'Calculated and directly stated O/S conflict for a comparable scenario. Both are retained; the affected percentage cannot trigger a threshold alert.',
  direct_post_scenario_not_comparable: 'The directly stated post-offering scenario cannot be compared exactly with the base or full over-allotment scenario.',
};
const value = (n: number | null, suffix = ' shares') => n === null ? 'Unavailable' : `${n.toLocaleString('en-US', { maximumFractionDigits: 4 })}${suffix}`;
// Grouping separators only; keep the original exact quantity and Unicode label intact.
const quantity = (n: string) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

function Metrics({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return <dl className={styles.grid}>{items.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl>;
}

export function ProjectedOfferingImpact({ read, appearance = 'product' }: { read: ImpactRead; appearance?: 'product' | 'admin' }) {
  if (read.status !== 'available') return null;
  const f = read.facts;
  return <section className={`${styles.root} ${appearance === 'admin' ? styles.admin : ''}`} aria-label="Projected offering impact">
    <div className={styles.heading}>
      <h2>Projected offering impact</h2>
      <p>Estimates based on offering plans. These do not confirm closing or an actual O/S increase.</p>
    </div>
    <div className={styles.content}>
      <div className={styles.baseline}>
        <h3>O/S stated in this SEC filing</h3>
        {f.pre_offering_os.map((p, i) => <div className={styles.osRow} key={i}>
          <span>{p.share_class ?? 'Issuer total'}</span>
          <strong>{quantity(p.quantity)} shares</strong>
          <span className={styles.date}>{p.as_of_date ?? p.as_of_text}</span>
        </div>)}
      </div>
      <div className={styles.scenario}>
        <h3>Base scenario</h3>
        <Metrics items={[
          ['Projected issuer new shares', value(f.issuer_new_shares_base)],
          ['Shareholder resale (underlying shares)', value(f.resale_shares)],
          ['Calculated post-offering O/S', value(f.calculated_post_os_base)],
          ['Projected O/S increase', value(f.projected_increase_percent_base, '%')],
        ]} />
      </div>
      <div className={styles.scenario}>
        <h3>Full over-allotment scenario</h3>
        <Metrics items={[
          ['Projected issuer new shares', value(f.issuer_new_shares_full_overallotment)],
          ['Calculated post-offering O/S', value(f.calculated_post_os_full_overallotment)],
          ['Projected O/S increase', value(f.projected_increase_percent_full_overallotment, '%')],
        ]} />
      </div>
      <div className={styles.scenario}>
        <h3>Potential additional dilution</h3>
        <Metrics items={[[ 'Warrant·pre-funded warrant', value(f.potential_warrant_shares) ]]} />
        {f.has_warrants || f.has_prefunded_warrants ? <p>{f.has_warrants ? 'Warrants included. ' : ''}{f.has_prefunded_warrants ? 'Pre-funded warrants included. ' : ''}Exercise and substitution amounts are separate from immediate issuance.</p> : null}
      </div>
      {f.resale_components.map((c, i) => <p className={styles.note} key={i}>Shareholder resale: {c.quantity === null ? 'Quantity not stated' : quantity(c.quantity)} {c.unit} · {c.security_label}</p>)}
      {f.resale_only ? <p className={styles.note}>Resale only: projected issuer new shares are zero.</p> : null}
      {f.unavailable_reason.length ? <div className={styles.notice}>
        <h3>Calculation limitations</h3>
        <ul>{f.unavailable_reason.map(r => <li key={r}>{reasons[r] ?? 'Direct evidence is insufficient.'}</li>)}</ul>
      </div> : null}
      {f.direct_post_offering_os.length ? <details><summary>Directly stated post-offering O/S</summary>{f.direct_post_offering_os.map((d, i) => <p key={i}>{quantity(d.quantity)} {d.unit} · {d.security_label}<br />{d.scenario}</p>)}</details> : null}
      <details>
        <summary>Input records</summary><p>O/S record: {f.os_run_id}</p><p>Offering record: {f.offering_run_id}</p>
      </details>
      <details>
        <summary>Source evidence</summary>
        <p className={styles.note}>Accession {f.accession}</p>
        {read.sourceUrl.startsWith('https://www.sec.gov/') ? <a href={read.sourceUrl} target="_blank" rel="noreferrer">Open SEC filing</a> : null}
        {read.evidence.map(e => <blockquote key={e.id}>{e.text}</blockquote>)}
      </details>
    </div>
  </section>;
}
