"use client";

import { useState } from "react";
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
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(
    null,
  );
  const showImage = Boolean(
    imageUrl && imageUrl !== failedImageUrl,
  );

  return (
    <span
      className={classes}
      data-avatar-size={size}
      data-has-image={showImage || undefined}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`${label} avatar`}
          onError={() => setFailedImageUrl(imageUrl)}
          src={imageUrl || ""}
        />
      ) : (
        <span aria-label={`${label} avatar`} role="img">
          {getLiveRoomChatNameInitials(displayName)}
        </span>
      )}
    </span>
  );
}
