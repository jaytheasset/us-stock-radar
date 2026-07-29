import Link from "next/link";
import { Building2, MessageCircle, Users } from "lucide-react";
import type {
  LiveRoomMembershipList,
  LiveRoomMembershipListItem,
} from "@/lib/live-room/types";
import styles from "./LiveRoom.module.css";

export function JoinedRoomsList({
  currentHref,
  data,
  error,
  loading,
}: {
  currentHref: string;
  data: LiveRoomMembershipList | null;
  error: string | null;
  loading: boolean;
}) {
  if (loading) {
    return <p className={styles.joinedRoomsStatus}>Loading My Rooms…</p>;
  }
  if (error) {
    return (
      <p className={styles.joinedRoomsStatus} role="alert">
        {error}
      </p>
    );
  }
  if (!data?.items.length) {
    return (
      <p className={styles.joinedRoomsStatus}>
        Join a company or Community Room to see it here.
      </p>
    );
  }
  return (
    <div className={styles.joinedRoomsList}>
      {data.items.map((room) => (
        <JoinedRoomRow
          current={room.href === currentHref}
          key={room.href}
          room={room}
        />
      ))}
    </div>
  );
}

function JoinedRoomRow({
  current,
  room,
}: {
  current: boolean;
  room: LiveRoomMembershipListItem;
}) {
  return (
    <Link
      aria-current={current ? "page" : undefined}
      className={styles.joinedRoomItem}
      href={room.href}
    >
      <span className={styles.joinedRoomIcon}>
        {room.kind === "company" ? (
          <Building2 aria-hidden="true" size={14} />
        ) : (
          <Users aria-hidden="true" size={14} />
        )}
      </span>
      <span>
        <span className={styles.joinedRoomTitle}>
          {room.kind === "company" && room.ticker ? (
            <b>{room.ticker}</b>
          ) : null}
          <strong>{room.label}</strong>
        </span>
        <small className={styles.joinedRoomMeta}>
          <span>
            {room.participantCount} participants · {room.onlineCount} online
          </span>
          <span>
            {current ? "Current room" : formatRecent(room.recentActivityAt)}
          </span>
        </small>
      </span>
      {room.unreadCount > 0 ? (
        <span
          aria-label={`${room.unreadCount} unread messages`}
          className={styles.joinedRoomUnread}
        >
          <MessageCircle aria-hidden="true" size={12} />
          {formatUnreadCount(room.unreadCount)}
        </span>
      ) : null}
    </Link>
  );
}

function formatUnreadCount(value: number) {
  return value > 99 ? "99+" : String(value);
}

function formatRecent(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Recently active";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "Active now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
