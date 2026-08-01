import Link from "next/link";
import { AdminTelegramDueRunner } from "@/components/admin/AdminTelegramDueRunner";
import styles from "@/components/admin/AdminTelegramCampaign.module.css";
import {
  listAdminTelegramCampaigns,
  type AdminTelegramCampaign,
} from "@/lib/admin/telegramCampaigns";
import {
  ADMIN_TELEGRAM_CAMPAIGN_STATUSES,
  campaignStatusLabel,
  formatEtDateTime,
  isAdminTelegramCampaignStatus,
} from "@/lib/admin/telegramCampaignPolicy";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<{
  q?: string | string[];
  status?: string | string[];
}>;

export default async function AdminTelegramChannelPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdminPermission("telegram.read");
  const query = await searchParams;
  const search = first(query.q).slice(0, 100);
  const requestedStatus = first(query.status);
  const status = isAdminTelegramCampaignStatus(requestedStatus)
    ? requestedStatus
    : "";
  const campaigns = await listAdminTelegramCampaigns({
    query: search,
    status,
    limit: 150,
  });

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Public channel operations</span>
          <h1>Telegram Channel</h1>
          <p>
            Prepare, review, schedule, and verify administrator notices for the
            free public channel. Eastern Time is used for scheduling; delivery
            records are stored in UTC.
          </p>
        </div>
        <div className={styles.headingActions}>
          <span className={styles.status}>{campaigns.length} records</span>
          <Link className={styles.buttonPrimary} href="/admin/telegram-channel/new">
            New campaign
          </Link>
        </div>
      </header>

      <form className={styles.toolbar}>
        <label className={styles.fieldWide}>
          <span>Search</span>
          <input
            className={styles.input}
            defaultValue={search}
            name="q"
            placeholder="Title, body, ticker, or source"
          />
        </label>
        <label className={styles.field}>
          <span>Status</span>
          <select className={styles.select} defaultValue={status} name="status">
            <option value="">All statuses</option>
            {ADMIN_TELEGRAM_CAMPAIGN_STATUSES.map((item) => (
              <option key={item} value={item}>
                {campaignStatusLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <button className={styles.button} type="submit">
          Apply filters
        </button>
        <Link className={styles.button} href="/admin/telegram-channel">
          Reset
        </Link>
      </form>

      {process.env.NODE_ENV !== "production" ? (
        <section className={styles.notice}>
          <strong>Local scheduler verification</strong>
          <p>
            This processes one due campaign with a mock Telegram response. It
            cannot contact the public channel.
          </p>
          <AdminTelegramDueRunner />
        </section>
      ) : null}

      {campaigns.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Status</th>
                <th>Schedule / completion</th>
                <th>Delivery</th>
                <th>Operator</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <CampaignRow campaign={campaign} key={campaign.id} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>
          <strong>No Telegram campaigns match these filters.</strong>
          <p>Create a draft or clear the current search.</p>
        </div>
      )}
    </div>
  );
}

function CampaignRow({ campaign }: { campaign: AdminTelegramCampaign }) {
  return (
    <tr>
      <td>
        <Link href={`/admin/telegram-channel/${campaign.id}`}>
          {campaign.title || "Untitled campaign"}
        </Link>
        <div className={styles.summary}>
          {campaign.ticker ? `$${campaign.ticker} · ` : ""}
          {campaign.body || "No body text"}
        </div>
      </td>
      <td>
        <span className={`${styles.status} ${statusClass(campaign.status)}`}>
          {campaignStatusLabel(campaign.status)}
        </span>
      </td>
      <td>
        {campaign.scheduledFor
          ? formatEtDateTime(campaign.scheduledFor)
          : campaign.completedAt
            ? formatLocal(campaign.completedAt)
            : "Not scheduled"}
      </td>
      <td>
        {campaign.deliveryOutcome}
        <div className={styles.muted}>
          {campaign.providerMessageId
            ? `Message ${campaign.providerMessageId}`
            : `${campaign.attemptCount} attempts`}
        </div>
      </td>
      <td>
        {campaign.updatedByLabel || campaign.createdByLabel || "Unknown"}
        <div className={styles.muted}>{formatLocal(campaign.updatedAt)}</div>
      </td>
    </tr>
  );
}

function statusClass(status: AdminTelegramCampaign["status"]) {
  if (status === "sent") return styles.statusSent;
  if (status === "scheduled") return styles.statusScheduled;
  if (status === "sending") return styles.statusSending;
  if (status === "failed") return styles.statusFailed;
  if (status === "canceled") return styles.statusCanceled;
  return "";
}

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value || "").trim();
}

function formatLocal(value: string) {
  return Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not available";
}
