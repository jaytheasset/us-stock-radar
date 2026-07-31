import {
  formatPublicChatName,
  getLiveRoomChatNameInitials,
} from "@/lib/live-room/chatIdentity";
import styles from "./MemberAvatar.module.css";

export function MemberAvatar({
  className,
  displayName,
  imageUrl = null,
  size = "medium",
}: {
  className?: string;
  displayName: string;
  imageUrl?: string | null;
  size?: "small" | "medium" | "large";
}) {
  const label = formatPublicChatName(displayName);
  const classes = `${styles.avatar}${className ? ` ${className}` : ""}`;

  return (
    <span
      aria-label={`${label} avatar`}
      className={classes}
      data-avatar-size={size}
      data-has-image={Boolean(imageUrl)}
      role="img"
    >
      {imageUrl ? (
        // A provider-backed image can replace the initial without changing callers.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" src={imageUrl} />
      ) : (
        <span aria-hidden="true">
          {getLiveRoomChatNameInitials(displayName)}
        </span>
      )}
    </span>
  );
}
