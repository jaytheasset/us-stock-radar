import { MessageCircle } from "lucide-react";
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
  event?: LiveRoomEntryEvent;
  issuer?: string;
  label?: LiveRoomEntryLabel;
  ticker?: string;
  variant?: LiveRoomEntryVariant;
};

export function LiveRoomEntryButton({
  event,
  issuer,
  label = "Live Room",
  ticker,
  variant = "outline",
}: LiveRoomEntryButtonProps) {
  return (
    <button
      aria-label={label}
      className={styles.button}
      data-live-room-event-id={event?.id || undefined}
      data-live-room-event-source={event?.source || undefined}
      data-live-room-event-title={event?.title || undefined}
      data-live-room-event-type={event?.type || undefined}
      data-live-room-issuer={issuer || undefined}
      data-live-room-ticker={ticker || undefined}
      data-variant={variant}
      title={label}
      type="button"
    >
      <MessageCircle aria-hidden="true" size={15} />
      <span>
        {label === "Discuss in Live Room" ? (
          <>
            <span className={styles.desktopPrefix}>Discuss in </span>
            Live Room
          </>
        ) : (
          label
        )}
      </span>
    </button>
  );
}
