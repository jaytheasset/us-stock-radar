import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { getLiveRoomHref } from "@/lib/live-room/adapters";
import styles from "./LiveRoomEntryButton.module.css";

export type LiveRoomEntryLabel = "Live Room" | "Discuss in Live Room";
export type LiveRoomEntryVariant = "outline" | "quiet";

export type LiveRoomEntryEvent = {
  id: string;
  source?: string;
  title?: string;
  type?: string;
};

type LiveRoomEntryButtonProps = {
  className?: string;
  event?: LiveRoomEntryEvent;
  issuer?: string;
  label?: LiveRoomEntryLabel;
  ticker?: string;
  variant?: LiveRoomEntryVariant;
};

export function LiveRoomEntryButton({
  className,
  event,
  issuer,
  label = "Live Room",
  ticker,
  variant = "outline",
}: LiveRoomEntryButtonProps) {
  const href = getLiveRoomHref(ticker);
  if (!href) return null;

  return (
    <Link
      aria-label={label}
      className={[styles.button, className].filter(Boolean).join(" ")}
      data-live-room-event-id={event?.id || undefined}
      data-live-room-event-source={event?.source || undefined}
      data-live-room-event-title={event?.title || undefined}
      data-live-room-event-type={event?.type || undefined}
      data-live-room-issuer={issuer || undefined}
      data-live-room-ticker={ticker || undefined}
      data-variant={variant}
      href={href}
      title={label}
    >
      <MessageCircle aria-hidden="true" size={15} />
      <span className={styles.desktopLabel}>
        {label === "Discuss in Live Room" ? (
          <>
            Discuss in Live Room
          </>
        ) : (
          label
        )}
      </span>
      <span className={styles.mobileLabel}>Live</span>
    </Link>
  );
}
