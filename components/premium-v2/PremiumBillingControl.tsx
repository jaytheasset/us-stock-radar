import type { PremiumV2BillingCycle } from "@/lib/mock/premiumV2Data";
import styles from "./StockRadarPremiumV2.module.css";

export type PremiumBillingControlProps = {
  onChange: (cycle: PremiumV2BillingCycle) => void;
  value: PremiumV2BillingCycle;
};

const billingOptions = [
  { label: "Monthly", value: "monthly" },
  { label: "Annual", value: "annual" },
] as const satisfies readonly { label: string; value: PremiumV2BillingCycle }[];

export function PremiumBillingControl({ onChange, value }: PremiumBillingControlProps) {
  return (
    <fieldset className={styles.billingFieldset}>
      <legend>Billing cycle</legend>
      <div className={styles.billingControl}>
        {billingOptions.map((option) => {
          const isSelected = value === option.value;

          return (
            <label
              className={`${styles.billingOption}${isSelected ? ` ${styles.billingOptionSelected}` : ""}`}
              key={option.value}
            >
              <input
                checked={isSelected}
                name="premium-v2-billing-cycle"
                onChange={() => onChange(option.value)}
                type="radio"
                value={option.value}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
