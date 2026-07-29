"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Ban,
  BellRing,
  Bookmark,
  Check,
  ChevronRight,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import { MemberPlanBadge } from "@/components/ui/MemberPlanBadge";
import { CommunityHubApiRepository } from "@/lib/community-hub/apiRepository";
import type {
  CommunityHubPeopleFilter,
  CommunityHubPeoplePage,
  CommunityHubPerson,
  CommunityHubRoom,
  CommunityHubRoomsPage,
} from "@/lib/community-hub/types";
import {
  DirectMessageApiRepository,
  requestDirectMessageRefresh,
} from "@/lib/direct-messages/apiRepository";
import type { DirectMessageInbox } from "@/lib/direct-messages/types";
import {
  LiveRoomApiRepository,
  markLiveRoomPostActivityRead,
  readLiveRoomUnreadSummary,
  requestLiveRoomUnreadRefresh,
} from "@/lib/live-room/apiRepository";
import type {
  LiveRoomPostActivity,
  LiveRoomUnreadSummary,
} from "@/lib/live-room/types";
import styles from "./CommunityHub.module.css";

type HubTab = "activity" | "inbox" | "people" | "rooms";
type LoadState = "error" | "loading" | "ready";

const emptySummary: LiveRoomUnreadSummary = {
  activity: [],
  activityUnreadCount: 0,
  followedPeople: [],
  hasMemberFollows: false,
  isAuthenticated: true,
  people: [],
  peopleUnreadCount: 0,
  rooms: [],
  totalUnreadCount: 0,
};

const emptyInbox: DirectMessageInbox = {
  conversations: [],
  incomingRequests: [],
  isAuthenticated: true,
  outgoingRequests: [],
  pendingRequestCount: 0,
  totalUnreadCount: 0,
};

const emptyPeoplePage: CommunityHubPeoplePage = {
  counts: { followers: 0, following: 0, mutual: 0 },
  items: [],
  nextCursor: null,
};

const emptyRoomsPage: CommunityHubRoomsPage = {
  items: [],
  nextCursor: null,
  totalUnreadCount: 0,
};

