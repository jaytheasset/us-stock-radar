import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "@/components/admin/AdminSection.module.css";
import { UserCommunityActions } from "@/components/admin/UserCommunityActions";
import { rolesHavePermission } from "@/lib/admin/policy";
import { requireAdminPermission } from "@/lib/admin/server";
import { getAdminUserDetail } from "@/lib/admin/users";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ userId: string }> };

export default async function AdminUserDetailPage({ params }: PageProps) {
  const access = await requireAdminPermission("users.read");
  const { userId } = await params;
  const user = await getAdminUserDetail(userId);
  if (!user) notFound();
  const canEnforce = rolesHavePermission(access.roles, "users.enforce");

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>User detail</span>
          <h1>{user.displayName}</h1>
          <p>
            {user.email} · <span className={styles.mono}>{user.id}</span>
          </p>
        </div>
        <Link className={styles.button} href="/admin/users">
          Back to users
        </Link>
      </header>

      <section className={styles.detailGrid}>
        <article className={styles.detailCard}>
          <h2>Account and plan</h2>
          <dl className={styles.definition}>
            <dt>Auth status</dt>
            <dd>{user.auth.accountStatus}</dd>
            <dt>Base plan</dt>
            <dd>{user.plan.basePlan.replace("_", " ")}</dd>
            <dt>Effective plan</dt>
            <dd>{user.plan.effectivePlan.replace("_", " ")}</dd>
            <dt>Trial</dt>
            <dd>
              {user.plan.trial.active
                ? `${user.plan.trial.plan} · ${user.plan.trial.daysRemaining} days left`
                : user.plan.trial.used
                  ? "Used"
                  : "Not used"}
            </dd>
            <dt>Trial period</dt>
            <dd>
              {user.plan.trial.startedAt || user.plan.trial.endsAt
                ? `${formatDate(user.plan.trial.startedAt || null)} to ${formatDate(
                    user.plan.trial.endsAt || null,
                  )}`
                : "Not scheduled"}
            </dd>
            <dt>Joined</dt>
            <dd>{formatDate(user.auth.createdAt || user.createdAt)}</dd>
            <dt>Last sign-in</dt>
            <dd>{formatDate(user.auth.lastSignInAt)}</dd>
          </dl>
        </article>

        <article className={styles.detailCard}>
          <h2>Community</h2>
          <dl className={styles.definition}>
            <dt>Status</dt>
            <dd>{user.community.status.replaceAll("_", " ")}</dd>
            <dt>Suspended until</dt>
            <dd>{formatDate(user.community.suspendedUntil)}</dd>
            <dt>Warnings</dt>
            <dd>{user.community.warningCount}</dd>
            <dt>Joined rooms</dt>
            <dd>{user.communitySummary.joinedRooms}</dd>
            <dt>Followers / following</dt>
            <dd>
              {user.communitySummary.followers} /{" "}
              {user.communitySummary.following}
            </dd>
            <dt>Reports filed</dt>
            <dd>{user.communitySummary.reportsFiled}</dd>
            <dt>Reports received</dt>
            <dd>
              {user.communitySummary.reportsReceived} total ·{" "}
              {user.communitySummary.openCases} open
            </dd>
          </dl>
        </article>

        <article className={styles.detailCard}>
          <h2>Alerts</h2>
          <dl className={styles.definition}>
            <dt>Active tickers</dt>
            <dd>{user.alertSummary.activeTickers}</dd>
            <dt>Channels</dt>
            <dd>
              {user.alertSummary.channels.length
                ? user.alertSummary.channels
                    .map(
                      (channel) =>
                        `${channel.channel}: ${channel.enabled ? "on" : "off"}${channel.verified ? " verified" : ""}`,
                    )
                    .join(", ")
                : "No configured channels"}
            </dd>
          </dl>
        </article>

        <article className={styles.detailCard}>
          <h2>Brokerage connection</h2>
          <p className={styles.notice}>
            Only safe connection metadata is shown. Provider secrets, account
            numbers, balances, positions, and trades are never queried.
          </p>
          <dl className={styles.definition}>
            <dt>Provider</dt>
            <dd>{user.brokerage.provider || "Not connected"}</dd>
            <dt>Status</dt>
            <dd>{user.brokerage.status}</dd>
            <dt>Connected</dt>
            <dd>{user.brokerage.connected ? "Yes" : "No"}</dd>
            <dt>Account types</dt>
            <dd>
              {[
                user.brokerage.hasLiveAccount ? "live" : "",
                user.brokerage.hasPaperAccount ? "paper" : "",
              ]
                .filter(Boolean)
                .join(", ") || "None"}
            </dd>
            <dt>Last sync</dt>
            <dd>{formatDate(user.brokerage.lastSyncedAt)}</dd>
            <dt>Disconnected at</dt>
            <dd>{formatDate(user.brokerage.disconnectedAt)}</dd>
            <dt>Proofs</dt>
            <dd>
              {user.brokerage.proofCount} total ·{" "}
              {user.brokerage.expiredProofCount} expired ·{" "}
              {user.brokerage.disconnectedProofCount} disconnected
            </dd>
          </dl>
        </article>

        <article className={styles.detailCard}>
          <h2>SNS verification</h2>
          {user.socialVerifications.length ? (
            <ul className={styles.compactList}>
              {user.socialVerifications.map((item, index) => (
                <li key={`${item.platform}-${index}`}>
                  <span>{item.platform}</span>
                  <strong>{item.status.replaceAll("_", " ")}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No verification requests.</p>
          )}
        </article>

        <article className={styles.detailCard}>
          <h2>Recent joined rooms</h2>
          {user.recentRooms.length ? (
            <ul className={styles.compactList}>
              {user.recentRooms.map((room) => (
                <li key={room.id}>
                  <span>{room.label}</span>
                  <time dateTime={room.joinedAt}>
                    {formatDate(room.joinedAt, true)}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No joined rooms.</p>
          )}
        </article>
      </section>

      {canEnforce ? (
        <section className={styles.split}>
          <article className={styles.detailCard}>
            <h2>Community enforcement</h2>
            <p className={styles.notice}>
              This does not alter the Auth account. It blocks new Live Room
              messages, posts, comments, direct messages, and room creation.
              Every action requires a reason and is audited.
            </p>
          </article>
          <article className={styles.detailCard}>
            <UserCommunityActions
              currentStatus={user.community.status}
              userId={user.id}
            />
          </article>
        </section>
      ) : null}
    </div>
  );
}

function formatDate(value: string | null, short = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unavailable";
  return new Date(value).toLocaleString("en-US", short
    ? { month: "short", day: "numeric", year: "numeric" }
    : undefined);
}
