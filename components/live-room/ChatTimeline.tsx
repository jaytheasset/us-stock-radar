"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Ban,
  EllipsisVertical,
  EyeOff,
  FileText,
  Heart,
  MessageCircle,
  ShieldAlert,
  Sparkles,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { MemberPlanBadge } from "@/components/ui/MemberPlanBadge";
import { getDirectionalScoreTone } from "@/lib/directionalScore";
import {
  LIVE_ROOM_REPORT_REASONS,
  type CompanyEvent,
  type LiveRoomChatMessage,
  type LiveRoomReportReason,
  type LiveRoomTimelineItem,
} from "@/lib/live-room/types";
import { formatEventTime } from "./CompanyEventCard";
import { CompanyEventSignalScore } from "./CompanyEventSignalScore";
import {
  PostDirectionBadge,
  PostSignalChips,
} from "./PostSignals";
import directionSurfaceStyles from "./PostDirectionSurface.module.css";
import styles from "./LiveRoom.module.css";

const EMPTY_MESSAGE_LIKE_IDS: ReadonlySet<string> = new Set();

type ChatTimelineProps = {
  ariaLabel?: string;
  canModerate?: boolean;
  currentProfileName: string;
  emptyDescription?: string;
  emptyTitle?: string;
  firstUnreadMessageId?: string | null;
  highlightedMessageId?: string | null;
  items: readonly LiveRoomTimelineItem[];
  loginHref: string;
  messageActionId?: string | null;
  messageLikeIds?: ReadonlySet<string>;
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
  onToggleMessageLike?: (
    message: LiveRoomChatMessage,
    liked: boolean,
  ) => Promise<void>;
  onRetry?: () => void;
  state: "empty" | "error" | "loading" | "ready";
  viewerIsGuest: boolean;
};

export function LatestChatEventStrip({ event }: { event: CompanyEvent }) {
  if (!event.detailHref) {
    return null;
  }

  return (
    <Link
      aria-label={`Open analysis for latest company update: ${event.title}`}
      className={styles.latestChatEventStrip}
      href={event.detailHref}
    >
      <span
        className={styles.latestChatEventKind}
        data-kind={event.kind}
      >
        {event.kind === "filing" ? "Filing" : "News"}
      </span>
      <span className={styles.latestChatEventCopy}>
        <small>Latest company update</small>
        <strong>{event.title}</strong>
        <span className={styles.latestChatEventDetails}>
          <CompanyEventSignalScore
            score={event.score}
            signal={event.signal}
          />
          <time dateTime={event.occurredAt}>
            {formatEventTime(event.occurredAt)}
          </time>
        </span>
      </span>
      <ArrowUpRight aria-hidden="true" size={14} />
    </Link>
  );
}

export function ChatTimeline({
  ariaLabel = "Live Room messages",
  canModerate = false,
  currentProfileName,
  emptyDescription = "Mention an event or share the first view.",
  emptyTitle = "Start this company discussion.",
  firstUnreadMessageId = null,
  highlightedMessageId,
  items,
  loginHref,
  messageActionId,
  messageLikeIds = EMPTY_MESSAGE_LIKE_IDS,
  onBlock,
  onHide,
  onMessageMember,
  onOpenReplyTarget,
  onReply,
  onReport,
  onToggleMemberFollow,
  onToggleMessageLike,
  onRetry,
  state,
  viewerIsGuest,
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
        const unreadDivider =
          item.kind === "message" &&
          item.id === firstUnreadMessageId ? (
            <li
              aria-label="New messages"
              className={styles.newMessagesDivider}
            >
              <span>New messages</span>
            </li>
          ) : null;
        if (item.kind === "company_update") {
          return (
            <Fragment key={item.id}>
              {unreadDivider}
              <li className={styles.systemUpdate}>
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
            </Fragment>
          );
        }

        if (item.kind === "post_preview") {
          return (
            <Fragment key={item.id}>
              {unreadDivider}
              <li
                className={`${styles.postPreview} ${directionSurfaceStyles.surface}`}
                data-direction={item.direction ?? "unspecified"}
              >
              <div className={styles.postPreviewIcon}>
                <FileText aria-hidden="true" size={17} />
              </div>
              <div className={styles.postPreviewContent}>
                <span className={styles.postPreviewLabel}>POST</span>
                {item.direction || item.signalLabels.length ? (
                  <div className={styles.postPreviewTaxonomy}>
                    <PostDirectionBadge direction={item.direction} />
                    <PostSignalChips
                      maxVisible={1}
                      showOverflow={false}
                      signals={item.signalLabels}
                    />
                  </div>
                ) : null}
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
                  <span
                    aria-label={`${item.likeCount} likes`}
                    className={styles.postPreviewActivity}
                  >
                    <Heart
                      aria-hidden="true"
                      fill={item.isLiked ? "currentColor" : "none"}
                      size={12}
                    />
                    {item.likeCount}
                  </span>
                  <span
                    aria-label={`${item.commentCount} comments`}
                    className={styles.postPreviewActivity}
                  >
                    <MessageCircle aria-hidden="true" size={12} />
                    {item.commentCount}
                  </span>
                </div>
              </div>
              </li>
            </Fragment>
          );
        }

        const mine =
          item.isMine === true ||
          (item.isMine === undefined &&
            item.author.isGuest &&
            item.author.displayName === currentProfileName);
        const publicProfileHref =
          !item.author.isGuest && item.author.publicProfileId
            ? `/live/members/${encodeURIComponent(
                item.author.publicProfileId,
              )}`
            : null;
        return (
          <Fragment key={item.id}>
            {unreadDivider}
            <li
              className={`${mine ? styles.myMessage : styles.otherMessage}${
                highlightedMessageId === item.id
                  ? ` ${styles.highlightedMessage}`
                  : ""
              }`}
              id={`live-room-message-${item.id}`}
            >
            {publicProfileHref ? (
              <Link
                aria-label={`View ${item.author.displayName}'s public profile`}
                className={`${styles.messageAvatar} ${styles.messageAvatarLink}`}
                href={publicProfileHref}
              >
                <span aria-hidden="true">{item.author.emoji}</span>
              </Link>
            ) : (
              <div className={styles.messageAvatar} aria-hidden="true">
                {item.author.emoji}
              </div>
            )}
            <article>
              <header>
                {publicProfileHref ? (
                  <Link
                    className={styles.messageAuthorLink}
                    href={publicProfileHref}
                  >
                    {item.author.displayName}
                  </Link>
                ) : (
                  <strong>{item.author.displayName}</strong>
                )}
                <MemberPlanBadge
                  plan={item.author.isGuest ? "visitor" : item.author.plan}
                />
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
                <div className={styles.messageHeaderControls}>
                  <MessageEngagement
                    busy={messageLikeIds.has(item.id)}
                    item={item}
                    loginHref={loginHref}
                    onReply={onReply}
                    onToggleLike={onToggleMessageLike}
                    viewerIsGuest={viewerIsGuest}
                  />
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
                </div>
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
          </Fragment>
        );
      })}
    </ol>
  );
}

