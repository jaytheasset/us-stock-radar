import {
  getPlanDisplayName,
  type Plan,
} from "@/lib/subscriptionPolicy";
import styles from "./MemberPlanBadge.module.css";

export type MemberPlanBadgePlan = Plan | "visitor";

export function MemberPlanBadge({
  className,
  plan,
  suffix = "",
}: {
  className?: string;
  plan: MemberPlanBadgePlan;
  suffix?: string;
}) {
  return (
    <span
      className={`${styles.badge}${className ? ` ${className}` : ""}`}
      data-plan={plan}
    >
      {plan === "visitor" ? "Visitor" : getPlanDisplayName(plan)}
      {suffix}
    </span>
  );
}
