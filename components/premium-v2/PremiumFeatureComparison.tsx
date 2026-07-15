import {
  premiumV2ComparisonRows,
  premiumV2PlanOrder,
  premiumV2Plans,
} from "@/lib/mock/premiumV2Data";
import styles from "./StockRadarPremiumV2.module.css";

function isPremiumValue(value: string) {
  return !["—", "1", "2", "3", "5", "5 min", "Delayed"].includes(value);
}

export function PremiumFeatureComparison() {
  return (
    <section aria-labelledby="premium-v2-feature-heading" className={styles.comparisonSection}>
      <div className={styles.sectionHeading}>
        <div>
          <span>Feature Comparison</span>
          <h2 id="premium-v2-feature-heading">Plan limits by tier</h2>
        </div>
        <p>Confirmed alert, watchlist, category, and delivery limits from the current product source.</p>
      </div>

      <div className={styles.desktopComparison}>
        <table>
          <caption>Stock Radar plan limits by tier</caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              {premiumV2PlanOrder.map((planKey) => <th key={planKey} scope="col">{premiumV2Plans[planKey].name}</th>)}
            </tr>
          </thead>
          <tbody>
            {premiumV2ComparisonRows.map((row) => (
              <tr key={row.feature}>
                <th scope="row">{row.feature}</th>
                {premiumV2PlanOrder.map((planKey) => {
                  const value = row.values[planKey];
                  return <td className={isPremiumValue(value) ? styles.premiumValue : undefined} key={planKey}>{value}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.mobileComparison}>
        {premiumV2ComparisonRows.map((row) => (
          <article key={row.feature}>
            <h3>{row.feature}</h3>
            <dl>
              {premiumV2PlanOrder.map((planKey) => {
                const value = row.values[planKey];
                return (
                  <div key={planKey}>
                    <dt>{premiumV2Plans[planKey].name}</dt>
                    <dd className={isPremiumValue(value) ? styles.premiumValue : undefined}>{value}</dd>
                  </div>
                );
              })}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
