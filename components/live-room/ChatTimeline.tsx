"use client";

import { useState } from "react";
import {
  Ban,
  EyeOff,
  MessageCircle,
  MoreHorizontal,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import { getPlanDisplayName } from "@/lib/subscriptionPolicy";
import {
  LIVE_ROOM_REPORT_REASONS,
  type LiveRoomReportReason,
  type LiveRoomTimelineItem,
} from "@/lib/live-room/types";
import { formatEventTime } from "./CompanyEventCard";
import styles from "./LiveRoom.module.css";

type ChatTimelineProps = {
  canModerate?: boolean;
  currentProfileName: string;
  items: readonly LiveRoomTimelineItem[];
  messageActionId?: string | null;
  onBlock?: (messageId: string) => Promise<void>;
  onHide?: (messageId: string) => Promise<void>;
  onReport?: (
    messageId: string,
    reason: LiveRoomReportReason,
  ) => Promise<void>;
  onRetry?: () => void;
  state: "empty" | "error" | "loading" | "ready";
};

export function ChatTimeline({
  canModerate = false,
  currentProfileName,
  items,
  messageActionId,
  onBlock,
  onHide,
  onReport,
  onRetry,
  state,
}: ChatTimelineProps) {
  if (state === "loading") {
    return (
      <div aria-busy="true" className={styles.timelineState}>
        <span className={styles.loadingBar} />
        <span className={styles.loadingBar} />
        <span className={styles.loadingBar} />
        <strong>Loading room messages…</strong>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className={styles.timelineState} role="alert">
        <MessageCircle aria-hidden="true" size={22} />
        <strong>Messages could not be loaded.</strong>
        <span>Check the connection and try again.</span>
        {onRetry ? (
          <button onClick={onRetry} type="button">
            Retry
          </button>
        ) : null}
      </div>
    );
  }

  if (state === "empty" || !items.length) {
    return (
      <div className={styles.timelineState}>
        <MessageCircle aria-hidden="true" size={22} />
        <strong>Start this company discussion.</strong>
        <span>Mention an event or share the first view.</span>
      </div>
    );
  }

  return (
    <ol aria-label="Live Room messages" className={styles.timelineList}>
      {items.map((item) => {
        if (item.kind === "company_update") {
          return (
            <li className={styles.systemUpdate} key={item.id}>
              <div>
                <Sparkles aria-hidden="true" size={14} />
                <strong>New company update</strong>
                <time dateTime={item.createdAt}>
                  {formatMessageTime(item.createdAt)}
                </time>
              </div>
              <span>{item.event.kind === "filing" ? "Filing" : "News"}</span>
              <p>{item.event.title}</p>
              <small>
                {item.event.signal} · score{" "}
                <b
                  data-score-tone={getDirectionalScoreTone(
                    item.event.score,
                    item.event.signal,
                  )}
                >
                  {item.event.score === null ? "—" : item.event.score}
                </b>{" "}
                ·{" "}
                {formatEventTime(item.event.occurredAt)}
              </small>
            </li>
          );
        }

        const mine =
          item.isMine === true ||
          (item.isMine === undefined &&
            item.author.isGuest &&
            item.author.displayName === currentProfileName);
        return (
          <li
            className={mine ? styles.myMessage : styles.otherMessage}
            key={item.id}
          >
            <div className={styles.messageAvatar} aria-hidden="true">
              {item.author.emoji}
            </div>
            <article>
              <header>
                <strong>{item.author.displayName}</strong>
                <span>{getPlanDisplayName(item.author.plan)}</span>
                {item.author.isGuest ? <small>Guest</small> : null}
                <time dateTime={item.createdAt}>
                  {formatMessageTime(item.createdAt)}
                </time>
                <MessageActions
                  busy={messageActionId === item.id}
                  canBlock={!mine && Boolean(onBlock)}
                  canHide={canModerate && Boolean(onHide)}
                  messageId={item.id}
                  onBlock={onBlock}
                  onHide={onHide}
                  onReport={onReport}
                />
              </header>
              {item.eventReference ? (
                <div className={styles.messageReference}>
                  <span>
                    {item.eventReference.kind === "filing" ? "Filing" : "News"}
                  </span>
                  <strong>{item.eventReference.title}</strong>
                </div>
              ) : null}
              <p>{item.body}</p>
            </article>
          </li>
        );
      })}
    </ol>
  );
}

function MessageActions({
  busy,
  canBlock,
  canHide,
  messageId,
  onBlock,
  onHide,
  onReport,
}: {
  busy: boolean;
  canBlock: boolean;
  canHide: boolean;
  messageId: string;
  onBlock?: (messageId: string) => Promise<void>;
  onHide?: (messageId: string) => Promise<void>;
  onReport?: (
    messageId: string,
    reason: LiveRoomReportReason,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      setOpen(false);
      setReportOpen(false);
    } catch {
      // The room-level notice presents the server-owned error message.
    }
  };

  return (
    <div className={styles.messageActions}>
      <button
        aria-expanded={open}
        aria-label="Message actions"
        className={styles.messageActionsTrigger}
        disabled={busy}
        onClick={() => {
          setOpen((value) => !value);
          setReportOpen(false);
        }}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div className={styles.messageActionsMenu} role="menu">
          {onReport ? (
            <>
              <button
                aria-expanded={reportOpen}
                onClick={() => setReportOpen((value) => !value)}
                role="menuitem"
                type="button"
              >
                <ShieldAlert aria-hidden="true" size={14} />
                Report
              </button>
              {reportOpen ? (
                <div
                  aria-label="Report reason"
                  className={styles.reportReasons}
                >
                  {LIVE_ROOM_REPORT_REASONS.map((reason) => (
                    <button
                      disabled={busy}
                      key={reason}
                      onClick={() =>
                        void run(() => onReport(messageId, reason))
                      }
                      type="button"
                    >
                      {formatReportReason(reason)}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          {canBlock && onBlock ? (
            <button
              disabled={busy}
              onClick={() => void run(() => onBlock(messageId))}
              role="menuitem"
              type="button"
            >
              <Ban aria-hidden="true" size={14} />
              Block author
            </button>
          ) : null}
          {canHide && onHide ? (
            <button
              disabled={busy}
              onClick={() => void run(() => onHide(messageId))}
              role="menuitem"
              type="button"
            >
              <EyeOff aria-hidden="true" size={14} />
              Hide
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatReportReason(reason: LiveRoomReportReason) {
  if (reason === "misinformation") return "Misinformation";
  return reason.charAt(0).toUpperCase() + reason.slice(1);
}

function formatMessageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(date);
}
