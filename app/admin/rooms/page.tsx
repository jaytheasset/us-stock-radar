import Link from "next/link";
import styles from "@/components/admin/AdminSection.module.css";
import {
  listAdminRooms,
  type AdminRoomKind,
  type AdminRoomStatus,
} from "@/lib/admin/rooms";
import { requireAdminPermission } from "@/lib/admin/server";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  kind?: string | string[];
  q?: string | string[];
  status?: string | string[];
}>;

export default async function AdminRoomsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const access = await requireAdminPermission("rooms.read");
  const query = await searchParams;
  const search = first(query.q);
  const kind = roomKind(first(query.kind));
  const status = roomStatus(first(query.status));
  const rooms = await listAdminRooms({
    actorUserId: access.userId,
    kind,
    search,
    status,
  });

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>Community operations</span>
          <h1>Live Rooms</h1>
          <p>
            Company and Community Room activity, reports, availability, and
            recent public content. Direct messages are never shown here.
          </p>
        </div>
        <span className={styles.badge}>{rooms.length} rooms</span>
      </header>

      <form className={styles.toolbar}>
        <label className={`${styles.field} ${styles.fieldGrow}`}>
          <span>Search</span>
          <input
            className={styles.input}
            defaultValue={search}
            name="q"
            placeholder="Ticker, room name, or slug"
          />
        </label>
        <label className={styles.field}>
          <span>Kind</span>
          <select className={styles.select} defaultValue={kind || ""} name="kind">
            <option value="">All kinds</option>
            <option value="company">Company</option>
            <option value="community">Community</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>Status</span>
          <select
            className={styles.select}
            defaultValue={status || ""}
            name="status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="locked">Locked</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <button className={styles.button} type="submit">
          Apply filters
        </button>
        <Link className={styles.button} href="/admin/rooms">
          Reset
        </Link>
      </form>

      {rooms.length ? (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Room</th>
                <th>Kind / owner</th>
                <th>Status</th>
                <th>Participants</th>
                <th>Content</th>
                <th>Reports</th>
                <th>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.id}>
                  <td>
                    <Link href={`/admin/rooms/${room.id}`}>{room.name}</Link>
                    <div className={styles.muted}>
                      {room.ticker ? `$${room.ticker}` : room.slug}
                    </div>
                  </td>
                  <td>
                    <span className={styles.pill}>{room.kind}</span>
                    <div className={styles.muted}>{room.ownerName}</div>
                  </td>
                  <td>
                    <StatusPill status={room.status} />
                  </td>
                  <td>
                    <strong>{room.memberCount}</strong> members
                    <div className={styles.muted}>
                      {room.onlineCount} online now
                    </div>
                  </td>
                  <td>
                    {room.messageCount} messages
                    <div className={styles.muted}>{room.postCount} posts</div>
                  </td>
                  <td>{room.reportCount}</td>
                  <td>{formatDate(room.lastActivityAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.empty}>
          <strong>No Live Rooms match these filters.</strong>
          <p>Clear a filter or search for another ticker or room name.</p>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: AdminRoomStatus }) {
  return (
    <span
      className={`${styles.pill} ${
        status === "active"
          ? styles.pillPositive
          : status === "archived"
            ? styles.pillNegative
            : styles.pillAccent
      }`}
    >
      {status}
    </span>
  );
}

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value || "").trim().slice(0, 100);
}

function roomKind(value: string): AdminRoomKind | null {
  return value === "company" || value === "community" ? value : null;
}

function roomStatus(value: string): AdminRoomStatus | null {
  return value === "active" || value === "locked" || value === "archived"
    ? value
    : null;
}

function formatDate(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "No activity";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
