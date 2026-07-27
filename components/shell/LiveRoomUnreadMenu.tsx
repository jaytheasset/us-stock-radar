"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Ban,
  Check,
  MessageSquareText,
  MoreHorizontal,
  UserMinus,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  LIVE_ROOM_UNREAD_POLL_INTERVAL_MS,
  LIVE_ROOM_UNREAD_REFRESH_EVENT,
  LiveRoomApiRepository,
  readLiveRoomUnreadSummary,
} from "@/lib/live-room/apiRepository";
import {
  DIRECT_MESSAGE_POLL_INTERVAL_MS,
  DIRECT_MESSAGE_REFRESH_EVENT,
  DirectMessageApiRepository,
  requestDirectMessageRefresh,
} from "@/lib/direct-messages/apiRepository";
import type { DirectMessageInbox } from "@/lib/direct-messages/types";
import type {
  LiveRoomFollowedMember,
  LiveRoomMemberActivity,
  LiveRoomUnreadSummary,
} from "@/lib/live-room/types";
import { IconButton } from "@/components/ui/IconButton";
import styles from "./StockRadarProductHeader.module.css";

const emptySummary: LiveRoomUnreadSummary = {
  followedPeople: [],
  hasMemberFollows: false,
  isAuthenticated: false,
  people: [],
  peopleUnreadCount: 0,
  rooms: [],
  totalUnreadCount: 0,
};

const emptyDirectInbox: DirectMessageInbox = {
  conversations: [],
  incomingRequests: [],
  isAuthenticated: false,
  outgoingRequests: [],
  pendingRequestCount: 0,
  totalUnreadCount: 0,
};

type InboxTab = "messages" | "people" | "rooms";

