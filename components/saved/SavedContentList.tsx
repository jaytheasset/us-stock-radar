"use client";

import { BookmarkMinus, ExternalLink } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { SavedContentListItem } from "@/lib/saved/types";
import { getSavedContentTypeLabel } from "@/lib/saved/types";
import { publishUserContentChange } from "@/lib/userContentSync";
import styles from "./SavedPage.module.css";

export function SavedContentList({
  initialItems,
}: {
  initialItems: readonly SavedContentListItem[];
}) {
  const [items, setItems] = useState([...initialItems]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function remove(item: SavedContentListItem) {
    if (busyId) return;
    const previous = items;
    setBusyId(item.contentId);
    setItems((current) =>
      current.filter(
        (candidate) =>
          candidate.contentId !== item.contentId ||
          candidate.contentType !== item.contentType,
      ),
    );
    publishUserContentChange({
      kind: "saved",
      contentId: item.contentId,
      contentType: item.contentType,
      value: false,
    });

    try {
      const response = await fetch(
        `/api/saved/${item.contentType}/${encodeURIComponent(item.contentId)}`,
        { method: "DELETE" },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.saved !== false) {
        throw new Error("Could not remove bookmark.");
      }
      setMessage("Bookmark removed.");
    } catch (error) {
      setItems(previous);
      publishUserContentChange({
        kind: "saved",
        contentId: item.contentId,
        contentType: item.contentType,
        value: true,
      });
      setMessage(
        error instanceof Error ? error.message : "Could not remove bookmark.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (!items.length) {
    return (
      <div className={styles.emptyState}>
        <strong>No bookmarks in this view</strong>
        <p>Add bookmarks from news, filings, or public Live Room posts.</p>
        <Link href="/feed">Browse Live Feed</Link>
      </div>
    );
  }

  return (
    <>
      <p aria-live="polite" className={styles.listStatus}>
        {message}
      </p>
      <div className={styles.list}>
        {items.map((item) => (
          <article
            className={styles.item}
            data-available={item.available}
            key={`${item.contentType}:${item.contentId}`}
          >
            <div className={styles.itemMeta}>
              <span>{getSavedContentTypeLabel(item.contentType)}</span>
              <time dateTime={item.savedAt}>{formatSavedDate(item.savedAt)}</time>
            </div>

            {item.ticker ? (
              <Link
                className={styles.companyLink}
                href={`/stocks/${encodeURIComponent(item.ticker)}`}
              >
                <strong>{item.ticker}</strong>
                {item.companyName ? <span>{item.companyName}</span> : null}
              </Link>
            ) : null}

            {item.available && item.href ? (
              <Link className={styles.titleLink} href={item.href}>
                <span>{item.title}</span>
                <ExternalLink aria-hidden="true" size={15} />
              </Link>
            ) : (
              <div className={styles.unavailable}>
                <strong>Content unavailable</strong>
                <span>This item was removed, hidden, or is no longer accessible.</span>
              </div>
            )}

            <button
              aria-label={`Remove ${getSavedContentTypeLabel(item.contentType).toLowerCase()} bookmark`}
              disabled={busyId === item.contentId}
              onClick={() => void remove(item)}
              title="Remove bookmark"
              type="button"
            >
              <BookmarkMinus aria-hidden="true" size={17} />
              {busyId === item.contentId ? "Removing…" : "Remove"}
            </button>
          </article>
        ))}
      </div>
    </>
  );
}

function formatSavedDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