function MessageEngagement({
  busy,
  item,
  loginHref,
  onReply,
  onToggleLike,
  viewerIsGuest,
}: {
  busy: boolean;
  item: LiveRoomChatMessage;
  loginHref: string;
  onReply?: (message: LiveRoomChatMessage) => void;
  onToggleLike?: (
    message: LiveRoomChatMessage,
    liked: boolean,
  ) => Promise<void>;
  viewerIsGuest: boolean;
}) {
  const likeLabel = viewerIsGuest
    ? `${item.likeCount} likes. Sign in to like this message`
    : `${item.likeCount} likes. ${
        item.isLiked ? "Unlike" : "Like"
      } message from ${item.author.displayName}`;
  const replyLabel = viewerIsGuest
    ? `${item.replyCount} replies. Sign in to reply to ${item.author.displayName}`
    : `${item.replyCount} replies. Reply to ${item.author.displayName}`;
  const likeContent = (
    <>
      <Heart
        aria-hidden="true"
        fill={item.isLiked ? "currentColor" : "none"}
      />
      {item.likeCount > 0 ? <span>{item.likeCount}</span> : null}
    </>
  );
  const replyContent = (
    <>
      <MessageCircle aria-hidden="true" />
      {item.replyCount > 0 ? <span>{item.replyCount}</span> : null}
    </>
  );

  return (
    <div
      aria-label="Message engagement"
      className={styles.messageEngagement}
    >
      {viewerIsGuest ? (
        <Link
          aria-label={likeLabel}
          className={styles.messageEngagementControl}
          data-action="like"
          data-has-count={item.likeCount > 0}
          href={loginHref}
          title="Like"
        >
          {likeContent}
        </Link>
      ) : (
        <button
          aria-busy={busy}
          aria-label={likeLabel}
          className={styles.messageEngagementControl}
          data-action="like"
          data-has-count={item.likeCount > 0}
          disabled={busy}
          onClick={() => void onToggleLike?.(item, !item.isLiked)}
          title={item.isLiked ? "Unlike" : "Like"}
          type="button"
        >
          {likeContent}
        </button>
      )}
      {viewerIsGuest ? (
        <Link
          aria-label={replyLabel}
          className={styles.messageEngagementControl}
          data-action="reply"
          data-has-count={item.replyCount > 0}
          href={loginHref}
          title="Reply"
        >
          {replyContent}
        </Link>
      ) : (
        <button
          aria-label={replyLabel}
          className={styles.messageEngagementControl}
          data-action="reply"
          data-has-count={item.replyCount > 0}
          onClick={() => onReply?.(item)}
          title="Reply"
          type="button"
        >
          {replyContent}
        </button>
      )}
    </div>
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
  const hasActions = Boolean(
    onReport ||
      (canBlock && onBlock) ||
      (canFollowMember && onMemberFollow) ||
      (canMessageMember && onMessageMember) ||
      (canHide && onHide),
  );
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

  if (!hasActions) return null;

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
        <EllipsisVertical
          aria-hidden="true"
          size={12}
          strokeWidth={2}
        />
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
                <ShieldAlert
                  aria-hidden="true"
                  size={16}
                  strokeWidth={2.25}
                />
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
              <Ban
                aria-hidden="true"
                size={16}
                strokeWidth={2.25}
              />
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
                <UserCheck
                  aria-hidden="true"
                  size={16}
                  strokeWidth={2.25}
                />
              ) : (
                <UserPlus
                  aria-hidden="true"
                  size={16}
                  strokeWidth={2.25}
                />
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
              <MessageCircle
                aria-hidden="true"
                size={16}
                strokeWidth={2.25}
              />
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
              <EyeOff
                aria-hidden="true"
                size={16}
                strokeWidth={2.25}
              />
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
