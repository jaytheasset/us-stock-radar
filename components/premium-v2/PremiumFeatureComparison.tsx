import {
  premiumV2ComparisonRows,
  premiumV2PlanOrder,
  premiumV2Plans,
  type PremiumV2CategoryTone,
} from "@/lib/mock/premiumV2Data";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import styles from "./StockRadarPremiumV2.module.css";

const categoryBadgeTones: Record<PremiumV2CategoryTone, BadgeTone> = {
  governance: "insider",
  performance: "earnings",
  policy: "product",
  risk: "legal",
  transaction: "transaction",
};

function isPremiumValue(value: string) {
  return ![
    "No",
    "—",
    "No market alerts",
    "No personalized alerts",
    "1",
    "5",
    "5 min",
    "Web + App",
    "All alert categories",
  ].includes(value);
}

function getTierColumnClass(planKey: string) {
  if (planKey === "pro") {
    return styles["comparisonColumn-pro"];
  }

  if (planKey === "advanced") {
    return styles["comparisonColumn-advanced"];
  }

  return undefined;
}

export function PremiumFeatureComparison() {
  return (
    <section aria-labelledby="premium-v2-feature-heading" className={styles.comparisonSection}>
      <div className={styles.sectionHeading}>
        <div>
          <span>Feature Comparison</span>
          <h2 id="premium-v2-feature-heading">Alert coverage by tier</h2>
        </div>
        <p>Compare ticker alerts, market-wide alerts, filters, scoring, and delivery channels.</p>
      </div>

      <div className={styles.desktopComparison}>
        <table>
          <caption>Stock Radar alert coverage by tier</caption>
          <thead>
            <tr>
              <th scope="col">Feature</th>
              {premiumV2PlanOrder.map((planKey) => (
                <th className={getTierColumnClass(planKey)} key={planKey} scope="col">
                  {premiumV2Plans[planKey].name}
                  {(planKey === "pro" || planKey === "advanced") ? (
                    <span className={styles.comparisonTierLabel}>
                      {planKey === "pro" ? "Core events" : "Full coverage"}
                    </span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {premiumV2ComparisonRows.map((row) => (
              <tr key={row.feature}>
                <th scope="row">{row.feature}</th>
                {premiumV2PlanOrder.map((planKey) => {
                  const value = row.values[planKey];
                  const detailItems = row.details?.[planKey];

                  return (
                    <td
                      className={[
                        isPremiumValue(value) ? styles.premiumValue : undefined,
                        getTierColumnClass(planKey),
                      ].filter(Boolean).join(" ") || undefined}
                      key={planKey}
                    >
                      <div className={styles.comparisonValue}>
                        <span>{value}</span>
                        {detailItems ? (
                          <ul className={styles.comparisonDetailList}>
                            {detailItems.map((detail) => (
                              <li key={detail.label}>
                                <Badge size="micro" tone={categoryBadgeTones[detail.tone]}>{detail.label}</Badge>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </td>
                  );
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
                const detailItems = row.details?.[planKey];

                return (
                  <div className={getTierColumnClass(planKey)} key={planKey}>
                    <dt>{premiumV2Plans[planKey].name}</dt>
                    <dd
                      className={[
                        isPremiumValue(value) ? styles.premiumValue : undefined,
                        getTierColumnClass(planKey),
                      ].filter(Boolean).join(" ") || undefined}
                    >
                      <span>{value}</span>
                      {detailItems ? (
                        <ul className={styles.comparisonDetailList}>
                          {detailItems.map((detail) => (
                            <li key={detail.label}>
                              <Badge size="micro" tone={categoryBadgeTones[detail.tone]}>{detail.label}</Badge>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </dd>
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
