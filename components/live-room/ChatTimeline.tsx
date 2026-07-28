"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Ban,
  EyeOff,
  FileText,
  MessageCircle,
  MoreHorizontal,
  Reply as ReplyIcon,
  ShieldAlert,
  Sparkles,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import { getPlanDisplayName } from "@/lib/subscriptionPolicy";
import {
  LIVE_ROOM_REPORT_REASONS,
  type LiveRoomChatMessage,
  type LiveRoomReportReason,
  type LiveRoomTimelineItem,
} from "@/lib/live-room/types";
import { formatEventTime } from "./CompanyEventCard";
import styles from "./LiveRoom.module.css";

type ChatTimelineProps = {
  ariaLabel?: string;
  canModerate?: boolean;
  currentProfileName: string;
  emptyDescription?: string;
  emptyTitle?: string;
  highlightedMessageId?: string | null;
  items: readonly LiveRoomTimelineItem[];
  messageActionId?: string | null;
  onBlock?: (messageId: string) => Promise<void>;
  onHide?: (messageId: string) => Promise<void>;
  onMessageMember?: (messageId: string) => Promise<void>;
  onOpenReplyTarget?: (messageId: string) => void;
  onReply?: (message: LiveRoomChatMessage) => void;
  onReport?: (
    messageId: string,
    reason: LiveRoomReportReason,
  ) => Promise<void>;
  onToggleMemberFollow?: (
    messageId: string,
    followed: boolean,
  ) => Promise<void>;
  onRetry?: () => void;
  state: "empty" | "error" | "loading" | "ready";
};

