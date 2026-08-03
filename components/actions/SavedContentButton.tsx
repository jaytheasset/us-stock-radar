"use client";

import { Bookmark } from "lucide-react";
import { useEffect, useState } from "react";
import type { SavedContentType } from "@/lib/saved/types";
import {
  getSavedContentOverride,
  publishUserContentChange,
  subscribeToUserContentChanges,
} from "@/lib/userContentSync";
import styles from "./ContentActionButtons.module.css";

export function SavedContentButton({
  className,
  contentId,
  contentType,
  initialAuthenticated,
  initialSaved,
  returnHref,
}: {
  className?: string;
  contentId: string;
  contentType: SavedContentType;
  initialAuthenticated: boolean;
  initialSaved: boolean;
  returnHref?: string;
}) {
  const [saved, setSaved] = useState(
    () => getSavedContentOverride(contentType, contentId) ?? initialSaved,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSaved(
      getSavedContentOverride(contentType, contentId) ?? initialSaved,
    );
  }, [contentId, contentType, initialSaved]);

  useEffect(
    () =>
      subscribeToUserContentChanges((change) => {
        if (
          change.kind === "saved" &&
          change.contentId === contentId &&
          change.contentType === contentType
        ) {
          setSaved(change.value);
        }
      }),
    [contentId, contentType],
  );

  const contentLabel =
    contentType === "filing"
      ? "filing"
      : contentType === "live_room_post"
        ? "post"
        : "news";
  const actionLabel = saved
    ? `Remove ${contentLabel} bookmark`
    : `Add ${contentLabel} bookmark`;

  async function toggleSaved() {
    if (busy) return;
    if (!initialAuthenticated) {
      window.location.assign(createLoginHref(returnHref));
      return;
    }

    const previous = saved;
    const next = !previous;
    setSaved(next);
    setBusy(true);
    setMessage(next ? "Adding bookmark…" : "Removing bookmark…");
    publishUserContentChange({
      kind: "saved",
      contentId,
      contentType,
      value: next,
    });

    try {
      const response = await fetch(
        `/api/saved/${contentType}/${encodeURIComponent(contentId)}`,
        { method: next ? "PUT" : "DELETE" },
      );
      const payload = (await response.json()) as {
        error?: string;
        saved?: boolean;
      };
      if (response.status === 401) {
        setSaved(previous);
        publishUserContentChange({
          kind: "saved",
          contentId,
          contentType,
          value: previous,
        });
        window.location.assign(createLoginHref(returnHref));
        return;
      }
      if (!response.ok || payload.saved !== next) {
        throw new Error(payload.error || "Bookmark update failed");
      }
      setMessage(next ? "Bookmarked." : "Bookmark removed.");
    } catch {
      setSaved(previous);
      publishUserContentChange({
        kind: "saved",
        contentId,
        contentType,
        value: previous,
      });
      setMessage("Could not update bookmark. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      aria-label={actionLabel}
      aria-pressed={saved}
      className={[styles.button, className].filter(Boolean).join(" ")}
      disabled={busy}
      onClick={() => void toggleSaved()}
      title={actionLabel}
      type="button"
    >
      <Bookmark aria-hidden="true" size={18} />
      <span aria-live="polite" className={styles.status}>
        {message}
      </span>
    </button>
  );
}

function createLoginHref(returnHref?: string) {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const next = returnHref?.startsWith("/") ? returnHref : current;
  return `/login?next=${encodeURIComponent(next)}`;
}
