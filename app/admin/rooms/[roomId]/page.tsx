import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminRoomActions } from "@/components/admin/AdminRoomActions";
import styles from "@/components/admin/AdminSection.module.css";
import {
  getAdminRoomDetail,
  type AdminRoomContentItem,
} from "@/lib/admin/rooms";
import { rolesHavePermission } from "@/lib/admin/policy";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

export default async function AdminRoomDetailPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const access = await requireAdminPermission("rooms.read");
  const { roomId } = await params;
  const room = await getAdminRoomDetail(access.userId, roomId);
  if (!room) notFound();
  const summary = room.summary;
  const publicHref =
    summary.kind === "company"
      ? `/live/${summary.ticker}`
      : `/live/community/${summary.slug}`;

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>{summary.kind} Live Room</span>
          <h1>{summary.name}</h1>
          <p>{summary.description || "Stock Radar public room"}</p>
        </div>
        <div className={styles.actions}>
          <Link className={styles.button} href="/admin/rooms">
            All rooms
          </Link>
          <Link className={styles.button} href={publicHref}>
            Public room
          </Link>
        </div>
      </header>

      <section className={styles.detailGrid}>
        <DetailCard
          items={[
            ["Status", summary.status],
            ["Ticker / slug", summary.ticker || summary.slug || "-"],
            ["Owner", summary.ownerName],
            ["Created", formatDate(summary.createdAt)],
            ["Last activity", formatDate(summary.lastActivityAt)],
          ]}
          title="Room"
        />
        <DetailCard
          items={[
            ["Participants", summary.memberCount],
            ["Online now", summary.onlineCount],
            ["Messages", summary.messageCount],
            ["Posts", summary.postCount],
            ["Reports", summary.reportCount],
          ]}
          title="Activity"
        />
        <DetailCard
          items={[
            ["Hidden messages", summary.hiddenMessageCount],
            ["Hidden posts", summary.hiddenPostCount],
            ["Status reason", summary.statusReason || "No admin action"],
            [
              "Status updated",
              summary.statusUpdatedAt
                ? formatDate(summary.statusUpdatedAt)
                : "Never",
            ],
          ]}
          title="Moderation"
        />
      </section>

      <div className={styles.split}>
        <div className={styles.stack}>
          <ContentList items={room.messages} title="Recent public messages" />
          <ContentList items={room.posts} title="Recent public posts" />
        </div>
        {rolesHavePermission(access.roles, "rooms.manage") ? (
          <AdminRoomActions roomId={summary.id} status={summary.status} />
        ) : (
          <section className={styles.detailCard}>
            <h2>Room controls</h2>
            <p className={styles.muted}>
              Your role can inspect this room but cannot change its state.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

function DetailCard({
  items,
  title,
}: {
  items: Array<[string, number | string]>;
  title: string;
}) {
  return (
    <article className={styles.detailCard}>
      <h2>{title}</h2>
      <dl className={styles.definition}>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function ContentList({
  items,
  title,
}: {
  items: AdminRoomContentItem[];
  title: string;
}) {
  return (
    <section className={styles.detailCard}>
      <h2>{title}</h2>
      {items.length ? (
        <ul className={styles.compactList}>
          {items.map((item) => (
            <li key={item.id}>
              <span>
                <strong>{item.title || item.authorDisplayName}</strong>
                <br />
                <span className={styles.muted}>
                  {item.title ? `${item.authorDisplayName} · ` : ""}
                  {formatDate(item.createdAt)}
                </span>
                <br />
                {item.body}
              </span>
              <span
                className={`${styles.pill} ${
                  item.visibilityStatus === "hidden"
                    ? styles.pillNegative
                    : styles.pillPositive
                }`}
              >
                {item.visibilityStatus}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.muted}>No retained public content.</p>
      )}
    </section>
  );
}

function formatDate(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
