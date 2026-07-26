"use client";

import { useCallback, useEffect, useState } from "react";
import { Bookmark } from "lucide-react";
import styles from "./FilingBookmarkButton.module.css";

export const filingBookmarkStorageKey = "sr-filing-bookmarks";
export const newsBookmarkStorageKey = "sr-news-bookmarks";

type FilingBookmarkButtonProps = {
  filingId: string;
};

export function FilingBookmarkButton({ filingId }: FilingBookmarkButtonProps) {
  return (
    <AnalysisBookmarkButton
      itemId={filingId}
      itemLabel="filing"
      storageKey={filingBookmarkStorageKey}
    />
  );
}

type NewsBookmarkButtonProps = {
  newsId: string;
};

export function NewsBookmarkButton({ newsId }: NewsBookmarkButtonProps) {
  return (
    <AnalysisBookmarkButton
      itemId={newsId}
      itemLabel="news"
      storageKey={newsBookmarkStorageKey}
    />
  );
}

type AnalysisBookmarkButtonProps = {
  itemId: string;
  itemLabel: "filing" | "news";
  storageKey: string;
};

function AnalysisBookmarkButton({
  itemId,
  itemLabel,
  storageKey,
}: AnalysisBookmarkButtonProps) {
  const [isBookmarked, setIsBookmarked] = useState(false);

  const syncBookmarkState = useCallback(() => {
    setIsBookmarked(readBookmarkIds(storageKey).includes(itemId));
  }, [itemId, storageKey]);

  useEffect(() => {
    syncBookmarkState();

    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) {
        syncBookmarkState();
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [syncBookmarkState]);

  const toggleBookmark = () => {
    setIsBookmarked((current) => {
      const next = !current;
      const bookmarkIds = new Set(readBookmarkIds(storageKey));

      if (next) {
        bookmarkIds.add(itemId);
      } else {
        bookmarkIds.delete(itemId);
      }

      writeBookmarkIds(storageKey, [...bookmarkIds]);
      return next;
    });
  };

  const actionLabel = isBookmarked
    ? `Remove ${itemLabel} bookmark`
    : `Bookmark ${itemLabel}`;

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

function readBookmarkIds(storageKey: string) {
  try {
    const value = window.localStorage.getItem(storageKey);
    const parsed: unknown = value ? JSON.parse(value) : [];

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function writeBookmarkIds(storageKey: string, bookmarkIds: string[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(bookmarkIds));
  } catch {
    // Keep the in-session pressed state when storage is unavailable.
  }
}