export function LiveRoomUnreadMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const [summary, setSummary] =
    useState<LiveRoomUnreadSummary>(emptySummary);
  const [directInbox, setDirectInbox] =
    useState<DirectMessageInbox>(emptyDirectInbox);
  const [activeTab, setActiveTab] = useState<InboxTab>("rooms");
  const [open, setOpen] = useState(false);
  const [openActionId, setOpenActionId] = useState<string | null>(
    null,
  );
  const [busyActionId, setBusyActionId] = useState<string | null>(
    null,
  );
  const [state, setState] =
    useState<"error" | "loading" | "ready">("loading");
  const [directState, setDirectState] =
    useState<"error" | "loading" | "ready">("loading");
  const containerRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);
  const directRequestIdRef = useRef(0);
  const [directRepository] = useState(
    () => new DirectMessageApiRepository(),
  );

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const nextSummary = await readLiveRoomUnreadSummary();
      if (requestId !== requestIdRef.current) return;
      setSummary(nextSummary);
      setState("ready");
    } catch {
      if (requestId === requestIdRef.current) setState("error");
    }
  }, []);

  const refreshDirectInbox = useCallback(async () => {
    const requestId = ++directRequestIdRef.current;
    try {
      const nextInbox = await directRepository.inbox();
      if (requestId !== directRequestIdRef.current) return;
      setDirectInbox(nextInbox);
      setDirectState("ready");
    } catch {
      if (requestId === directRequestIdRef.current) {
        setDirectState("error");
      }
    }
  }, [directRepository]);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  useEffect(() => {
    const handleFocus = () => void refresh();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const handleRequestedRefresh = () => void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, LIVE_ROOM_UNREAD_POLL_INTERVAL_MS);

    window.addEventListener("focus", handleFocus);
    window.addEventListener(
      LIVE_ROOM_UNREAD_REFRESH_EVENT,
      handleRequestedRefresh,
    );
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      requestIdRef.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener(
        LIVE_ROOM_UNREAD_REFRESH_EVENT,
        handleRequestedRefresh,
      );
      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [refresh]);

  useEffect(() => {
    if (!summary.isAuthenticated) {
      directRequestIdRef.current += 1;
      setDirectInbox(emptyDirectInbox);
      setDirectState("ready");
      return;
    }

    void refreshDirectInbox();
    const handleFocus = () => void refreshDirectInbox();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshDirectInbox();
      }
    };
    const handleRequestedRefresh = () => void refreshDirectInbox();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshDirectInbox();
      }
    }, DIRECT_MESSAGE_POLL_INTERVAL_MS);

    window.addEventListener("focus", handleFocus);
    window.addEventListener(
      DIRECT_MESSAGE_REFRESH_EVENT,
      handleRequestedRefresh,
    );
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      directRequestIdRef.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener(
        DIRECT_MESSAGE_REFRESH_EVENT,
        handleRequestedRefresh,
      );
      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
    };
  }, [refreshDirectInbox, summary.isAuthenticated]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setOpenActionId(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (openActionId) {
          setOpenActionId(null);
        } else {
          setOpen(false);
        }
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, openActionId]);

  const handleUnfollow = async (target: LiveRoomFollowedMember) => {
    setBusyActionId(target.messageId);
    try {
      const repository = new LiveRoomApiRepository(target.ticker);
      await repository.writeMemberFollow({
        followed: false,
        messageId: target.messageId,
      });
      setOpenActionId(null);
      await refresh();
    } catch {
      setState("error");
    } finally {
      setBusyActionId(null);
    }
  };

  const handleDirectRequest = async (
    conversationId: string,
    action: "accept" | "block" | "decline",
  ) => {
    setBusyActionId(conversationId);
    try {
      const result = await directRepository.respond(
        conversationId,
        action,
      );
      requestDirectMessageRefresh();
      await refreshDirectInbox();
      if (result.status === "accepted" && result.conversationId) {
        setOpen(false);
        router.push(
          `/messages/${encodeURIComponent(result.conversationId)}`,
        );
      }
    } catch {
      setDirectState("error");
    } finally {
      setBusyActionId(null);
    }
  };

  const total =
    summary.totalUnreadCount + directInbox.totalUnreadCount;
  const countLabel = total > 99 ? "99+" : String(total);
  const roomsUnreadCount = summary.rooms.reduce(
    (count, room) => count + room.unreadCount,
    0,
  );

  return (
    <div className={styles.liveRoomInbox} ref={containerRef}>
      <IconButton
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          total
            ? `Live Room activity, ${total} unread`
            : "Live Room activity"
        }
        className={styles.liveRoomInboxButton}
        onClick={() => {
          setOpen((value) => !value);
          setOpenActionId(null);
          if (!open) void refresh();
          if (!open && summary.isAuthenticated) {
            void refreshDirectInbox();
          }
        }}
      >
        <MessageSquareText aria-hidden="true" size={18} />
        {total ? (
          <span
            aria-hidden="true"
            className={styles.liveRoomUnreadBadge}
          >
            {countLabel}
          </span>
        ) : null}
      </IconButton>

      {open ? (
        <div
          aria-label="Live Room activity"
          className={styles.liveRoomInboxPopover}
          role="dialog"
        >
          <div className={styles.liveRoomInboxHeading}>
            <div>
              <span>Live Room activity</span>
              <strong>
                {total ? `${total} unread items` : "All caught up"}
              </strong>
            </div>
            <small>Rooms + People + Messages</small>
          </div>

          <div
            aria-label="Live Room activity sections"
            className={styles.liveRoomInboxTabs}
            role="tablist"
          >
            <button
              aria-controls="live-room-inbox-panel"
              aria-selected={activeTab === "rooms"}
              id="live-room-inbox-tab-rooms"
              onClick={() => setActiveTab("rooms")}
              role="tab"
              type="button"
            >
              Rooms
              {roomsUnreadCount ? (
                <b>{formatUnreadCount(roomsUnreadCount)}</b>
              ) : null}
            </button>
            <button
              aria-controls="live-room-inbox-panel"
              aria-selected={activeTab === "people"}
              id="live-room-inbox-tab-people"
              onClick={() => setActiveTab("people")}
              role="tab"
              type="button"
            >
              People
              {summary.peopleUnreadCount ? (
                <b>
                  {formatUnreadCount(summary.peopleUnreadCount)}
                </b>
              ) : null}
            </button>
            <button
              aria-controls="live-room-inbox-panel"
              aria-selected={activeTab === "messages"}
              id="live-room-inbox-tab-messages"
              onClick={() => setActiveTab("messages")}
              role="tab"
              type="button"
            >
              Messages
              {directInbox.totalUnreadCount ? (
                <b>
                  {formatUnreadCount(
                    directInbox.totalUnreadCount,
                  )}
                </b>
              ) : null}
            </button>
          </div>

          <div
            aria-labelledby={`live-room-inbox-tab-${activeTab}`}
            className={styles.liveRoomInboxPanel}
            id="live-room-inbox-panel"
            role="tabpanel"
          >
            {state === "loading" ? (
              <p className={styles.liveRoomInboxState}>
                Loading Live Room activity…
              </p>
            ) : activeTab === "rooms" ? (
              <RoomsPanel
                error={state === "error"}
                onNavigate={() => setOpen(false)}
                summary={summary}
              />
            ) : activeTab === "people" ? (
              <PeoplePanel
                busyActionId={busyActionId}
                error={state === "error"}
                onNavigate={() => setOpen(false)}
                onToggleAction={(messageId) =>
                  setOpenActionId((current) =>
                    current === messageId ? null : messageId,
                  )
                }
                onUnfollow={handleUnfollow}
                openActionId={openActionId}
                pathname={pathname}
                summary={summary}
              />
            ) : (
              <MessagesPanel
                busyActionId={busyActionId}
                error={directState === "error"}
                inbox={directInbox}
                loading={directState === "loading"}
                onNavigate={() => setOpen(false)}
                onRespond={handleDirectRequest}
                pathname={pathname}
                signedIn={summary.isAuthenticated}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MessagesPanel({
  busyActionId,
  error,
  inbox,
  loading,
  onNavigate,
  onRespond,
  pathname,
  signedIn,
}: {
  busyActionId: string | null;
  error: boolean;
  inbox: DirectMessageInbox;
  loading: boolean;
  onNavigate: () => void;
  onRespond: (
    conversationId: string,
    action: "accept" | "block" | "decline",
  ) => Promise<void>;
  pathname: string;
  signedIn: boolean;
}) {
  if (!signedIn) {
    return (
      <div className={styles.liveRoomInboxState}>
        <span>
          Sign in to chat with mutual follows or review member message
          requests.
        </span>
        <Link
          className={styles.liveRoomInboxSignIn}
          href={`/login?next=${encodeURIComponent(pathname || "/")}`}
        >
          Sign in
        </Link>
      </div>
    );
  }
  if (loading) {
    return (
      <p className={styles.liveRoomInboxState}>
        Loading member messages…
      </p>
    );
  }
  if (error) {
    return (
      <p className={styles.liveRoomInboxState}>
        Member messages could not be refreshed.
      </p>
    );
  }
  if (
    !inbox.conversations.length &&
    !inbox.incomingRequests.length &&
    !inbox.outgoingRequests.length
  ) {
    return (
      <p className={styles.liveRoomInboxState}>
        Open a registered member&apos;s Live Room message menu to start a
        conversation or send one request.
      </p>
    );
  }
  return (
    <div className={styles.liveRoomPeopleList}>
      {inbox.incomingRequests.length ? (
        <section className={styles.directRequestSection}>
          <h3>Message requests</h3>
          {inbox.incomingRequests.map((request) => (
            <article
              className={styles.directRequestCard}
              key={request.conversationId}
            >
              <div className={styles.directRequestIdentity}>
                <span
                  aria-hidden="true"
                  className={styles.liveRoomPeopleEmoji}
                >
                  {request.peer.emoji}
                </span>
                <span>
                  <strong>{request.peer.displayName}</strong>
                  {request.createdAt ? (
                    <time dateTime={request.createdAt}>
                      {formatActivityTime(request.createdAt)}
                    </time>
                  ) : null}
                </span>
              </div>
              <p>{request.bodyPreview}</p>
              {request.riskFlags.length ? (
                <small className={styles.directRequestWarning}>
                  Safety warning: review off-platform, payment, or guarantee
                  language carefully.
                </small>
              ) : null}
              <div className={styles.directRequestActions}>
                <button
                  disabled={busyActionId === request.conversationId}
                  onClick={() =>
                    void onRespond(request.conversationId, "accept")
                  }
                  type="button"
                >
                  <Check aria-hidden="true" size={13} /> Accept
                </button>
                <button
                  disabled={busyActionId === request.conversationId}
                  onClick={() =>
                    void onRespond(request.conversationId, "decline")
                  }
                  type="button"
                >
                  <X aria-hidden="true" size={13} /> Decline
                </button>
                <button
                  disabled={busyActionId === request.conversationId}
                  onClick={() =>
                    void onRespond(request.conversationId, "block")
                  }
                  type="button"
                >
                  <Ban aria-hidden="true" size={13} /> Block
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : null}
      {inbox.outgoingRequests.length ? (
        <section className={styles.directRequestSection}>
          <h3>Sent requests</h3>
          {inbox.outgoingRequests.map((request) => (
            <Link
              className={styles.directOutgoingRequest}
              href={`/messages/${encodeURIComponent(
                request.conversationId,
              )}`}
              key={request.conversationId}
              onClick={onNavigate}
            >
              <span
                aria-hidden="true"
                className={styles.liveRoomPeopleEmoji}
              >
                {request.peer.emoji}
              </span>
              <span className={styles.liveRoomPeopleCopy}>
                <span>
                  <strong>{request.peer.displayName}</strong>
                  <b>Pending</b>
                </span>
                <small>{request.bodyPreview}</small>
              </span>
            </Link>
          ))}
        </section>
      ) : null}
      {inbox.conversations.length ? (
        <h3 className={styles.directConversationHeading}>Conversations</h3>
      ) : null}
      {inbox.conversations.map((conversation) => (
        <div
          className={styles.liveRoomPeopleItem}
          key={conversation.conversationId}
        >
          <Link
            href={`/messages/${encodeURIComponent(
              conversation.conversationId,
            )}`}
            onClick={onNavigate}
          >
            <span
              aria-hidden="true"
              className={styles.liveRoomPeopleEmoji}
            >
              {conversation.peer.emoji}
            </span>
            <span className={styles.liveRoomPeopleCopy}>
              <span>
                <strong>{conversation.peer.displayName}</strong>
                {conversation.latestCreatedAt ? (
                  <time dateTime={conversation.latestCreatedAt}>
                    {formatActivityTime(
                      conversation.latestCreatedAt,
                    )}
                  </time>
                ) : null}
              </span>
              <small>
                {conversation.latestBodyPreview ||
                  "Conversation ready"}
              </small>
            </span>
            {conversation.unreadCount ? (
              <b>
                {formatUnreadCount(conversation.unreadCount)}
              </b>
            ) : null}
          </Link>
        </div>
      ))}
    </div>
  );
}

function RoomsPanel({
  error,
  onNavigate,
  summary,
}: {
  error: boolean;
  onNavigate: () => void;
  summary: LiveRoomUnreadSummary;
}) {
  if (!summary.rooms.length) {
    return (
      <p className={styles.liveRoomInboxState}>
        {error
          ? "Live Room chats could not be refreshed."
          : "Follow a company Live Room to see new chats here."}
      </p>
    );
  }
  return (
    <div className={styles.liveRoomInboxList}>
      {summary.rooms.map((room) => (
        <Link
          href={`/live/${encodeURIComponent(room.ticker)}`}
          key={room.ticker}
          onClick={onNavigate}
        >
          <span>
            <strong>{room.ticker}</strong>
            <small>Company Live Room</small>
          </span>
          {room.unreadCount ? (
            <b>{room.unreadCount}</b>
          ) : (
            <small>Read</small>
          )}
        </Link>
      ))}
    </div>
  );
}

function PeoplePanel({
  busyActionId,
  error,
  onNavigate,
  onToggleAction,
  onUnfollow,
  openActionId,
  pathname,
  summary,
}: {
  busyActionId: string | null;
  error: boolean;
  onNavigate: () => void;
  onToggleAction: (messageId: string) => void;
  onUnfollow: (target: LiveRoomFollowedMember) => Promise<void>;
  openActionId: string | null;
  pathname: string;
  summary: LiveRoomUnreadSummary;
}) {
  if (!summary.isAuthenticated) {
    return (
      <div className={styles.liveRoomInboxState}>
        <span>
          Sign in to follow members and see their new Live Room chats.
        </span>
        <Link
          className={styles.liveRoomInboxSignIn}
          href={`/login?next=${encodeURIComponent(pathname || "/")}`}
        >
          Sign in
        </Link>
      </div>
    );
  }
  if (error) {
    return (
      <p className={styles.liveRoomInboxState}>
        Member activity could not be refreshed.
      </p>
    );
  }
  if (!summary.hasMemberFollows) {
    return (
      <p className={styles.liveRoomInboxState}>
        Follow a registered member from a message menu to see their
        activity here.
      </p>
    );
  }
  if (!summary.people.length) {
    return (
      <>
        <p
          className={`${styles.liveRoomInboxState} ${styles.liveRoomInboxStateCompact}`}
        >
          No new chats from people you follow.
        </p>
        <div
          aria-label="People you follow"
          className={styles.liveRoomFollowedPeopleList}
        >
          {summary.followedPeople.map((person) => (
            <FollowedPersonRow
              busy={busyActionId === person.messageId}
              key={person.messageId}
              onToggleAction={() => onToggleAction(person.messageId)}
              onUnfollow={() => onUnfollow(person)}
              open={openActionId === person.messageId}
              person={person}
            />
          ))}
        </div>
      </>
    );
  }
  return (
    <div className={styles.liveRoomPeopleList}>
      {summary.people.map((activity) => (
        <div
          className={styles.liveRoomPeopleItem}
          key={activity.messageId}
        >
          <Link
            href={`/live/${encodeURIComponent(
              activity.ticker,
            )}?message=${encodeURIComponent(activity.messageId)}`}
            onClick={onNavigate}
          >
            <span
              aria-hidden="true"
              className={styles.liveRoomPeopleEmoji}
            >
              {activity.authorEmoji}
            </span>
            <span className={styles.liveRoomPeopleCopy}>
              <span>
                <strong>{activity.authorDisplayName}</strong>
                <b>{activity.ticker}</b>
                <time dateTime={activity.createdAt}>
                  {formatActivityTime(activity.createdAt)}
                </time>
              </span>
              <small>{activity.bodyPreview}</small>
            </span>
          </Link>
          <div className={styles.liveRoomPeopleActions}>
            <button
              aria-expanded={openActionId === activity.messageId}
              aria-label={`Actions for ${activity.authorDisplayName}`}
              className={styles.liveRoomPeopleActionTrigger}
              disabled={busyActionId === activity.messageId}
              onClick={() => onToggleAction(activity.messageId)}
              type="button"
            >
              <MoreHorizontal aria-hidden="true" size={15} />
            </button>
            {openActionId === activity.messageId ? (
              <div
                className={styles.liveRoomPeopleActionMenu}
                role="menu"
              >
                <button
                  disabled={busyActionId === activity.messageId}
                  onClick={() => void onUnfollow(activity)}
                  role="menuitem"
                  type="button"
                >
                  <UserMinus aria-hidden="true" size={14} />
                  Unfollow member
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function FollowedPersonRow({
  busy,
  onToggleAction,
  onUnfollow,
  open,
  person,
}: {
  busy: boolean;
  onToggleAction: () => void;
  onUnfollow: () => Promise<void>;
  open: boolean;
  person: LiveRoomFollowedMember;
}) {
  return (
    <div className={styles.liveRoomFollowedPerson}>
      <span aria-hidden="true" className={styles.liveRoomPeopleEmoji}>
        {person.authorEmoji}
      </span>
      <span>
        <strong>{person.authorDisplayName}</strong>
        <small>Following · latest in {person.ticker}</small>
      </span>
      <div className={styles.liveRoomPeopleActions}>
        <button
          aria-expanded={open}
          aria-label={`Actions for ${person.authorDisplayName}`}
          className={styles.liveRoomPeopleActionTrigger}
          disabled={busy}
          onClick={onToggleAction}
          type="button"
        >
          <MoreHorizontal aria-hidden="true" size={15} />
        </button>
        {open ? (
          <div className={styles.liveRoomPeopleActionMenu} role="menu">
            <button
              disabled={busy}
              onClick={() => void onUnfollow()}
              role="menuitem"
              type="button"
            >
              <UserMinus aria-hidden="true" size={14} />
              Unfollow member
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatActivityTime(value: string) {
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

function formatUnreadCount(value: number) {
  return value > 99 ? "99+" : String(value);
}
