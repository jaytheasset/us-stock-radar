"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Check,
  Flag,
  LockKeyhole,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
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
  DirectMessageReportReason,
} from "@/lib/direct-messages/types";
import { DIRECT_MESSAGE_REPORT_REASONS } from "@/lib/direct-messages/types";
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
  const router = useRouter();
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
  const [requestAction, setRequestAction] = useState<
    "accept" | "block" | "decline" | null
  >(null);
  const [reportMessageId, setReportMessageId] = useState<string | null>(
    null,
  );
  const [reportedMessageIds, setReportedMessageIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [notice, setNotice] = useState("");
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
      conversation?.status !== "accepted" ||
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

  const handleRequestAction = async (
    action: "accept" | "block" | "decline",
  ) => {
    if (requestAction) return;
    setRequestAction(action);
    setError(null);
    try {
      const result = await repository.respond(conversationId, action);
      requestDirectMessageRefresh();
      if (result.status === "accepted") {
        setNotice("Message request accepted.");
        await refresh({ quiet: true });
      } else {
        router.push("/");
      }
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setRequestAction(null);
    }
  };

  const handleReport = async (
    messageId: string,
    reason: DirectMessageReportReason,
  ) => {
    try {
      await repository.report(conversationId, messageId, reason);
      setReportedMessageIds((current) => new Set(current).add(messageId));
      setReportMessageId(null);
      setNotice("Message reported for review.");
    } catch (caught) {
      setError(toApiError(caught));
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
                {conversation.status === "pending"
                  ? "Message request"
                  : conversation.mutualFollow
                    ? "Mutual follow"
                    : "Accepted conversation"}
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
                    <DirectMessageBubble
                      message={message}
                      onReport={handleReport}
                      onToggleReport={() =>
                        setReportMessageId((current) =>
                          current === message.id ? null : message.id,
                        )
                      }
                      reportOpen={reportMessageId === message.id}
                      reported={reportedMessageIds.has(message.id)}
                      key={message.id}
                    />
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

        {conversation?.canRespond ? (
          <div className={styles.requestActions}>
            <div>
              <strong>Review this message request</strong>
              <span>
                Accept to continue in this conversation, decline silently, or
                block the member.
              </span>
            </div>
            <div>
              <button
                disabled={requestAction !== null}
                onClick={() => void handleRequestAction("accept")}
                type="button"
              >
                <Check aria-hidden="true" size={15} /> Accept
              </button>
              <button
                disabled={requestAction !== null}
                onClick={() => void handleRequestAction("decline")}
                type="button"
              >
                <X aria-hidden="true" size={15} /> Decline
              </button>
              <button
                disabled={requestAction !== null}
                onClick={() => void handleRequestAction("block")}
                type="button"
              >
                <Ban aria-hidden="true" size={15} /> Block
              </button>
            </div>
          </div>
        ) : null}
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
        {notice ? (
          <p aria-live="polite" className={styles.inlineNotice}>
            {notice}
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
                  : conversation?.requestRole === "sender"
                    ? "Request pending"
                    : "Accept the request to reply"
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

function DirectMessageBubble({
  message,
  onReport,
  onToggleReport,
  reportOpen,
  reported,
}: {
  message: DirectMessage;
  onReport: (
    messageId: string,
    reason: DirectMessageReportReason,
  ) => Promise<void>;
  onToggleReport: () => void;
  reportOpen: boolean;
  reported: boolean;
}) {
  return (
    <li
      className={message.isMine ? styles.mine : styles.theirs}
      data-message-id={message.id}
    >
      {message.kind === "request" ? (
        <small className={styles.requestLabel}>Message request</small>
      ) : null}
      <p>{message.body}</p>
      {!message.isMine && message.riskFlags.length ? (
        <aside className={styles.riskWarning}>
          <ShieldAlert aria-hidden="true" size={15} />
          <span>
            Safety warning: this message contains{" "}
            {formatRiskFlags(message.riskFlags)}. Verify independently and
            report suspicious requests.
          </span>
        </aside>
      ) : null}
      <div className={styles.messageMeta}>
        <time dateTime={message.createdAt}>
          {formatMessageTime(message.createdAt)}
        </time>
        {!message.isMine ? (
          <div className={styles.reportControl}>
            <button
              aria-expanded={reportOpen}
              disabled={reported}
              onClick={onToggleReport}
              type="button"
            >
              <Flag aria-hidden="true" size={12} />
              {reported ? "Reported" : "Report"}
            </button>
            {reportOpen ? (
              <div className={styles.reportMenu}>
                {DIRECT_MESSAGE_REPORT_REASONS.map((reason) => (
                  <button
                    key={reason}
                    onClick={() => void onReport(message.id, reason)}
                    type="button"
                  >
                    {formatReportReason(reason)}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
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

function formatRiskFlags(flags: DirectMessage["riskFlags"]) {
  const labels = flags.map((flag) => {
    if (flag === "off_platform_contact") return "off-platform contact";
    if (flag === "money_transfer") return "money-transfer language";
    if (flag === "guaranteed_return") return "return guarantees";
    if (flag === "paid_room") return "a paid or VIP room";
    if (flag === "crypto_wallet") return "crypto transfer details";
    return "repeated contact details";
  });
  return new Intl.ListFormat("en-US", {
    style: "long",
    type: "conjunction",
  }).format(labels);
}

function formatReportReason(reason: DirectMessageReportReason) {
  if (reason === "misinformation") return "Misinformation";
  return reason.charAt(0).toUpperCase() + reason.slice(1);
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
