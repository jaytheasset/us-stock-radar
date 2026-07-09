import type { DashboardV2Impact } from "@/lib/mock/dashboardV2Data";

export function ImpactBadge({ impact }: { impact: DashboardV2Impact }) {
  return (
    <span className={`dashboard-v2-impact dashboard-v2-impact-${impact}`}>
      {impact.toUpperCase()}
    </span>
  );
}
