import Link from "next/link";
import { notFound } from "next/navigation";
import styles from "@/components/admin/AdminSection.module.css";
import { ModerationCaseActions } from "@/components/admin/ModerationCaseActions";
import { listAdminRoleAssignments } from "@/lib/admin/audit";
import { getAdminModerationCase } from "@/lib/admin/moderation";
import { rolesHavePermission } from "@/lib/admin/policy";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";
type PageProps = { params: Promise<{ caseId: string }> };

export default async function AdminModerationCasePage({ params }: PageProps) {
  const access = await requireAdminPermission("moderation.read");
  const { caseId } = await params;
  const [result, assignments] = await Promise.all([
    getAdminModerationCase(caseId),
    listAdminRoleAssignments(),
  ]);
  if (!result) notFound();
  const canWrite = rolesHavePermission(access.roles, "moderation.write");
  const moderators = [
    ...new Map(
      assignments
        .filter(
          (assignment) =>
            assignment.active &&
            (assignment.role === "super_admin" ||
              assignment.role === "moderator"),
        )
        .map((assignment) => [
          assignment.userId,
          {
            userId: assignment.userId,
            label: `${assignment.displayName} (${assignment.role.replace("_", " ")})`,
          },
        ]),
    ).values(),
  ];

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Moderation case</span>
          <h1>{result.item.id.slice(0, 8)}</h1>
          <p>
            {result.item.reportType.replaceAll("_", " ")} report ·{" "}
            {result.item.reportReason}
          </p>
        </div>
        <Link className={styles.button} href="/admin/moderation">
          Back to queue
        </Link>
      </header>

      <div className={styles.split}>
        <div className={styles.stack}>
          <section className={styles.detailCard}>
            <h2>Case state</h2>
            <dl className={styles.definition}>
              <dt>Status</dt>
              <dd>{result.item.status.replaceAll("_", " ")}</dd>
              <dt>Severity</dt>
              <dd>{result.item.severity}</dd>
              <dt>Assignee</dt>
              <dd>{result.item.assigneeName || "Unassigned"}</dd>
              <dt>Target</dt>
              <dd>
                {result.item.targetType.replaceAll("_", " ")} ·{" "}
                <span className={styles.mono}>{result.item.targetId}</span>
              </dd>
              <dt>Resolution</dt>
              <dd>
                {result.item.resolutionAction?.replaceAll("_", " ") ||
                  "Not resolved"}
              </dd>
            </dl>
          </section>
          <section className={styles.detailCard}>
            <h2>Captured target snapshot</h2>
            <p className={styles.notice}>
              This evidence snapshot and the original raw report are retained.
              Moderation never deletes report evidence.
            </p>
            <pre className={styles.snapshot}>
              {JSON.stringify(result.item.targetSnapshot, null, 2)}
            </pre>
          </section>
          <section className={styles.detailCard}>
            <h2>Case history</h2>
            {result.events.length ? (
              <ul className={styles.compactList}>
                {result.events.map((event) => (
                  <li key={event.id}>
                    <span>
                      <strong>{event.action.replaceAll("_", " ")}</strong>
                      <br />
                      <span className={styles.muted}>
                        {event.actorName || event.actorUserId || "System"} ·{" "}
                        {event.actorRole}
                      </span>
                      <br />
                      {event.reason}
                    </span>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString("en-US")}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.muted}>No administrator actions yet.</p>
            )}
          </section>
        </div>

        {canWrite ? (
          <aside className={styles.detailCard}>
            <h2>Review and action</h2>
            <ModerationCaseActions
              caseId={result.item.id}
              currentAssignee={result.item.assignedTo}
              currentSeverity={result.item.severity}
              currentStatus={result.item.status}
              directMessage={
                result.item.targetType === "live_room_direct_message"
              }
              moderators={moderators}
            />
          </aside>
        ) : (
          <aside className={styles.notice}>
            Your role has read-only moderation access.
          </aside>
        )}
      </div>
    </div>
  );
}
