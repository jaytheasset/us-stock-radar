import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import { RoleAssignmentForm } from "@/components/admin/RoleAssignmentForm";
import { listAdminRoleAssignments } from "@/lib/admin/audit";
import { requireAdminPermission } from "@/lib/admin/server";
import { searchAdminUsers } from "@/lib/admin/users";

export const dynamic = "force-dynamic";
type PageProps = { searchParams: Promise<{ q?: string }> };

export default async function AdminRolesPage({ searchParams }: PageProps) {
  const access = await requireAdminPermission("roles.manage");
  const { q = "" } = await searchParams;
  const [assignments, matches] = await Promise.all([
    listAdminRoleAssignments(),
    q ? searchAdminUsers(q, 20) : Promise.resolve([]),
  ]);
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Super administrator</span>
          <h1>Administrator roles</h1>
          <p>
            Grant or revoke database-backed roles. User metadata and app
            metadata are not authorization sources.
          </p>
        </div>
        <span className={styles.badge}>Every change audited</span>
      </header>

      <form className={styles.toolbar}>
        <div className={`${styles.field} ${styles.fieldGrow}`}>
          <label htmlFor="role-user-search">Find a user to grant</label>
          <input
            className={styles.input}
            defaultValue={q}
            id="role-user-search"
            name="q"
            placeholder="Email, display name, or profile ID"
          />
        </div>
        <button className={styles.button} type="submit">
          Search
        </button>
        {q ? (
          <Link className={styles.button} href="/admin/roles">
            Clear
          </Link>
        ) : null}
      </form>

      {matches.length ? (
        <section className={styles.detailGrid}>
          {matches.map((user) => (
            <article className={styles.detailCard} key={user.id}>
              <RoleAssignmentForm
                active={false}
                initialRole="support"
                locked={user.id === access.userId}
                targetUserId={user.id}
                userLabel={`${user.displayName} · ${user.email}`}
              />
            </article>
          ))}
        </section>
      ) : q ? (
        <p className={styles.notice}>No users match this search.</p>
      ) : null}

      <section className={styles.stack}>
        <h2>Current assignments</h2>
        {assignments.length ? (
          <div className={styles.detailGrid}>
            {assignments.map((assignment) => (
              <article className={styles.detailCard} key={assignment.id}>
                <RoleAssignmentForm
                  active={assignment.active}
                  initialRole={assignment.role}
                  locked={assignment.userId === access.userId}
                  targetUserId={assignment.userId}
                  userLabel={`${assignment.displayName} · ${assignment.email}`}
                />
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.notice}>No role assignments are available.</p>
        )}
      </section>
    </div>
  );
}
