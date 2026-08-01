"use client";

import { AlertTriangle, Send, X } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { formatPublicChatName } from "@/lib/live-room/chatIdentity";
import { LIVE_ROOM_MESSAGE_MAX_LENGTH } from "@/lib/live-room/moderation";
import styles from "./DirectMessageRequestModal.module.css";

type DirectMessageRequestTarget = {
  avatarUrl: string | null;
  displayName: string;
  messageId: string;
};

export function DirectMessageRequestModal({
  busy,
  error,
  onCancel,
  onSubmit,
  target,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (body: string) => Promise<void>;
  target: DirectMessageRequestTarget;
}) {
  const [body, setBody] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [busy, onCancel]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || busy) return;
    await onSubmit(body);
  }

  return (
    <div
      aria-labelledby="direct-message-request-title"
      aria-modal="true"
      className={styles.overlay}
      role="dialog"
    >
      <button
        aria-label="Close message request"
        className={styles.backdrop}
        disabled={busy}
        onClick={onCancel}
        tabIndex={-1}
        type="button"
      />
      <section className={styles.dialog}>
        <header>
          <MemberAvatar
            className={styles.avatar}
            displayName={target.displayName}
            imageUrl={target.avatarUrl}
          />
          <div>
            <small>Message request</small>
            <h2 id="direct-message-request-title">
              Message {formatPublicChatName(target.displayName)}
            </h2>
          </div>
          <button
            aria-label="Close"
            className={styles.close}
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </header>
        <p className={styles.intro}>
          You can send one introductory text. If accepted, this becomes the
          same private member conversation used for mutual follows.
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="direct-message-request-body">
            First message
          </label>
          <textarea
            disabled={busy}
            id="direct-message-request-body"
            maxLength={LIVE_ROOM_MESSAGE_MAX_LENGTH}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Introduce why you want to connect"
            ref={textareaRef}
            rows={5}
            value={body}
          />
          <div className={styles.meta}>
            <span>No links, files, images, or position cards.</span>
            <b>
              {body.length}/{LIVE_ROOM_MESSAGE_MAX_LENGTH}
            </b>
          </div>
          <aside className={styles.safety}>
            <AlertTriangle aria-hidden="true" size={16} />
            <span>
              Never send money, account details, wallet addresses, or join
              paid signal rooms based on a private message.
            </span>
          </aside>
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
          <footer>
            <button
              className={styles.cancel}
              disabled={busy}
              onClick={onCancel}
              type="button"
            >
              Cancel
            </button>
            <button
              className={styles.submit}
              disabled={busy || !body.trim()}
              type="submit"
            >
              <Send aria-hidden="true" size={16} />
              {busy ? "Sending…" : "Send request"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
