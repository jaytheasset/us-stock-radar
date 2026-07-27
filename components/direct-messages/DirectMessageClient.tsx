"use client";

import Link from "next/link";
import { ArrowLeft, LockKeyhole, Send } from "lucide-react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import {
  DIRECT_MESSAGE_POLL_INTERVAL_MS,
  DirectMessageApiRepository,
  requestDirectMessageRefresh,
} from "@/lib/direct-messages/apiRepository";
import type {
  DirectMessage,
  DirectMessageConversation,
} from "@/lib/direct-messages/types";
import { LiveRoomApiError } from "@/lib/live-room/apiRepository";
import { LIVE_ROOM_MESSAGE_MAX_LENGTH } from "@/lib/live-room/moderation";
import { getPlanDisplayName } from "@/lib/subscriptionPolicy";
import styles from "./DirectMessage.module.css";

type DirectMessageClientProps = {
  conversationId: string;
};

export function DirectMessageClient({
  conversationId,
}: DirectMessageClientProps) {
  const [repository] = useState(
    () => new DirectMessageApiRepository(),
  );
  const requestIdRef = useRef(0);
  const lastMarkedReadIdRef = useRef<string | null>(null);
  const [conversation, setConversation] =
    useState<DirectMessageConversation | null>(null);
  const [state, setState] =
    useState<"error" | "loading" | "ready">("loading");
  const [error, setError] = useState<LiveRoomApiError | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const timelineRef = useRef<HTMLOListElement>(null);

  const refresh = useCallback(
    async (options: { quiet?: boolean } = {}) => {
      const requestId = ++requestIdRef.current;
      if (!options.quiet) setState("loading");
      try {
        const next = await repository.read(conversationId);
        if (requestId !== requestIdRef.current) return;
        setConversation((current) =>
          current
            ? {
                ...next,
                messages: mergeMessages(
                  current.messages,
                  next.messages,
                ),
              }
            : next,
        );
        setError(null);
        setState("ready");
      } catch (caught) {
        if (requestId !== requestIdRef.current) return;
        setError(toApiError(caught));
        setState("error");
      }
    },
    [conversationId, repository],
  );

  useEffect(() => {
    void refresh();
    const handleFocus = () => void refresh({ quiet: true });
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refresh({ quiet: true });
      }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh({ quiet: true });
      }
    }, DIRECT_MESSAGE_POLL_INTERVAL_MS);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      requestIdRef.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [refresh]);

  useEffect(() => {
    if (
      state !== "ready" ||
      !conversation?.messages.length ||
      document.visibilityState !== "visible"
    ) {
      return;
    }
    const latest = conversation.messages.at(-1);
    if (
      !latest ||
      latest.isMine ||
      lastMarkedReadIdRef.current === latest.id
    ) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (
        document.visibilityState !== "visible" ||
        !timelineRef.current?.querySelector(
          `[data-message-id="${latest.id}"]`,
        )
      ) {
        return;
      }
      void repository
        .markRead(conversationId, latest.id)
        .then(() => {
          lastMarkedReadIdRef.current = latest.id;
          requestDirectMessageRefresh();
        })
        .catch(() => undefined);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [conversation?.messages, conversationId, repository, state]);

  const handleSend = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!conversation?.canSend || sending || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      const message = await repository.send(
        conversationId,
        body,
      );
      setConversation((current) =>
        current
          ? {
              ...current,
              messages: mergeMessages(current.messages, [message]),
            }
          : current,
      );
      setBody("");
      requestDirectMessageRefresh();
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setSending(false);
    }
  };

  const handleLoadOlder = async () => {
    if (!conversation?.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await repository.read(conversationId, {
        before: conversation.nextCursor,
      });
      setConversation((current) =>
        current
          ? {
              ...current,
              messages: mergeMessages(
                page.messages,
                current.messages,
              ),
              nextCursor: page.nextCursor,
            }
          : current,
      );
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <StockRadarAppShell activeNavigationItem={null}>
      <section className={styles.page}>
        <header className={styles.header}>
          <Link href="/" className={styles.backLink}>
            <ArrowLeft aria-hidden="true" size={17} />
            Back
          </Link>
          <div className={styles.identity}>
            <span aria-hidden="true" className={styles.avatar}>
              {conversation?.peer.emoji || "💬"}
            </span>
            <span>
              <small>Member messages</small>
              <strong>
                {conversation?.peer.displayName ||
                  (state === "loading" ? "Loading…" : "Conversation")}
              </strong>
            </span>
          </div>
          {conversation ? (
            <div className={styles.relationship}>
              <span>
                {getPlanDisplayName(conversation.peer.plan)}
              </span>
              <span>
                {conversation.mutualFollow
                  ? "Mutual follow"
                  : "Not mutual"}
              </span>
            </div>
          ) : null}
        </header>

        <div className={styles.conversation}>
          {state === "loading" ? (
            <div aria-busy="true" className={styles.state}>
              Loading conversation…
            </div>
          ) : state === "error" && !conversation ? (
            <div className={styles.state} role="alert">
              <LockKeyhole aria-hidden="true" size={22} />
              <strong>{error?.message || "Conversation unavailable."}</strong>
              {error?.status === 401 ? (
                <Link
                  href={`/login?next=${encodeURIComponent(
                    `/messages/${conversationId}`,
                  )}`}
                >
                  Sign in
                </Link>
              ) : (
                <button onClick={() => void refresh()} type="button">
                  Retry
                </button>
              )}
            </div>
          ) : (
            <>
              {conversation?.nextCursor ? (
                <button
                  className={styles.loadOlder}
                  disabled={loadingOlder}
                  onClick={() => void handleLoadOlder()}
                  type="button"
                >
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </button>
              ) : null}
              {conversation?.messages.length ? (
                <ol
                  aria-label="Direct messages"
                  className={styles.timeline}
                  ref={timelineRef}
                >
                  {conversation.messages.map((message) => (
                    <li
                      className={
                        message.isMine ? styles.mine : styles.theirs
                      }
                      data-message-id={message.id}
                      key={message.id}
                    >
                      <p>{message.body}</p>
                      <time dateTime={message.createdAt}>
                        {formatMessageTime(message.createdAt)}
                      </time>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className={styles.state}>
                  <strong>Start the conversation.</strong>
                  <span>Only you and this member can read it.</span>
                </div>
              )}
            </>
          )}
        </div>

        {conversation && !conversation.canSend ? (
          <p className={styles.readOnlyNotice}>
            <LockKeyhole aria-hidden="true" size={15} />
            {conversation.readOnlyReason ||
              "This conversation is read-only."}
          </p>
        ) : null}
        {error && conversation ? (
          <p className={styles.inlineError} role="alert">
            {error.message}
          </p>
        ) : null}

        <form className={styles.composer} onSubmit={handleSend}>
          <label htmlFor="direct-message-body">
            Message {conversation?.peer.displayName || "member"}
          </label>
          <div>
            <textarea
              disabled={!conversation?.canSend || sending}
              id="direct-message-body"
              maxLength={LIVE_ROOM_MESSAGE_MAX_LENGTH}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                conversation?.canSend
                  ? "Write a private message"
                  : "Messaging requires a mutual follow"
              }
              rows={2}
              value={body}
            />
            <button
              aria-label="Send message"
              disabled={
                !conversation?.canSend || sending || !body.trim()
              }
              type="submit"
            >
              <Send aria-hidden="true" size={17} />
              <span>{sending ? "Sending…" : "Send"}</span>
            </button>
          </div>
          <small>
            {body.length}/{LIVE_ROOM_MESSAGE_MAX_LENGTH}
          </small>
        </form>
      </section>
    </StockRadarAppShell>
  );
}

function mergeMessages(
  first: readonly DirectMessage[],
  second: readonly DirectMessage[],
) {
  return [...new Map([...first, ...second].map((item) => [item.id, item])).values()]
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: "America/New_York",
  }).format(date);
}

function toApiError(error: unknown) {
  return error instanceof LiveRoomApiError
    ? error
    : new LiveRoomApiError(
        "LIVE_ROOM_DIRECT_REQUEST_FAILED",
        "Messages are temporarily unavailable.",
        0,
      );
}