export function ChatTimeline({
  ariaLabel = "Live Room messages",
  canModerate = false,
  currentProfileName,
  emptyDescription = "Mention an event or share the first view.",
  emptyTitle = "Start this company discussion.",
  highlightedMessageId,
  items,
  messageActionId,
  onBlock,
  onHide,
  onMessageMember,
  onOpenReplyTarget,
  onReply,
  onReport,
  onToggleMemberFollow,
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
        <strong>{emptyTitle}</strong>
        <span>{emptyDescription}</span>
      </div>
    );
  }

  const visibleMessageIds = new Set(
    items
      .filter((item) => item.kind === "message")
      .map((item) => item.id),
  );

  return (
    <ol aria-label={ariaLabel} className={styles.timelineList}>
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

        if (item.kind === "post_preview") {
          return (
            <li className={styles.postPreview} key={item.id}>
              <div className={styles.postPreviewIcon}>
                <FileText aria-hidden="true" size={17} />
              </div>
              <div className={styles.postPreviewContent}>
                <span className={styles.postPreviewLabel}>POST</span>
                <Link
                  className={styles.postPreviewTitle}
                  href={`/live/posts/${item.id}`}
                >
                  {item.title}
                </Link>
                <p className={styles.postPreviewExcerpt}>
                  {item.bodyPreview}
                </p>
                <div className={styles.postPreviewMeta}>
                  <Link
                    className={styles.postPreviewAuthor}
                    href={`/live/members/${item.author.publicProfileId}`}
                  >
                    <span aria-hidden="true">{item.author.emoji}</span>
                    <span>{item.author.displayName}</span>
                  </Link>
                  <time dateTime={item.createdAt}>
                    {formatMessageTime(item.createdAt)}
                  </time>
                </div>
              </div>
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
            className={`${mine ? styles.myMessage : styles.otherMessage}${
              highlightedMessageId === item.id
                ? ` ${styles.highlightedMessage}`
                : ""
            }`}
            id={`live-room-message-${item.id}`}
            key={item.id}
          >
            <div className={styles.messageAvatar} aria-hidden="true">
              {item.author.emoji}
            </div>
            <article>
              <header>
                <strong>{item.author.displayName}</strong>
                {!item.author.isGuest ? (
                  <span>{getPlanDisplayName(item.author.plan)}</span>
                ) : null}
                <time dateTime={item.createdAt}>
                  {formatMessageTime(item.createdAt)}
                </time>
                {item.author.socialBadges?.map((badge) => (
                  <a
                    aria-label={`${badge.label} profile for ${item.author.displayName}`}
                    className={styles.socialVerificationBadge}
                    href={badge.profileUrl}
                    key={badge.platform}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {badge.label}
                  </a>
                ))}
                {onReply ? (
                  <button
                    aria-label={`Reply to ${item.author.displayName}`}
                    className={styles.messageReplyButton}
                    onClick={() => onReply(item)}
                    type="button"
                  >
                    <ReplyIcon aria-hidden="true" size={15} />
                  </button>
                ) : null}
                <MessageActions
                  busy={messageActionId === item.id}
                  canBlock={!mine && Boolean(onBlock)}
                  canFollowMember={
                    item.canFollowMember === true &&
                    Boolean(onToggleMemberFollow)
                  }
                  canHide={canModerate && Boolean(onHide)}
                  canMessageMember={
                    item.canMessageMember === true &&
                    Boolean(onMessageMember)
                  }
                  memberFollowed={item.isMemberFollowed === true}
                  messageId={item.id}
                  onBlock={onBlock}
                  onMemberFollow={onToggleMemberFollow}
                  onHide={onHide}
                  onMessageMember={onMessageMember}
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
              {item.replyPreview ? (
                visibleMessageIds.has(item.replyPreview.messageId) &&
                onOpenReplyTarget ? (
                  <button
                    aria-label={`Go to message from ${item.replyPreview.authorDisplayName}`}
                    className={styles.messageReplyPreview}
                    onClick={() =>
                      onOpenReplyTarget(item.replyPreview!.messageId)
                    }
                    type="button"
                  >
                    <strong>
                      <span aria-hidden="true">
                        {item.replyPreview.authorEmoji}
                      </span>
                      {item.replyPreview.authorDisplayName}
                    </strong>
                    <span>{item.replyPreview.bodyPreview}</span>
                  </button>
                ) : (
                  <div className={styles.messageReplyPreview}>
                    <strong>
                      <span aria-hidden="true">
                        {item.replyPreview.authorEmoji}
                      </span>
                      {item.replyPreview.authorDisplayName}
                    </strong>
                    <span>{item.replyPreview.bodyPreview}</span>
                  </div>
                )
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
  canFollowMember,
  canHide,
  canMessageMember,
  memberFollowed,
  messageId,
  onBlock,
  onMemberFollow,
  onHide,
  onMessageMember,
  onReport,
}: {
  busy: boolean;
  canBlock: boolean;
  canFollowMember: boolean;
  canHide: boolean;
  canMessageMember: boolean;
  memberFollowed: boolean;
  messageId: string;
  onBlock?: (messageId: string) => Promise<void>;
  onMemberFollow?: (
    messageId: string,
    followed: boolean,
  ) => Promise<void>;
  onHide?: (messageId: string) => Promise<void>;
  onMessageMember?: (messageId: string) => Promise<void>;
  onReport?: (
    messageId: string,
    reason: LiveRoomReportReason,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setReportOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setReportOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

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
    <div className={styles.messageActions} ref={actionsRef}>
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
          {canFollowMember && onMemberFollow ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(() =>
                  onMemberFollow(messageId, !memberFollowed),
                )
              }
              role="menuitem"
              type="button"
            >
              {memberFollowed ? (
                <UserCheck aria-hidden="true" size={14} />
              ) : (
                <UserPlus aria-hidden="true" size={14} />
              )}
              {memberFollowed ? "Following" : "Follow member"}
            </button>
          ) : null}
          {canMessageMember && onMessageMember ? (
            <button
              disabled={busy}
              onClick={() =>
                void run(() => onMessageMember(messageId))
              }
              role="menuitem"
              type="button"
            >
              <MessageCircle aria-hidden="true" size={14} />
              Message member
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
