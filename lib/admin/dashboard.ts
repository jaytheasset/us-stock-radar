import "server-only";

import { getIntegrationRegistry } from "@/lib/integrationRegistry";
import { supabaseSelect } from "@/lib/supabase";

type SupabaseResult = Awaited<ReturnType<typeof supabaseSelect>>;
type SelectQuery = typeof supabaseSelect;
type DataRow = Record<string, unknown>;

export type AdminMetricKey =
  | "verification"
  | "reports"
  | "sources"
  | "alerts"
  | "billing"
  | "integrations";

export type AdminMetric = {
  key: AdminMetricKey;
  label: string;
  value: number | null;
  href: string;
  degraded: boolean;
};

export type AdminReportItem = {
  id: string;
  type: "Message" | "Post" | "Comment" | "Direct message";
  reason: string;
  createdAt: string;
  priority: number | null;
};

export type AdminDashboardSnapshot = {
  metrics: AdminMetric[];
  recentReports: AdminReportItem[];
  integrationMissing: string[];
  warnings: string[];
  degradedSources: string[];
  generatedAt: string;
};

function rows(value: unknown): DataRow[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is DataRow =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function count(result: SupabaseResult) {
  if (!result.ok) return null;
  if (typeof result.count === "number") return result.count;
  return rows(result.data).length;
}

async function safeSelect(
  query: SelectQuery,
  source: string,
  table: string,
  search: Record<string, string>,
) {
  try {
    const result = await query(table, search);
    return { source, result };
  } catch (error) {
    return {
      source,
      result: {
        ok: false,
        status: 0,
        data: null,
        count: null,
        error: error instanceof Error ? error.message : "Unknown query error",
      } satisfies SupabaseResult,
    };
  }
}

function metric(
  key: AdminMetricKey,
  label: string,
  value: number | null,
  href: string,
): AdminMetric {
  return { key, label, value, href, degraded: value === null };
}

function reportItems(
  result: SupabaseResult,
  type: AdminReportItem["type"],
) {
  return rows(result.data).map((row): AdminReportItem => ({
    id: typeof row.id === "string" ? row.id : "unknown",
    type,
    reason: typeof row.reason === "string" ? row.reason : "unspecified",
    createdAt:
      typeof row.created_at === "string" ? row.created_at : new Date(0).toISOString(),
    priority: typeof row.priority === "number" ? row.priority : null,
  }));
}

export async function buildAdminDashboardSnapshot(
  query: SelectQuery = supabaseSelect,
): Promise<AdminDashboardSnapshot> {
  const [
    verification,
    messageReports,
    postReports,
    commentReports,
    directReports,
    sourceRuns,
    alertDeliveries,
    subscriptions,
  ] = await Promise.all([
    safeSelect(query, "creator verifications", "live_room_social_verifications", {
      select: "id",
      status: "eq.pending_review",
      limit: "1",
    }),
    safeSelect(query, "message reports", "live_room_message_reports", {
      select: "id,reason,created_at",
      order: "created_at.desc",
      limit: "10",
    }),
    safeSelect(query, "post reports", "live_room_post_reports", {
      select: "id,reason,created_at",
      order: "created_at.desc",
      limit: "10",
    }),
    safeSelect(query, "comment reports", "live_room_post_comment_reports", {
      select: "id,reason,created_at",
      order: "created_at.desc",
      limit: "10",
    }),
    safeSelect(query, "direct message reports", "live_room_direct_message_reports", {
      select: "id,reason,priority,created_at",
      order: "created_at.desc",
      limit: "10",
    }),
    safeSelect(query, "source runs", "source_runs", {
      select: "id",
      status: "eq.failed",
      limit: "1",
    }),
    safeSelect(query, "alert deliveries", "user_alert_deliveries", {
      select: "id",
      delivery_status: "eq.failed",
      limit: "1",
    }),
    safeSelect(query, "subscriptions", "user_plan_subscriptions", {
      select: "id",
      status: "eq.past_due",
      limit: "1",
    }),
  ]);

  const reportResults = [
    messageReports,
    postReports,
    commentReports,
    directReports,
  ];
  const reportCounts = reportResults.map(({ result }) => count(result));
  const reportsValue = reportCounts.some((value) => value === null)
    ? null
    : reportCounts.reduce<number>((total, value) => total + (value ?? 0), 0);

  let integrationMissing: string[] = [];
  let integrationDegraded = false;
  try {
    const registry = getIntegrationRegistry();
    integrationMissing = registry.integrations.flatMap((integration) =>
      integration.env
        .filter((environment) => !environment.present)
        .map((environment) => `${integration.label}: ${environment.key}`),
    );
  } catch {
    integrationDegraded = true;
  }

  const degradedSources = [
    verification,
    ...reportResults,
    sourceRuns,
    alertDeliveries,
    subscriptions,
  ]
    .filter(({ result }) => !result.ok)
    .map(({ source }) => source);
  if (integrationDegraded) degradedSources.push("integration environment");

  const recentReports = [
    ...reportItems(messageReports.result, "Message"),
    ...reportItems(postReports.result, "Post"),
    ...reportItems(commentReports.result, "Comment"),
    ...reportItems(directReports.result, "Direct message"),
  ]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 12);

  return {
    metrics: [
      metric(
        "verification",
        "Pending verifications",
        count(verification.result),
        "/admin/creator-verifications",
      ),
      metric("reports", "Raw reports", reportsValue, "/admin/moderation"),
      metric("sources", "Failed source runs", count(sourceRuns.result), "/admin/sources"),
      metric(
        "alerts",
        "Failed alert deliveries",
        count(alertDeliveries.result),
        "/admin/alerts",
      ),
      metric(
        "billing",
        "Past-due subscriptions",
        count(subscriptions.result),
        "/admin/billing",
      ),
      metric(
        "integrations",
        "Missing integration env",
        integrationDegraded ? null : integrationMissing.length,
        "/admin/integrations",
      ),
    ],
    recentReports,
    integrationMissing,
    warnings: [
      "Billing provider mutations, cron controls, prompt editing, and destructive data operations remain intentionally disabled in this phase.",
    ],
    degradedSources,
    generatedAt: new Date().toISOString(),
  };
}