export function CommunityHubClient() {
  const router = useRouter();
  const [communityRepository] = useState(
    () => new CommunityHubApiRepository(),
  );
  const [directRepository] = useState(
    () => new DirectMessageApiRepository(),
  );
  const [activeTab, setActiveTab] = useState<HubTab>("inbox");
  const [summary, setSummary] = useState(emptySummary);
  const [summaryState, setSummaryState] =
    useState<LoadState>("loading");
  const [inbox, setInbox] = useState(emptyInbox);
  const [inboxState, setInboxState] =
    useState<LoadState>("loading");
  const [peopleFilter, setPeopleFilter] =
    useState<CommunityHubPeopleFilter>("following");
  const [peoplePage, setPeoplePage] = useState(emptyPeoplePage);
  const [peopleState, setPeopleState] =
    useState<LoadState>("loading");
  const [roomsPage, setRoomsPage] = useState(emptyRoomsPage);
  const [roomsState, setRoomsState] =
    useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    try {
      setSummary(await readLiveRoomUnreadSummary());
      setSummaryState("ready");
    } catch {
      setSummaryState("error");
    }
  }, []);

  const refreshInbox = useCallback(async () => {
    try {
      setInbox(await directRepository.inbox());
      setInboxState("ready");
    } catch {
      setInboxState("error");
    }
  }, [directRepository]);

  const refreshPeople = useCallback(
    async (filter: CommunityHubPeopleFilter) => {
      try {
        setPeoplePage(await communityRepository.people(filter));
        setPeopleState("ready");
      } catch {
        setPeopleState("error");
      }
    },
    [communityRepository],
  );

  const refreshRooms = useCallback(async () => {
    try {
      setRoomsPage(await communityRepository.rooms());
      setRoomsState("ready");
    } catch {
      setRoomsState("error");
    }
  }, [communityRepository]);

  useEffect(() => {
    void Promise.all([
      refreshSummary(),
      refreshInbox(),
      refreshRooms(),
    ]);
  }, [refreshInbox, refreshRooms, refreshSummary]);

  useEffect(() => {
    setPeopleState("loading");
    void refreshPeople(peopleFilter);
  }, [peopleFilter, refreshPeople]);

  const tabs = [
    {
      count: inbox.totalUnreadCount,
      label: "Inbox",
      value: "inbox" as const,
    },
    {
      count: peoplePage.counts.followers,
      label: "People",
      value: "people" as const,
    },
    {
      count: roomsPage.totalUnreadCount,
      label: "Rooms",
      value: "rooms" as const,
    },
    {
      count: summary.activityUnreadCount,
      label: "Activity",
      value: "activity" as const,
    },
  ];

  const handleRespond = async (
    conversationId: string,
    action: "accept" | "block" | "decline",
  ) => {
    setBusyId(conversationId);
    setNotice(null);
    try {
      const result = await directRepository.respond(
        conversationId,
        action,
      );
      requestDirectMessageRefresh();
      await refreshInbox();
      if (result.status === "accepted" && result.conversationId) {
        router.push(
          `/messages/${encodeURIComponent(result.conversationId)}`,
        );
      } else {
        setNotice(
          action === "block"
            ? "Member blocked and request removed."
            : "Message request declined.",
        );
      }
    } catch {
      setNotice("The message request could not be updated.");
      setInboxState("error");
    } finally {
      setBusyId(null);
    }
  };

  const handleActivity = async (activity: LiveRoomPostActivity) => {
    setBusyId(activity.activityId);
    setSummary((current) => ({
      ...current,
      activity: current.activity.map((item) =>
        item.activityId === activity.activityId
          ? { ...item, isRead: true }
          : item,
      ),
      activityUnreadCount: activity.isRead
        ? current.activityUnreadCount
        : Math.max(0, current.activityUnreadCount - 1),
    }));
    try {
      if (!activity.isRead) {
        await markLiveRoomPostActivityRead(activity.activityId);
        requestLiveRoomUnreadRefresh();
      }
    } catch {
      setNotice("Activity read status will retry on the next refresh.");
    } finally {
      router.push(
        `/live/posts/${encodeURIComponent(activity.postId)}#comments`,
      );
      setBusyId(null);
    }
  };

  const handlePeoplePage = async () => {
    if (!peoplePage.nextCursor) return;
    setBusyId("people-page");
    try {
      const next = await communityRepository.people(
        peopleFilter,
        peoplePage.nextCursor,
      );
      setPeoplePage((current) => ({
        ...next,
        items: [...current.items, ...next.items],
      }));
    } catch {
      setNotice("More people could not be loaded.");
    } finally {
      setBusyId(null);
    }
  };

  const handleMemberFollow = async (
    person: CommunityHubPerson,
    followed: boolean,
  ) => {
    setBusyId(person.publicProfileId);
    setNotice(null);
    try {
      await communityRepository.setMemberFollow(
        person.publicProfileId,
        followed,
      );
      await refreshPeople(peopleFilter);
      setNotice(followed ? "Member followed back." : "Member unfollowed.");
      requestLiveRoomUnreadRefresh();
    } catch {
      setNotice("The member follow could not be updated.");
    } finally {
      setBusyId(null);
    }
  };

  const handleMessage = async (person: CommunityHubPerson) => {
    if (!person.messageId) return;
    setBusyId(person.publicProfileId);
    setNotice(null);
    try {
      const result = await directRepository.start(person.messageId);
      if (result.conversationId) {
        router.push(
          `/messages/${encodeURIComponent(result.conversationId)}`,
        );
      } else {
        setNotice(
          "Open the member from a Live Room to send a message request.",
        );
      }
    } catch {
      setNotice("The conversation could not be opened.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRoomsPage = async () => {
    if (!roomsPage.nextCursor) return;
    setBusyId("rooms-page");
    try {
      const next = await communityRepository.rooms(
        roomsPage.nextCursor,
      );
      setRoomsPage((current) => ({
        ...next,
        items: [...current.items, ...next.items],
      }));
    } catch {
      setNotice("More joined rooms could not be loaded.");
    } finally {
      setBusyId(null);
    }
  };

  const handleRoomOpen = async (room: CommunityHubRoom) => {
    setBusyId(room.href);
    try {
      const repository = new LiveRoomApiRepository(
        room.kind === "company"
          ? { kind: "company", ticker: room.ticker! }
          : { kind: "community", slug: room.slug! },
      );
      await repository.markRead(null);
      requestLiveRoomUnreadRefresh();
    } catch {
      // Opening the room remains useful; its normal read reconciliation retries.
    } finally {
      router.push(room.href);
      setBusyId(null);
    }
  };

  return (
    <section className={styles.page}>
      <header className={styles.hero}>
        <div>
          <span>Community</span>
          <h1>Community &amp; Messages</h1>
          <p>
            Manage member conversations, people, joined rooms, and
            community activity in one place.
          </p>
        </div>
        <Link className={styles.settingsLink} href="/account/messages">
          Message privacy
          <ChevronRight aria-hidden="true" size={15} />
        </Link>
      </header>

      <div className={styles.separationNote}>
        <BellRing aria-hidden="true" size={16} />
        <span>
          Stock signal notifications stay in{" "}
          <Link href="/alerts">Alerts</Link>. This page contains only
          Community and member messages.
        </span>
      </div>

      <div
        aria-label="Community sections"
        className={styles.tabs}
        role="tablist"
      >
        {tabs.map((tab) => (
          <button
            aria-controls="community-hub-panel"
            aria-selected={activeTab === tab.value}
            id={`community-hub-tab-${tab.value}`}
            key={tab.value}
            onClick={() => {
              setActiveTab(tab.value);
              setNotice(null);
            }}
            role="tab"
            type="button"
          >
            {tab.label}
            {tab.count ? <b>{formatCount(tab.count)}</b> : null}
          </button>
        ))}
      </div>

      {notice ? (
        <div aria-live="polite" className={styles.notice}>
          {notice}
        </div>
      ) : null}

      <div
        aria-labelledby={`community-hub-tab-${activeTab}`}
        className={styles.panel}
        id="community-hub-panel"
        role="tabpanel"
      >
        {activeTab === "inbox" ? (
          <InboxPanel
            busyId={busyId}
            inbox={inbox}
            onRespond={handleRespond}
            onRetry={() => {
              setInboxState("loading");
              void refreshInbox();
            }}
            state={inboxState}
          />
        ) : activeTab === "people" ? (
          <PeoplePanel
            busyId={busyId}
            filter={peopleFilter}
            onFilterChange={setPeopleFilter}
            onFollow={handleMemberFollow}
            onLoadMore={handlePeoplePage}
            onMessage={handleMessage}
            onRetry={() => {
              setPeopleState("loading");
              void refreshPeople(peopleFilter);
            }}
            page={peoplePage}
            state={peopleState}
          />
        ) : activeTab === "rooms" ? (
          <RoomsPanel
            busyId={busyId}
            onLoadMore={handleRoomsPage}
            onOpen={handleRoomOpen}
            onRetry={() => {
              setRoomsState("loading");
              void refreshRooms();
            }}
            page={roomsPage}
            state={roomsState}
          />
        ) : (
          <ActivityPanel
            busyId={busyId}
            onOpen={handleActivity}
            onRetry={() => {
              setSummaryState("loading");
              void refreshSummary();
            }}
            state={summaryState}
            summary={summary}
          />
        )}
      </div>
    </section>
  );
}

function InboxPanel({
  busyId,
  inbox,
  onRespond,
  onRetry,
  state,
}: {
  busyId: string | null;
  inbox: DirectMessageInbox;
  onRespond: (
    conversationId: string,
    action: "accept" | "block" | "decline",
  ) => Promise<void>;
  onRetry: () => void;
  state: LoadState;
}) {
  if (state !== "ready") {
    return <PanelState state={state} label="messages" onRetry={onRetry} />;
  }
  const empty =
    !inbox.incomingRequests.length &&
    !inbox.outgoingRequests.length &&
    !inbox.conversations.length;
  return (
    <>
      <PanelHeading
        eyebrow="Inbox"
        title="Member messages"
        description="Message requests are reviewed before your regular one-to-one conversations."
      />
      {empty ? (
        <EmptyState
          action={{ href: "/feed", label: "Browse Live Feed" }}
          description="Start from a registered member’s message menu in a Live Room."
          title="No member messages yet"
        />
      ) : (
        <div className={styles.inboxSections}>
          {inbox.incomingRequests.length ? (
            <section aria-labelledby="message-requests-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <span>Review first</span>
                  <h3 id="message-requests-heading">
                    Message requests
                  </h3>
                </div>
                <b>{inbox.pendingRequestCount}</b>
              </div>
              <div className={styles.requestGrid}>
                {inbox.incomingRequests.map((request) => (
                  <article
                    className={styles.requestCard}
                    key={request.conversationId}
                  >
                    <Identity
                      displayName={request.peer.displayName}
                      emoji={request.peer.emoji}
                      plan={request.peer.plan}
                    />
                    <p>{request.bodyPreview}</p>
                    {request.riskFlags.length ? (
                      <small className={styles.warning}>
                        Safety review: this request contains payment,
                        off-platform, or guarantee language.
                      </small>
                    ) : null}
                    <time dateTime={request.createdAt || undefined}>
                      {formatTime(request.createdAt)}
                    </time>
                    <div className={styles.requestActions}>
                      <button
                        disabled={busyId === request.conversationId}
                        onClick={() =>
                          void onRespond(
                            request.conversationId,
                            "accept",
                          )
                        }
                        type="button"
                      >
                        <Check aria-hidden="true" size={14} />
                        Accept
                      </button>
                      <button
                        disabled={busyId === request.conversationId}
                        onClick={() =>
                          void onRespond(
                            request.conversationId,
                            "decline",
                          )
                        }
                        type="button"
                      >
                        <X aria-hidden="true" size={14} />
                        Decline
                      </button>
                      <button
                        disabled={busyId === request.conversationId}
                        onClick={() =>
                          void onRespond(
                            request.conversationId,
                            "block",
                          )
                        }
                        type="button"
                      >
                        <Ban aria-hidden="true" size={14} />
                        Block
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {inbox.conversations.length ? (
            <section aria-labelledby="conversations-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <span>One-to-one</span>
                  <h3 id="conversations-heading">Conversations</h3>
                </div>
              </div>
              <div className={styles.rows}>
                {inbox.conversations.map((conversation) => (
                  <Link
                    className={styles.rowLink}
                    href={`/messages/${encodeURIComponent(
                      conversation.conversationId,
                    )}`}
                    key={conversation.conversationId}
                  >
                    <Identity
                      compact
                      displayName={conversation.peer.displayName}
                      emoji={conversation.peer.emoji}
                      plan={conversation.peer.plan}
                    />
                    <span className={styles.rowPreview}>
                      <small>
                        {conversation.latestBodyPreview ||
                          "Conversation ready"}
                      </small>
                      <time
                        dateTime={
                          conversation.latestCreatedAt || undefined
                        }
                      >
                        {formatTime(conversation.latestCreatedAt)}
                      </time>
                    </span>
                    {conversation.unreadCount ? (
                      <b className={styles.unreadBadge}>
                        {formatCount(conversation.unreadCount)}
                      </b>
                    ) : (
                      <ChevronRight aria-hidden="true" size={16} />
                    )}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {inbox.outgoingRequests.length ? (
            <section aria-labelledby="sent-requests-heading">
              <div className={styles.sectionHeading}>
                <div>
                  <span>Awaiting review</span>
                  <h3 id="sent-requests-heading">Sent requests</h3>
                </div>
              </div>
              <div className={styles.rows}>
                {inbox.outgoingRequests.map((request) => (
                  <Link
                    className={styles.rowLink}
                    href={`/messages/${encodeURIComponent(
                      request.conversationId,
                    )}`}
                    key={request.conversationId}
                  >
                    <Identity
                      compact
                      displayName={request.peer.displayName}
                      emoji={request.peer.emoji}
                      plan={request.peer.plan}
                    />
                    <span className={styles.rowPreview}>
                      <small>{request.bodyPreview}</small>
                      <b>Pending</b>
                    </span>
                    <ChevronRight aria-hidden="true" size={16} />
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

function PeoplePanel({
  busyId,
  filter,
  onFilterChange,
  onFollow,
  onLoadMore,
  onMessage,
  onRetry,
  page,
  state,
}: {
  busyId: string | null;
  filter: CommunityHubPeopleFilter;
  onFilterChange: (filter: CommunityHubPeopleFilter) => void;
  onFollow: (
    person: CommunityHubPerson,
    followed: boolean,
  ) => Promise<void>;
  onLoadMore: () => Promise<void>;
  onMessage: (person: CommunityHubPerson) => Promise<void>;
  onRetry: () => void;
  page: CommunityHubPeoplePage;
  state: LoadState;
}) {
  return (
    <>
      <PanelHeading
        eyebrow="People"
        title="Member relationships"
        description="Following and follower lists are separate from joined company and Community rooms."
      />
      <div
        aria-label="People relationship"
        className={styles.subtabs}
        role="tablist"
      >
        {(
          [
            ["following", "Following", page.counts.following],
            ["followers", "Followers", page.counts.followers],
            ["mutual", "Mutual", page.counts.mutual],
          ] as const
        ).map(([value, label, count]) => (
          <button
            aria-selected={filter === value}
            key={value}
            onClick={() => onFilterChange(value)}
            role="tab"
            type="button"
          >
            {label} <b>{count}</b>
          </button>
        ))}
      </div>
      {state !== "ready" ? (
        <PanelState state={state} label="people" onRetry={onRetry} />
      ) : !page.items.length ? (
        <EmptyState
          description={
            filter === "followers"
              ? "Members who follow you will appear here."
              : filter === "mutual"
                ? "Follow back a follower to create a mutual relationship."
                : "Follow a registered member from their Live Room message menu."
          }
          title={`No ${filter} members`}
        />
      ) : (
        <>
          <div className={styles.peopleRows}>
            {page.items.map((person) => {
              const busy = busyId === person.publicProfileId;
              return (
                <article
                  className={styles.personRow}
                  key={person.publicProfileId}
                >
                  <Link
                    className={styles.personIdentity}
                    href={`/live/members/${encodeURIComponent(
                      person.publicProfileId,
                    )}`}
                  >
                    <Identity
                      displayName={person.displayName}
                      emoji={person.emoji}
                      isVerified={person.isVerified}
                      plan={person.plan}
                    />
                  </Link>
                  <span className={styles.relationshipLabel}>
                    {person.relationship === "mutual"
                      ? "Mutual"
                      : person.relationship === "following"
                        ? "Following"
                        : "Follows you"}
                  </span>
                  <div className={styles.personActions}>
                    {person.relationship === "mutual" &&
                    person.messageId ? (
                      <button
                        disabled={busy}
                        onClick={() => void onMessage(person)}
                        type="button"
                      >
                        <MessageCircle
                          aria-hidden="true"
                          size={14}
                        />
                        Message
                      </button>
                    ) : null}
                    {person.isFollowing ? (
                      <button
                        disabled={busy}
                        onClick={() => void onFollow(person, false)}
                        type="button"
                      >
                        <UserMinus aria-hidden="true" size={14} />
                        Unfollow
                      </button>
                    ) : person.followsYou ? (
                      <button
                        className={styles.primaryAction}
                        disabled={busy}
                        onClick={() => void onFollow(person, true)}
                        type="button"
                      >
                        <UserPlus aria-hidden="true" size={14} />
                        Follow back
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          {page.nextCursor ? (
            <LoadMoreButton
              busy={busyId === "people-page"}
              onClick={onLoadMore}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function RoomsPanel({
  busyId,
  onLoadMore,
  onOpen,
  onRetry,
  page,
  state,
}: {
  busyId: string | null;
  onLoadMore: () => Promise<void>;
  onOpen: (room: CommunityHubRoom) => Promise<void>;
  onRetry: () => void;
  page: CommunityHubRoomsPage;
  state: LoadState;
}) {
  if (state !== "ready") {
    return <PanelState state={state} label="rooms" onRetry={onRetry} />;
  }
  return (
    <>
      <PanelHeading
        eyebrow="Rooms"
        title="Joined rooms"
        description="Room membership stays separate from following people."
      />
      {!page.items.length ? (
        <EmptyState
          action={{ href: "/live", label: "Browse Community rooms" }}
          description="Join a company Live Room or Community room to keep it here."
          title="No joined rooms"
        />
      ) : (
        <>
          <div className={styles.roomRows}>
            {page.items.map((room) => (
              <article className={styles.roomRow} key={room.href}>
                <button
                  className={styles.roomOpen}
                  disabled={busyId === room.href}
                  onClick={() => void onOpen(room)}
                  type="button"
                >
                  <span className={styles.roomIcon}>
                    {room.kind === "company" ? (
                      <Bookmark aria-hidden="true" size={17} />
                    ) : (
                      <Users aria-hidden="true" size={17} />
                    )}
                  </span>
                  <span>
                    <strong>{room.label}</strong>
                    <small>
                      {room.kind === "company"
                        ? "Company Live Room"
                        : "Community room"}
                    </small>
                  </span>
                </button>
                <span className={styles.roomScope}>
                  <b>Joined</b>
                  <small>Room activity</small>
                </span>
                {room.unreadCount ? (
                  <b className={styles.unreadBadge}>
                    {formatCount(room.unreadCount)}
                  </b>
                ) : (
                  <span className={styles.readLabel}>Read</span>
                )}
              </article>
            ))}
          </div>
          {page.nextCursor ? (
            <LoadMoreButton
              busy={busyId === "rooms-page"}
              onClick={onLoadMore}
            />
          ) : null}
        </>
      )}
    </>
  );
}

function ActivityPanel({
  busyId,
  onOpen,
  onRetry,
  state,
  summary,
}: {
  busyId: string | null;
  onOpen: (activity: LiveRoomPostActivity) => Promise<void>;
  onRetry: () => void;
  state: LoadState;
  summary: LiveRoomUnreadSummary;
}) {
  if (state !== "ready") {
    return (
      <PanelState state={state} label="activity" onRetry={onRetry} />
    );
  }
  return (
    <>
      <PanelHeading
        eyebrow="Activity"
        title="Community activity"
        description="Comments, replies, and new posts from members or rooms you joined."
      />
      {!summary.activity.length ? (
        <EmptyState
          description="New comments, replies, and followed posts will appear here."
          title="No recent activity"
        />
      ) : (
        <div className={styles.activityRows}>
          {summary.activity.map((activity) => (
            <button
              className={`${styles.activityRow} ${
                activity.isRead ? styles.readActivity : ""
              }`}
              disabled={busyId === activity.activityId}
              key={activity.activityId}
              onClick={() => void onOpen(activity)}
              type="button"
            >
              <span className={styles.avatar} aria-hidden="true">
                {activity.actorEmoji}
              </span>
              <span>
                <span className={styles.activityMeta}>
                  <strong>{activity.actorDisplayName}</strong>
                  <b>{formatActivityKind(activity.kind)}</b>
                  <time dateTime={activity.createdAt}>
                    {formatTime(activity.createdAt)}
                  </time>
                </span>
                <small>
                  {activity.roomLabel} ·{" "}
                  {activity.bodyPreview || activity.postTitle}
                </small>
              </span>
              {!activity.isRead ? (
                <i aria-label="Unread activity" />
              ) : null}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function PanelHeading({
  description,
  eyebrow,
  title,
}: {
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <header className={styles.panelHeading}>
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}

function Identity({
  compact = false,
  displayName,
  emoji,
  isVerified = false,
  plan,
}: {
  compact?: boolean;
  displayName: string;
  emoji: string;
  isVerified?: boolean;
  plan: DirectMessageInbox["conversations"][number]["peer"]["plan"];
}) {
  return (
    <span className={`${styles.identity} ${compact ? styles.compact : ""}`}>
      <span aria-hidden="true" className={styles.avatar}>
        {emoji}
      </span>
      <span>
        <strong>
          {displayName}
          {isVerified ? (
            <BadgeCheck
              aria-label="Verified member"
              className={styles.verified}
              size={14}
            />
          ) : null}
        </strong>
        <MemberPlanBadge plan={plan} />
      </span>
    </span>
  );
}

function PanelState({
  label,
  onRetry,
  state,
}: {
  label: string;
  onRetry: () => void;
  state: LoadState;
}) {
  return (
    <div className={styles.state}>
      {state === "loading" ? (
        <>
          <span className={styles.spinner} aria-hidden="true">
            <LoaderCircle size={20} />
          </span>
          <span>Loading {label}…</span>
        </>
      ) : (
        <>
          <strong>{label[0].toUpperCase() + label.slice(1)} unavailable</strong>
          <span>Check your connection and try again.</span>
          <button onClick={onRetry} type="button">
            <RefreshCw aria-hidden="true" size={14} />
            Retry
          </button>
        </>
      )}
    </div>
  );
}

function EmptyState({
  action,
  description,
  title,
}: {
  action?: { href: string; label: string };
  description: string;
  title: string;
}) {
  return (
    <div className={styles.empty}>
      <MessageCircle aria-hidden="true" size={22} />
      <strong>{title}</strong>
      <p>{description}</p>
      {action ? <Link href={action.href}>{action.label}</Link> : null}
    </div>
  );
}

function LoadMoreButton({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => Promise<void>;
}) {
  return (
    <button
      className={styles.loadMore}
      disabled={busy}
      onClick={() => void onClick()}
      type="button"
    >
      {busy ? (
        <span className={styles.spinner} aria-hidden="true">
          <LoaderCircle size={15} />
        </span>
      ) : null}
      {busy ? "Loading…" : "Load more"}
    </button>
  );
}

function formatCount(value: number) {
  return value > 99 ? "99+" : String(value);
}

function formatTime(value: string | null) {
  if (!value) return "No messages yet";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "";
  const elapsed = Math.max(0, Date.now() - time);
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) {
    return `${Math.floor(elapsed / 3_600_000)}h`;
  }
  if (elapsed < 604_800_000) {
    return `${Math.floor(elapsed / 86_400_000)}d`;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(time));
}

function formatActivityKind(kind: LiveRoomPostActivity["kind"]) {
  if (kind === "post_comment") return "commented";
  if (kind === "comment_reply") return "replied";
  if (kind === "followed_member_post") return "new post";
  return "room post";
}
