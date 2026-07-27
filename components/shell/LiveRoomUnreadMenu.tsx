"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageSquareText } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  LIVE_ROOM_UNREAD_POLL_INTERVAL_MS,
  LIVE_ROOM_UNREAD_REFRESH_EVENT,
  readLiveRoomUnreadSummary,
} from "@/lib/live-room/apiRepository";
import type { LiveRoomUnreadSummary } from "@/lib/live-room/types";
import { IconButton } from "@/components/ui/IconButton";
import styles from "./StockRadarProductHeader.module.css";

const emptySummary: LiveRoomUnreadSummary = {
  rooms: [],
  totalUnreadCount: 0,
};

export function LiveRoomUnreadMenu() {
  const pathname = usePathname();
  const [summary, setSummary] =
    useState<LiveRoomUnreadSummary>(emptySummary);
  const [open, setOpen] = useState(false);
  const [state, setState] =
    useState<"error" | "loading" | "ready">("loading");
  const containerRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const nextSummary = await readLiveRoomUnreadSummary();
      if (requestId !== requestIdRef.current) return;
      setSummary(nextSummary);
      setState("ready");
    } catch {
      if (requestId === requestIdRef.current) setState("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const handleFocus = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const handleRequestedRefresh = () => void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, LIVE_ROOM_UNREAD_POLL_INTERVAL_MS);

    window.addEventListener("focus", handleFocus);
    window.addEventListener(
      LIVE_ROOM_UNREAD_REFRESH_EVENT,
      handleRequestedRefresh,
    );
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      requestIdRef.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener(
        LIVE_ROOM_UNREAD_REFRESH_EVENT,
        handleRequestedRefresh,
      );
      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const total = summary.totalUnreadCount;
  const countLabel = total > 99 ? "99+" : String(total);

  return (
    <div className={styles.liveRoomInbox} ref={containerRef}>
      <IconButton
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          total
            ? `Live Room chats, ${total} unread`
            : "Live Room chats"
        }
        className={styles.liveRoomInboxButton}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void refresh();
        }}
      >
        <MessageSquareText aria-hidden="true" size={18} />
        {total ? (
          <span
            aria-hidden="true"
            className={styles.liveRoomUnreadBadge}
          >
            {countLabel}
          </span>
        ) : null}
      </IconButton>

      {open ? (
        <div
          aria-label="Followed Live Rooms"
          className={styles.liveRoomInboxPopover}
          role="dialog"
        >
          <div className={styles.liveRoomInboxHeading}>
            <div>
              <span>Live Room chats</span>
              <strong>
                {total ? `${total} unread messages` : "All caught up"}
              </strong>
            </div>
            <small>Followed rooms</small>
          </div>

          {state === "loading" ? (
            <p className={styles.liveRoomInboxState}>
              Loading followed rooms…
            </p>
          ) : summary.rooms.length ? (
            <div className={styles.liveRoomInboxList}>
              {summary.rooms.map((room) => (
                <Link
                  href={`/live/${encodeURIComponent(room.ticker)}`}
                  key={room.ticker}
                  onClick={() => setOpen(false)}
                >
                  <span>
                    <strong>{room.ticker}</strong>
                    <small>Company Live Room</small>
                  </span>
                  {room.unreadCount ? (
                    <b>{room.unreadCount}</b>
                  ) : (
                    <small>Read</small>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.liveRoomInboxState}>
              {state === "error"
                ? "Live Room chats could not be refreshed."
                : "Follow a company Live Room to see new chats here."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
