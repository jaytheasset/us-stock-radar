"use client";

import { useCallback, useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import styles from "./FilingBookmarkButton.module.css";

export const filingBookmarkStorageKey = "sr-filing-bookmarks";

type FilingBookmarkButtonProps = {
  filingId: string;
};

export function FilingBookmarkButton({ filingId }: FilingBookmarkButtonProps) {
  const [isBookmarked, setIsBookmarked] = useState(false);

  const syncBookmarkState = useCallback(() => {
    setIsBookmarked(readBookmarkIds().includes(filingId));
  }, [filingId]);

  useEffect(() => {
    syncBookmarkState();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === filingBookmarkStorageKey) {
        syncBookmarkState();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [syncBookmarkState]);

  const toggleBookmark = () => {
    setIsBookmarked((current) => {
      const next = !current;
      const bookmarkIds = new Set(readBookmarkIds());

      if (next) {
        bookmarkIds.add(filingId);
      } else {
        bookmarkIds.delete(filingId);
      }

      writeBookmarkIds([...bookmarkIds]);
      return next;
    });
  };

  const actionLabel = isBookmarked ? "Remove filing bookmark" : "Bookmark filing";

  return (
    <button
      aria-label={actionLabel}
      aria-pressed={isBookmarked}
      className={styles.button}
      onClick={toggleBookmark}
      title={actionLabel}
      type="button"
    >
      <Bookmark aria-hidden="true" size={18} />
    </button>
  );
}

function readBookmarkIds() {
  try {
    const value = window.localStorage.getItem(filingBookmarkStorageKey);
    const parsed: unknown = value ? JSON.parse(value) : [];

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeBookmarkIds(bookmarkIds: string[]) {
  try {
    window.localStorage.setItem(filingBookmarkStorageKey, JSON.stringify(bookmarkIds));
  } catch {
    // Keep the in-session pressed state when storage is unavailable.
  }
}
