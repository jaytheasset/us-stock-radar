import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import { searchAdminUsers } from "@/lib/admin/users";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function AdminUsersPage({ searchParams }: PageProps) {
  await requireAdminPermission("users.read");
  const { q = "" } = await searchParams;
  const users = await searchAdminUsers(q, 50);
  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Accounts</span>
          <h1>Users</h1>
          <p>
            Search by email, display name, or public profile ID. Authentication
            credentials and brokerage secrets are never exposed here.
          </p>
        </div>
        <span className={styles.badge}>Read + community safety</span>
      </header>

      <form className={styles.toolbar}>
        <div className={`${styles.field} ${styles.fieldGrow}`}>
          <label htmlFor="admin-user-search">Search users</label>
          <input
            className={styles.input}
            defaultValue={q}
            id="admin-user-search"
            name="q"
            placeholder="Email, display name, or public profile ID"
            type="search"
          />
        </div>
        <button className={styles.button} type="submit">
          Search
        </button>
        {q ? (
          <Link className={styles.button} href="/admin/users">
            Clear
          </Link>
        ) : null}
      </form>

      {users.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Plan</th>
                <th>Community</th>
                <th>Joined</th>
                <th>Profile ID</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <Link href={`/admin/users/${user.id}`}>
                      {user.displayName}
                    </Link>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <span className={`${styles.pill} ${styles.pillAccent}`}>
                      {user.plan.effectivePlan.replace("_", " ")}
                    </span>
                    {user.plan.planSource === "trial" ? (
                      <span className={styles.muted}> trial</span>
                    ) : null}
                  </td>
                  <td>
                    <span
                      className={`${styles.pill} ${
                        user.communityStatus === "active"
                          ? styles.pillPositive
                          : styles.pillNegative
                      }`}
                    >
                      {user.communityStatus.replaceAll("_", " ")}
                    </span>
                  </td>
                  <td>
                    {user.createdAt
                      ? new Date(user.createdAt).toLocaleDateString("en-US")
                      : "Unavailable"}
                  </td>
                  <td className={styles.mono}>
                    {user.publicProfileId || "Not created"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className={styles.empty}>
          <strong>No matching users.</strong>
          <p>Try a full email, a shorter display name, or the public profile ID.</p>
        </section>
      )}
    </div>
  );
}
