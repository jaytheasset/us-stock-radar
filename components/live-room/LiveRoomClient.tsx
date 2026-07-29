"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { DirectMessageRequestModal } from "@/components/direct-messages/DirectMessageRequestModal";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import {
  createCompanyRoomKey,
  getCompanyEventsApiHref,
  selectLatestCompanyEvent,
  sortCompanyEvents,
  toCompanyEvent,
} from "@/lib/live-room/adapters";
import {
  LiveRoomApiRepository,
  requestLiveRoomUnreadRefresh,
  toLiveRoomApiError,
  type LiveRoomRealtimeConfig,
} from "@/lib/live-room/apiRepository";
import { DirectMessageApiRepository } from "@/lib/direct-messages/apiRepository";
import {
  evaluateLiveRoomMessage,
  type ModerationDecision,
  type ModerationReason,
} from "@/lib/live-room/moderation";
import { createLiveRoomMemberLoginHref } from "@/lib/live-room/memberActions";
import { createLiveRoomReplyBodyPreview } from "@/lib/live-room/replyPolicy";
import {
  shareLiveRoomInvite,
  type LiveRoomInviteUiState,
} from "@/lib/live-room/inviteShare";
import type {
  CompanyEvent,
  CompanyEventReference,
  CompanyEventSource,
  CompanyRoomIdentity,
  LiveRoomBlockedActor,
  LiveRoomChatMessage,
  LiveRoomMemberSummary,
  LiveRoomModerationItem,
  LiveRoomMembershipList,
  LiveRoomPost,
  LiveRoomPostPreview,
  LiveRoomProfile,
  LiveRoomPublicRoomCounts,
  LiveRoomReportReason,
  LiveRoomTimelineItem,
} from "@/lib/live-room/types";
import {
  mapStockOverviewEvents,
  mapStockOverviewProfile,
  mapStockOverviewQuote,
  type StockOverviewQuote,
} from "@/lib/watchlist/stockOverview";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import type { Plan } from "@/lib/subscriptionPolicy";
import {
  isCurrentLiveRoomTimelineGeneration,
  mergeLiveRoomTimeline,
  removeLiveRoomTimelineItems,
  replaceLiveRoomTimeline,
  updateLiveRoomMessageEngagement,
} from "@/lib/live-room/timeline";
import {
  getLiveRoomTimelineDistanceFromBottom,
  isLiveRoomTimelineNearBottom,
  preserveLiveRoomTimelinePrependPosition,
  shouldScrollLiveRoomTimelineToBottom,
} from "@/lib/live-room/timelineScroll";
import {
  applyLiveRoomPresence,
  clearLiveRoomPresence,
  getLiveRoomPresenceMessageIds,
  LIVE_ROOM_PRESENCE_POLL_INTERVAL_MS,
  shouldRunLiveRoomPresence,
} from "@/lib/live-room/presence";
import { selectLiveRoomSidePanelMembers } from "@/lib/live-room/sidePanel";
import {
  ChatTimeline,
  LatestChatEventStrip,
} from "./ChatTimeline";
import { CompanyEventCard } from "./CompanyEventCard";
import { CompanyRoomHeader } from "./CompanyRoomHeader";
import { EventHistoryPanel } from "./EventHistoryPanel";
import { JoinedRoomsList } from "./JoinedRoomsList";
import { MessageComposer } from "./MessageComposer";
import {
  LiveRoomHeaderAdSlot,
  LiveRoomMobileInlineAdSlot,
  LiveRoomRailAdSlot,
} from "./LiveRoomAdSlots";
import {
  LiveRoomDesktopSidePanel,
  LiveRoomMemberList,
} from "./LiveRoomDesktopSidePanel";
import { PostsPanel } from "./PostsPanel";
import {
  RoomTabs,
  type CompanyLiveRoomTab,
} from "./RoomTabs";
import styles from "./LiveRoom.module.css";

type LiveRoomClientProps = {
  activityMessageId: string | null;
  realtimeConfig: LiveRoomRealtimeConfig | null;
  ticker: string;
  viewerPlan: Plan;
};

type TimelineState = "empty" | "error" | "loading" | "ready";
type PostsState = "error" | "loading" | "ready";
type MobileLiveRoomSheet = "events" | "members" | "posts" | "rooms";
type MobileLiveRoomTab = "chat" | MobileLiveRoomSheet;

const mobileLiveRoomTabs = [
  { label: "Chat", value: "chat" },
  {
    controlsId: "live-room-posts-sheet",
    label: "Posts",
    value: "posts",
  },
  {
    controlsId: "live-room-events-sheet",
    label: "Events",
    value: "events",
  },
  {
    controlsId: "live-room-members-sheet",
    label: "Members",
    value: "members",
  },
  {
    controlsId: "live-room-rooms-sheet",
    label: "Rooms",
    value: "rooms",
  },
] as const;

const EMPTY_QUOTE: StockOverviewQuote = {
  change: null,
  changePercent: null,
  dayHigh: null,
  dayLow: null,
  open: null,
  previousClose: null,
  price: null,
  volume: null,
  yearHigh: null,
  yearLow: null,
};

export function LiveRoomClient({
  activityMessageId,
  realtimeConfig,
  ticker,
  viewerPlan,
}: LiveRoomClientProps) {
  const router = useRouter();
  const adsEnabledForViewer = areAdsEnabledForPlan(viewerPlan);
  const roomKey = useMemo(
    () => createCompanyRoomKey({ ticker }),
    [ticker],
  );
  const repository = useMemo(
    () => new LiveRoomApiRepository(ticker, realtimeConfig),
    [realtimeConfig, ticker],
  );
  const [identity, setIdentity] = useState<CompanyRoomIdentity>({
    companyName: ticker,
    exchange: "US",
    roomKey,
    ticker,
  });
  const [events, setEvents] = useState<CompanyEvent[]>([]);
  const [quote, setQuote] = useState<StockOverviewQuote>(EMPTY_QUOTE);
  const [eventSource, setEventSource] =
    useState<CompanyEventSource>("loading");
  const [timeline, setTimeline] = useState<LiveRoomTimelineItem[]>([]);
  const [timelineState, setTimelineState] =
    useState<TimelineState>("loading");
  const [posts, setPosts] = useState<LiveRoomPost[]>([]);
  const [postsCursor, setPostsCursor] = useState<string | null>(null);
  const [postsState, setPostsState] =
    useState<PostsState>("loading");
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [body, setBody] = useState("");
  const [reference, setReference] =
    useState<CompanyEventReference | null>(null);
  const [replyingTo, setReplyingTo] =
    useState<LiveRoomChatMessage | null>(null);
  const [composerFocusRequestId, setComposerFocusRequestId] =
    useState(0);
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [profile, setProfile] = useState<LiveRoomProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showPresence, setShowPresence] = useState<boolean | null>(null);
  const [presenceSettingBusy, setPresenceSettingBusy] = useState(false);
  const [roomCounts, setRoomCounts] =
    useState<LiveRoomPublicRoomCounts | null>(null);
  const [membershipJoined, setMembershipJoined] =
    useState<boolean | null>(null);
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [joinedRooms, setJoinedRooms] =
    useState<LiveRoomMembershipList | null>(null);
  const [joinedRoomsError, setJoinedRoomsError] =
    useState<string | null>(null);
  const [joinedRoomsLoading, setJoinedRoomsLoading] = useState(true);
  const [memberSummaries, setMemberSummaries] = useState<
    LiveRoomMemberSummary[] | null
  >(null);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);
  const [inviteState, setInviteState] =
    useState<LiveRoomInviteUiState>("idle");
  const [sending, setSending] = useState(false);
  const [blocks, setBlocks] = useState<LiveRoomBlockedActor[]>([]);
  const [hiddenMessages, setHiddenMessages] = useState<
    LiveRoomModerationItem[]
  >([]);
  const [messageActionId, setMessageActionId] =
    useState<string | null>(null);
  const [messageLikeIds, setMessageLikeIds] =
    useState<ReadonlySet<string>>(() => new Set());
  const [messageRequestTarget, setMessageRequestTarget] = useState<{
    displayName: string;
    emoji: string;
    messageId: string;
  } | null>(null);
  const [messageRequestBusy, setMessageRequestBusy] = useState(false);
  const [messageRequestError, setMessageRequestError] = useState<
    string | null
  >(null);
  const [newUpdateId, setNewUpdateId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] =
    useState<string | null>(null);
  const [activeTab, setActiveTab] =
    useState<CompanyLiveRoomTab>("chat");
  const [mobileSheet, setMobileSheet] =
    useState<MobileLiveRoomSheet | null>(null);
  const latestEventIdRef = useRef<string | null>(null);
  const membershipRef = useRef(false);
  const historyOpenerRef = useRef<HTMLButtonElement>(null);
  const mobileEventsOpenerRef = useRef<HTMLButtonElement>(null);
  const mobileMembersOpenerRef = useRef<HTMLButtonElement>(null);
  const mobilePostsOpenerRef = useRef<HTMLButtonElement>(null);
  const mobileRoomsOpenerRef = useRef<HTMLButtonElement>(null);
  const inviteResetTimerRef = useRef<number | null>(null);
  const markReadTimerRef = useRef<number | null>(null);
  const markedActivityMessageRef = useRef<string | null>(null);
  const profileSaveTimerRef = useRef<number | null>(null);
  const loadedTickerRef = useRef<string | null>(null);
  const timelineGenerationRef = useRef(0);
  const messageLikeIdsRef = useRef<Set<string>>(new Set());
  const timelineElementRef = useRef<HTMLDivElement>(null);
  const timelineScrollFrameRef = useRef<number | null>(null);
  const timelineSticksToBottomRef = useRef(true);
  const didInitialTimelineScrollRef = useRef(false);
  const forceOwnTimelineScrollRef = useRef(false);
  const previousTimelineTailIdRef = useRef<string | null>(null);
  const pendingOlderScrollRef = useRef<{
    previousScrollHeight: number;
    previousScrollTop: number;
  } | null>(null);
  const presenceMessageIdsRef = useRef<string[]>([]);
  const updatesSubscriptionRef = useRef<{ close: () => void } | null>(
    null,
  );
  const directMessageRepository = useMemo(
    () => new DirectMessageApiRepository(),
    [],
  );

  const latestEvent = selectLatestCompanyEvent(events);
  const historicalEvents = latestEvent
    ? events.filter((event) => event.eventId !== latestEvent.eventId)
    : events;
  const members = useMemo(
    () => selectLiveRoomSidePanelMembers({ posts, timeline }),
    [posts, timeline],
  );
  const memberSummaryKey = useMemo(
    () => members.map((member) => member.publicProfileId).join(","),
    [members],
  );
  const roomLoginHref = createLiveRoomMemberLoginHref(
    `/live/${ticker}`,
  );
  const timelineTailId = timeline.at(-1)?.id ?? null;

  const scheduleTimelineScroll = useCallback(
    (scroll: (element: HTMLDivElement) => void) => {
      if (timelineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(timelineScrollFrameRef.current);
      }
      timelineScrollFrameRef.current = window.requestAnimationFrame(() => {
        timelineScrollFrameRef.current = null;
        const element = timelineElementRef.current;
        if (element) scroll(element);
      });
    },
    [],
  );

  const handleTimelineScroll = useCallback(() => {
    const element = timelineElementRef.current;
    if (!element) return;
    timelineSticksToBottomRef.current = isLiveRoomTimelineNearBottom(
      getLiveRoomTimelineDistanceFromBottom(element),
    );
  }, []);

  useEffect(
    () => () => {
      if (inviteResetTimerRef.current !== null) {
        window.clearTimeout(inviteResetTimerRef.current);
      }
    },
    [],
  );

  useEffect(
    () => () => {
      if (timelineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(timelineScrollFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const generation = timelineGenerationRef.current + 1;
    timelineGenerationRef.current = generation;
    let updates: ReturnType<
      typeof repository.updates.subscribe
    > | null = null;
    const isCurrent = () =>
      active &&
      isCurrentLiveRoomTimelineGeneration(
        timelineGenerationRef.current,
        generation,
      );
    const isNewRoom = loadedTickerRef.current !== ticker;
    if (isNewRoom) {
      if (timelineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(timelineScrollFrameRef.current);
        timelineScrollFrameRef.current = null;
      }
      didInitialTimelineScrollRef.current = false;
      forceOwnTimelineScrollRef.current = false;
      previousTimelineTailIdRef.current = null;
      pendingOlderScrollRef.current = null;
      timelineSticksToBottomRef.current = true;
      setTimeline([]);
      setTimelineState("loading");
      setOlderCursor(null);
      setPosts([]);
      setPostsCursor(null);
      setPostsState("loading");
      setProfile(null);
      setProfileOpen(false);
      setShowPresence(null);
      setRoomCounts(null);
      setMembershipJoined(null);
      setJoinedRooms(null);
      setJoinedRoomsError(null);
      setJoinedRoomsLoading(true);
      messageLikeIdsRef.current.clear();
      setMessageLikeIds(new Set());
    }
    setRoomNotice(null);
    if (isNewRoom) {
      setBlocks([]);
      setHiddenMessages([]);
    }
    setHighlightedMessageId(null);
    markedActivityMessageRef.current = null;

    void (async () => {
      try {
        // Resolve the member/guest profile first. For a new guest this lets the
        // browser store the server-issued HttpOnly identity cookie before the
        // room-scoped requests start.
        const nextProfile = await repository.readProfile();
        if (!isCurrent()) return;
        setProfile(nextProfile);

        const presenceSettingPromise = nextProfile.isGuest
          ? Promise.resolve(null)
          : repository.readPresenceSetting().catch(() => null);
        const postsPagePromise = repository
          .listPosts()
          .then((page) => ({ page }))
          .catch(() => ({ page: null }));
        const joinedRoomsPromise = nextProfile.isGuest
          ? Promise.resolve({ data: null, error: null })
          : repository
              .listJoinedRooms(8)
              .then((data) => ({ data, error: null }))
              .catch((error) => ({
                data: null,
                error: toLiveRoomApiError(error).message,
              }));
        const [
          page,
          membership,
          nextBlocks,
          nextHiddenMessages,
          nextPresenceSetting,
          nextPostsPage,
          nextJoinedRooms,
        ] =
          await Promise.all([
            repository.list(),
            repository.readMembership(),
            repository.listBlocks(),
            nextProfile.canModerate
              ? repository.listHiddenMessages()
              : Promise.resolve([]),
            presenceSettingPromise,
            postsPagePromise,
            joinedRoomsPromise,
          ]);
        if (!isCurrent()) return;
        let initialItems: LiveRoomTimelineItem[] = page.items;
        if (activityMessageId) {
          try {
            const anchor =
              page.items.find(
                (item) =>
                  item.kind === "message" &&
                  item.id === activityMessageId,
              ) ||
              (await repository.readMessageAnchor(activityMessageId));
            if (!isCurrent()) return;
            initialItems = mergeLiveRoomTimeline(initialItems, [anchor]);
            setHighlightedMessageId(anchor.id);
          } catch (error) {
            if (!isCurrent()) return;
            setRoomNotice(toLiveRoomApiError(error).message);
          }
        }
        loadedTickerRef.current = ticker;
        setTimeline(replaceLiveRoomTimeline(initialItems));
        setOlderCursor(page.nextCursor);
        setTimelineState(initialItems.length ? "ready" : "empty");
        if (nextPostsPage.page) {
          setPosts(nextPostsPage.page.items);
          setPostsCursor(nextPostsPage.page.nextCursor);
          setPostsState("ready");
        } else {
          setPosts([]);
          setPostsCursor(null);
          setPostsState("error");
        }
        setMembershipJoined(membership.joined);
        setJoinedRooms(nextJoinedRooms.data);
        setJoinedRoomsError(nextJoinedRooms.error);
        setJoinedRoomsLoading(false);
        setShowPresence(
          nextProfile.isGuest
            ? false
            : nextPresenceSetting?.showPresence ?? null,
        );
        membershipRef.current = membership.joined;
        setBlocks(nextBlocks);
        setHiddenMessages(nextHiddenMessages);
        if (membership.joined) {
          const latestMessageId = getLatestChatMessageId(page.items);
          void repository
            .markRead(latestMessageId)
            .then(requestLiveRoomUnreadRefresh)
            .catch(() => {
              // The next focus/poll refresh retries unread reconciliation.
            });
        }
        updates = repository.updates.subscribe({
          afterChange: page.latestChangeCursor,
          onMessages: (messages) => {
            if (!isCurrent()) return;
            setTimeline((current) =>
              mergeLiveRoomTimeline(current, messages),
            );
            setTimelineState("ready");
            if (membershipRef.current) {
              if (markReadTimerRef.current !== null) {
                window.clearTimeout(markReadTimerRef.current);
              }
              markReadTimerRef.current = window.setTimeout(() => {
                markReadTimerRef.current = null;
                void repository
                  .markRead(getLatestChatMessageId(messages))
                  .then(requestLiveRoomUnreadRefresh)
                  .catch(() => {
                    // The next focus/poll refresh retries unread reconciliation.
                  });
              }, 800);
            }
          },
          onRemoved: (messageIds) => {
            if (!isCurrent() || !messageIds.length) return;
            const removed = new Set(messageIds);
            setTimeline((current) => {
              const next = removeLiveRoomTimelineItems(
                current,
                removed,
              );
              setTimelineState(next.length ? "ready" : "empty");
              return next;
            });
          },
          onSynced: () => {
            if (!isCurrent()) return;
            setRoomNotice(null);

            if (nextProfile.canModerate) {
              void repository
                .listHiddenMessages()
                .then((messages) => {
                  if (isCurrent()) setHiddenMessages(messages);
                })
                .catch((error) => {
                  if (isCurrent()) {
                    setRoomNotice(toLiveRoomApiError(error).message);
                  }
                });
            }
          },
          onError: (error) => {
            if (isCurrent()) {
              setRoomNotice(
                `${error.message} Automatic retry is still active.`,
              );
            }
          },
        });
        updatesSubscriptionRef.current = updates;
      } catch (error) {
        if (!isCurrent()) return;
        setRoomNotice(toLiveRoomApiError(error).message);
        setTimelineState("error");
        setPostsState("error");
        setJoinedRoomsLoading(false);
      }
    })();

    return () => {
      active = false;
      updates?.close();
      if (updatesSubscriptionRef.current === updates) {
        updatesSubscriptionRef.current = null;
      }
      if (markReadTimerRef.current !== null) {
        window.clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = null;
      }
    };
  }, [activityMessageId, reloadKey, repository, ticker]);

  useEffect(() => {
    if (timelineState !== "ready" || !timelineTailId) return;

    const initial = !didInitialTimelineScrollRef.current;
    const forcedByOwnSend = forceOwnTimelineScrollRef.current;
    if (
      previousTimelineTailIdRef.current === timelineTailId &&
      !forcedByOwnSend
    ) {
      return;
    }
    previousTimelineTailIdRef.current = timelineTailId;

    if (initial && highlightedMessageId) {
      didInitialTimelineScrollRef.current = true;
      forceOwnTimelineScrollRef.current = false;
      return;
    }

    const reason = initial
      ? "initial"
      : forcedByOwnSend
        ? "own-send"
        : "incoming";
    const shouldScroll = shouldScrollLiveRoomTimelineToBottom(
      reason,
      timelineSticksToBottomRef.current,
    );

    didInitialTimelineScrollRef.current = true;
    if (!shouldScroll) {
      forceOwnTimelineScrollRef.current = false;
      return;
    }

    scheduleTimelineScroll((currentElement) => {
      currentElement.scrollTo({
        behavior: reason === "incoming" ? "smooth" : "auto",
        top: currentElement.scrollHeight,
      });
      forceOwnTimelineScrollRef.current = false;
      timelineSticksToBottomRef.current = true;
    });
  }, [
    highlightedMessageId,
    scheduleTimelineScroll,
    timelineState,
    timelineTailId,
  ]);

  useEffect(() => {
    const pendingScroll = pendingOlderScrollRef.current;
    if (!pendingScroll) return;
    pendingOlderScrollRef.current = null;
    if (forceOwnTimelineScrollRef.current) return;

    scheduleTimelineScroll((element) => {
      element.scrollTop = preserveLiveRoomTimelinePrependPosition({
        nextScrollHeight: element.scrollHeight,
        previousScrollHeight: pendingScroll.previousScrollHeight,
        previousScrollTop: pendingScroll.previousScrollTop,
      });
      timelineSticksToBottomRef.current = isLiveRoomTimelineNearBottom(
        getLiveRoomTimelineDistanceFromBottom(element),
      );
    });
  }, [scheduleTimelineScroll, timeline]);

  useEffect(() => {
    presenceMessageIdsRef.current =
      getLiveRoomPresenceMessageIds(timeline);
  }, [timeline]);

  useEffect(() => {
    setMemberSummaries(null);
  }, [memberSummaryKey, repository]);

  useEffect(() => {
    const canReadCounts =
      timelineState === "ready" || timelineState === "empty";
    const memberPublicProfileIds = memberSummaryKey
      ? memberSummaryKey.split(",")
      : [];
    const canHeartbeatMember =
      canReadCounts &&
      shouldRunLiveRoomPresence({
        documentVisible: true,
        isGuest: profile?.isGuest ?? null,
        showPresence,
      });
    if (!canReadCounts) {
      setRoomCounts(null);
      setMemberSummaries(null);
      setTimeline((current) => clearLiveRoomPresence(current));
      return;
    }
    if (!canHeartbeatMember) {
      setTimeline((current) => clearLiveRoomPresence(current));
    }

    let active = true;
    let requestInFlight = false;
    const refreshPresence = async () => {
      if (
        !active ||
        requestInFlight ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      requestInFlight = true;
      try {
        if (canHeartbeatMember) {
          const heartbeat = await repository.heartbeatPresence();
          if (!active) return;
          if (!heartbeat.recorded) {
            setShowPresence(false);
          }
        }
        const [summary, nextMemberSummaries] = await Promise.all([
          repository.readPresence(presenceMessageIdsRef.current),
          memberPublicProfileIds.length
            ? repository
                .listMemberSummaries(memberPublicProfileIds)
                .catch(() => ({ items: [] }))
            : Promise.resolve({ items: [] }),
        ]);
        if (!active || document.visibilityState !== "visible") return;
        setRoomCounts({
          memberCount: summary.memberCount,
          onlineCount: summary.onlineCount,
          participantCount: summary.participantCount,
          visitorCount: summary.visitorCount,
        });
        if (canHeartbeatMember) {
          setTimeline((current) =>
            applyLiveRoomPresence(current, summary),
          );
        }
        setMemberSummaries(nextMemberSummaries.items);
      } catch {
        if (active) {
          setRoomCounts(null);
          setTimeline((current) => clearLiveRoomPresence(current));
        }
      } finally {
        requestInFlight = false;
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshPresence();
      }
    };
    const handleFocus = () => {
      void refreshPresence();
    };

    void refreshPresence();
    const timer = window.setInterval(
      () => void refreshPresence(),
      LIVE_ROOM_PRESENCE_POLL_INTERVAL_MS,
    );
    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
      window.removeEventListener("focus", handleFocus);
    };
  }, [
    profile?.isGuest,
    memberSummaryKey,
    repository,
    showPresence,
    timelineState,
  ]);

  useEffect(() => {
    if (
      !highlightedMessageId ||
      profile?.isGuest !== false ||
      markedActivityMessageRef.current === highlightedMessageId
    ) {
      return;
    }
    const element = document.getElementById(
      `live-room-message-${highlightedMessageId}`,
    );
    if (!element) return;

    let active = true;
    const scrollFrame = window.requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const markWhenVisible = () => {
      if (
        !active ||
        markedActivityMessageRef.current === highlightedMessageId
      ) {
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
      markedActivityMessageRef.current = highlightedMessageId;
      void repository
        .markMemberActivityRead(highlightedMessageId)
        .then(requestLiveRoomUnreadRefresh)
        .catch(() => {
          if (active) {
            markedActivityMessageRef.current = null;
          }
        });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          markWhenVisible();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(element);
    const visibilityFrame =
      window.requestAnimationFrame(markWhenVisible);

    return () => {
      active = false;
      window.cancelAnimationFrame(scrollFrame);
      window.cancelAnimationFrame(visibilityFrame);
      observer.disconnect();
    };
  }, [
    highlightedMessageId,
    profile?.isGuest,
    repository,
    timeline,
  ]);

  useEffect(() => {
    return () => {
      if (profileSaveTimerRef.current !== null) {
        window.clearTimeout(profileSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(
      `/api/market/fmp/profile?symbol=${encodeURIComponent(ticker)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(readJsonResponse)
      .then((profilePayload) => {
        if (controller.signal.aborted) return;
        const mappedProfile = mapStockOverviewProfile(
          profilePayload,
          ticker,
        );
        setIdentity({
          companyName: mappedProfile.companyName || ticker,
          exchange: mappedProfile.exchange || "US",
          roomKey,
          ticker,
        });
      })
      .catch(() => {
        // The ticker remains a deterministic fallback while profile data retries
        // on the next navigation.
      });
    return () => controller.abort();
  }, [roomKey, ticker]);

  useEffect(() => {
    const controller = new AbortController();
    setQuote(EMPTY_QUOTE);
    void fetch(
      `/api/market/fmp/quote?symbol=${encodeURIComponent(ticker)}`,
      { cache: "no-store", signal: controller.signal },
    )
      .then(readJsonResponse)
      .then((quotePayload) => {
        if (controller.signal.aborted) return;
        setQuote(mapStockOverviewQuote(quotePayload));
      })
      .catch(() => {
        if (!controller.signal.aborted) setQuote(EMPTY_QUOTE);
      });
    return () => controller.abort();
  }, [ticker]);

  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;

    const loadEvents = async (initial: boolean) => {
      controller?.abort();
      controller = new AbortController();
      if (initial) {
        setEvents([]);
        setEventSource("loading");
      }
      try {
        const eventsPayload = await fetch(
          getCompanyEventsApiHref(ticker),
          { cache: "no-store", signal: controller.signal },
        ).then(readJsonResponse);
        if (!active || controller.signal.aborted) return;
        const nextEvents = sortCompanyEvents(
          mapStockOverviewEvents(eventsPayload)
            .filter((event) => event.ticker === ticker)
            .map(toCompanyEvent),
        );
        const nextLatestId =
          selectLatestCompanyEvent(nextEvents)?.eventId || null;
        if (
          latestEventIdRef.current &&
          nextLatestId &&
          nextLatestId !== latestEventIdRef.current
        ) {
          setNewUpdateId(nextLatestId);
        }
        latestEventIdRef.current = nextLatestId;
        setEvents(nextEvents);
        setEventSource("api");
      } catch {
        if (!active || controller.signal.aborted) return;
        if (initial) setEvents([]);
        setEventSource("error");
      }
    };

    void loadEvents(true);
    const timer = window.setInterval(() => {
      void loadEvents(false);
    }, 15_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [ticker]);

  const handleProfileChange = (nextProfile: LiveRoomProfile) => {
    setProfile(nextProfile);
    setRoomNotice(null);
    if (profileSaveTimerRef.current !== null) {
      window.clearTimeout(profileSaveTimerRef.current);
    }
    profileSaveTimerRef.current = window.setTimeout(() => {
      profileSaveTimerRef.current = null;
      void repository
        .writeProfile({
          displayName: nextProfile.displayName,
          emoji: nextProfile.emoji,
        })
        .then((saved) => {
          setProfile(saved);
          setRoomNotice(null);
        })
        .catch((error) => {
          setRoomNotice(toLiveRoomApiError(error).message);
        });
    }, 500);
  };

  const refreshJoinedRooms = async () => {
    if (profile?.isGuest !== false) return;
    setJoinedRoomsLoading(true);
    setJoinedRoomsError(null);
    try {
      setJoinedRooms(await repository.listJoinedRooms(8));
    } catch (error) {
      setJoinedRoomsError(toLiveRoomApiError(error).message);
    } finally {
      setJoinedRoomsLoading(false);
    }
  };

  const handleJoinRoom = async () => {
    if (membershipBusy || profile?.isGuest !== false) return;
    setMembershipBusy(true);
    setRoomNotice(null);
    try {
      const state = await repository.joinRoom();
      setMembershipJoined(state.joined);
      membershipRef.current = state.joined;
      setRoomCounts(state);
      await refreshJoinedRooms();
      requestLiveRoomUnreadRefresh();
    } catch (error) {
      setRoomNotice(toLiveRoomApiError(error).message);
    } finally {
      setMembershipBusy(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (membershipBusy || profile?.isGuest !== false) return;
    setMembershipBusy(true);
    setRoomNotice(null);
    try {
      const state = await repository.leaveRoom();
      setMembershipJoined(state.joined);
      membershipRef.current = state.joined;
      setRoomCounts(state);
      await refreshJoinedRooms();
      requestLiveRoomUnreadRefresh();
      setRoomNotice(
        "You left the room. Reading stays available; contributing again joins the room.",
      );
    } catch (error) {
      setRoomNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMembershipBusy(false);
    }
  };

  const handlePresenceSettingChange = async (
    nextShowPresence: boolean,
  ) => {
    if (presenceSettingBusy || profile?.isGuest !== false) return;
    const previous = showPresence;
    setPresenceSettingBusy(true);
    setRoomNotice(null);
    try {
      const setting = await repository.writePresenceSetting(
        nextShowPresence,
      );
      setShowPresence(setting.showPresence);
      if (!setting.showPresence) {
        setTimeline((current) => clearLiveRoomPresence(current));
      }
    } catch (error) {
      setShowPresence(previous);
      setRoomNotice(toLiveRoomApiError(error).message);
    } finally {
      setPresenceSettingBusy(false);
    }
  };

  const handleInvite = async () => {
    if (inviteState === "working") return;
    if (inviteResetTimerRef.current !== null) {
      window.clearTimeout(inviteResetTimerRef.current);
      inviteResetTimerRef.current = null;
    }

    setInviteState("working");
    const result = await shareLiveRoomInvite({ identity });
    if (result === "cancelled") {
      setInviteState("idle");
      return;
    }

    setInviteState(result);
    inviteResetTimerRef.current = window.setTimeout(() => {
      setInviteState("idle");
      inviteResetTimerRef.current = null;
    }, 2_000);
  };

  const handleMention = (nextReference: CompanyEventReference) => {
    setReference(nextReference);
    setDecision(null);
    setMobileSheet(null);
    setActiveTab("chat");
  };

  const handlePostCreated = (preview: LiveRoomPostPreview) => {
    setMembershipJoined(true);
    membershipRef.current = true;
    void refreshJoinedRooms();
    forceOwnTimelineScrollRef.current = true;
    setTimeline((current) =>
      mergeLiveRoomTimeline(current, [preview]),
    );
    setTimelineState("ready");
    setMobileSheet(null);
    setActiveTab("chat");
  };

  const handleDesktopTabChange = (tab: CompanyLiveRoomTab) => {
    setMobileSheet(null);
    setActiveTab(tab);
  };

  const handleMobileTabChange = useCallback((tab: MobileLiveRoomTab) => {
    setActiveTab("chat");
    setMobileSheet(tab === "chat" ? null : tab);
  }, []);

  const handleMobileTabElementChange = useCallback(
    (
      tab: "chat" | MobileLiveRoomSheet,
      element: HTMLButtonElement | null,
    ) => {
      if (tab === "events") mobileEventsOpenerRef.current = element;
      if (tab === "members") mobileMembersOpenerRef.current = element;
      if (tab === "posts") mobilePostsOpenerRef.current = element;
      if (tab === "rooms") mobileRoomsOpenerRef.current = element;
    },
    [],
  );

  const handleSend = async () => {
    if (!profile) return;
    const currentUserHistory = timeline
      .filter(
        (item): item is LiveRoomChatMessage =>
          item.kind === "message" && item.isMine === true,
      )
      .map((item) => ({
        body: item.body,
        createdAt: item.createdAt,
      }));
    const clientDecision = evaluateLiveRoomMessage(body, {
      history: currentUserHistory,
      now: new Date().toISOString(),
    });
    setDecision(clientDecision);
    if (!clientDecision.allowed) return;

    setSending(true);
    setRoomNotice(null);
    try {
      if (profileSaveTimerRef.current !== null) {
        window.clearTimeout(profileSaveTimerRef.current);
        profileSaveTimerRef.current = null;
        const savedProfile = await repository.writeProfile({
          displayName: profile.displayName,
          emoji: profile.emoji,
        });
        setProfile(savedProfile);
      }
      const message = await repository.send({
        body: clientDecision.normalizedBody,
        eventId: reference?.eventId || null,
        replyToMessageId: replyingTo?.id || null,
      });
      setMembershipJoined(true);
      membershipRef.current = true;
      void refreshJoinedRooms();
      forceOwnTimelineScrollRef.current = true;
      setTimeline((current) =>
        mergeLiveRoomTimeline(current, [message]),
      );
      setTimelineState("ready");
      scheduleTimelineScroll((element) => {
        element.scrollTo({
          behavior: "smooth",
          top: element.scrollHeight,
        });
        didInitialTimelineScrollRef.current = true;
        forceOwnTimelineScrollRef.current = false;
        timelineSticksToBottomRef.current = true;
      });
      setBody("");
      setReference(null);
      setReplyingTo(null);
      setDecision(null);
      setProfileOpen(false);
    } catch (error) {
      const apiError = toLiveRoomApiError(error);
      setDecision({
        allowed: false,
        message: apiError.message,
        reason: getModerationReason(apiError.code),
        retryAfterSeconds: apiError.retryAfterSeconds,
      });
    } finally {
      setSending(false);
    }
  };

  const handleLoadOlder = async () => {
    if (!olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await repository.list({ before: olderCursor });
      const timelineElement = timelineElementRef.current;
      pendingOlderScrollRef.current = timelineElement
        ? {
            previousScrollHeight: timelineElement.scrollHeight,
            previousScrollTop: timelineElement.scrollTop,
          }
        : null;
      setTimeline((current) =>
        mergeLiveRoomTimeline(page.items, current),
      );
      setOlderCursor(page.nextCursor);
      setRoomNotice(null);
    } catch (error) {
      setRoomNotice(toLiveRoomApiError(error).message);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleReply = (message: LiveRoomChatMessage) => {
    setReplyingTo(message);
    setActiveTab("chat");
    setDecision(null);
    setComposerFocusRequestId((value) => value + 1);
  };

  const handleToggleMessageLike = async (
    message: LiveRoomChatMessage,
    liked: boolean,
  ) => {
    if (profile?.isGuest !== false) {
      window.location.assign(roomLoginHref);
      return;
    }
    if (messageLikeIdsRef.current.has(message.id)) return;

    const previous = {
      isLiked: message.isLiked,
      likeCount: message.likeCount,
    };
    messageLikeIdsRef.current.add(message.id);
    setMessageLikeIds(new Set(messageLikeIdsRef.current));
    setTimeline((current) =>
      updateLiveRoomMessageEngagement(current, message.id, {
        isLiked: liked,
        likeCount: Math.max(
          0,
          message.likeCount + (liked ? 1 : -1),
        ),
      }),
    );
    setRoomNotice(null);

    try {
      const result = await repository.setMessageLike(
        message.id,
        liked,
      );
      setTimeline((current) =>
        updateLiveRoomMessageEngagement(current, result.messageId, {
          isLiked: result.liked,
          likeCount: result.likeCount,
        }),
      );
    } catch (error) {
      setTimeline((current) =>
        updateLiveRoomMessageEngagement(
          current,
          message.id,
          previous,
        ),
      );
      setRoomNotice(toLiveRoomApiError(error).message);
    } finally {
      messageLikeIdsRef.current.delete(message.id);
      setMessageLikeIds(new Set(messageLikeIdsRef.current));
    }
  };

  const handleOpenReplyTarget = (messageId: string) => {
    if (
      !timeline.some(
        (item) => item.kind === "message" && item.id === messageId,
      )
    ) {
      return;
    }
    setActiveTab("chat");
    setHighlightedMessageId(messageId);
    scheduleTimelineScroll(() => {
      document
        .getElementById(`live-room-message-${messageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  };

  const handleReport = async (
    messageId: string,
    reason: LiveRoomReportReason,
  ) => {
    setMessageActionId(messageId);
    setRoomNotice(null);
    try {
      await repository.report(messageId, reason);
      setRoomNotice("Report received. Thank you for helping keep the room useful.");
    } catch (error) {
      setRoomNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMessageActionId(null);
    }
  };

  const handleBlock = async (messageId: string) => {
    setMessageActionId(messageId);
    setRoomNotice(null);
    try {
      const result = await repository.block(messageId);
      const removed = new Set(result.removedMessageIds);
      setTimeline((current) => {
        const next = removeLiveRoomTimelineItems(current, removed);
        setTimelineState(next.length ? "ready" : "empty");
        return next;
      });
      setBlocks((current) => [
        result.block,
        ...current.filter((block) => block.id !== result.block.id),
      ]);
      setRoomNotice(`${result.block.displayName} is blocked.`);
    } catch (error) {
      setRoomNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMessageActionId(null);
    }
  };

  const handleMemberFollow = async (
    messageId: string,
    nextFollowed: boolean,
  ) => {
    setMessageActionId(messageId);
    setRoomNotice(null);
    try {
      const result = await repository.writeMemberFollow({
        followed: nextFollowed,
        messageId,
      });
      setTimeline((current) =>
        current.map((item) =>
          item.kind === "message" && item.id === result.messageId
            ? { ...item, isMemberFollowed: result.followed }
            : item,
        ),
      );
      const refreshedPage = await repository.list();
      setTimeline((current) =>
        mergeLiveRoomTimeline(current, refreshedPage.items),
      );
      setRoomNotice(
        result.followed ? "Member followed." : "Member unfollowed.",
      );
    } catch (error) {
      setRoomNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMessageActionId(null);
    }
  };

  const handleMessageMember = async (messageId: string) => {
    setMessageActionId(messageId);
    setRoomNotice(null);
    try {
      const result = await directMessageRepository.start(messageId);
      if (result.mode === "request_required") {
        setMessageRequestError(null);
        setMessageRequestTarget({
          displayName: result.peer.displayName,
          emoji: result.peer.emoji,
          messageId,
        });
        return;
      }
      if (result.conversationId) {
        router.push(
          `/messages/${encodeURIComponent(result.conversationId)}`,
        );
      }
    } catch (error) {
      setRoomNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMessageActionId(null);
    }
  };

  const handleMobileMessageMember = async (messageId: string) => {
    setMobileSheet(null);
    setActiveTab("chat");
    await handleMessageMember(messageId);
  };

  const handleSendMessageRequest = async (requestBody: string) => {
    if (!messageRequestTarget || messageRequestBusy) return;
    setMessageRequestBusy(true);
    setMessageRequestError(null);
    try {
      const result = await directMessageRepository.request(
        messageRequestTarget.messageId,
        requestBody,
      );
      if (!result.conversationId) {
        throw new Error("The message request could not be opened.");
      }
      setMessageRequestTarget(null);
      router.push(
        `/messages/${encodeURIComponent(result.conversationId)}`,
      );
    } catch (error) {
      setMessageRequestError(toLiveRoomApiError(error).message);
    } finally {
      setMessageRequestBusy(false);
    }
  };

  const handleCloseMessageRequest = useCallback(() => {
    if (messageRequestBusy) return;
    setMessageRequestError(null);
    setMessageRequestTarget(null);
  }, [messageRequestBusy]);

  const handleUnblock = async (blockId: string) => {
    setMessageActionId(blockId);
    setRoomNotice(null);
    try {
      await repository.unblock(blockId);
      setBlocks((current) =>
        current.filter((block) => block.id !== blockId),
      );
      updatesSubscriptionRef.current?.close();
      updatesSubscriptionRef.current = null;
      const refreshGeneration = timelineGenerationRef.current + 1;
      timelineGenerationRef.current = refreshGeneration;
      try {
        const page = await repository.list();
        if (
          !isCurrentLiveRoomTimelineGeneration(
            timelineGenerationRef.current,
            refreshGeneration,
          )
        ) {
          return;
        }
        const refreshedTimeline = replaceLiveRoomTimeline(page.items);
        setTimeline(refreshedTimeline);
        setOlderCursor(page.nextCursor);
        setTimelineState(
          refreshedTimeline.length ? "ready" : "empty",
        );
        setRoomNotice("Author unblocked.");
      } finally {
        if (
          isCurrentLiveRoomTimelineGeneration(
            timelineGenerationRef.current,
            refreshGeneration,
          )
        ) {
          setReloadKey((value) => value + 1);
        }
      }
    } catch (error) {
      setRoomNotice(toLiveRoomApiError(error).message);
    } finally {
      setMessageActionId(null);
    }
  };

  const handleModerate = async (
    messageId: string,
    action: "hide" | "restore",
  ) => {
    setMessageActionId(messageId);
    setRoomNotice(null);
    try {
      const result = await repository.moderate(
        messageId,
        action,
        action === "hide"
          ? "Hidden from the Live Room message menu"
          : "Restored from the Live Room moderation panel",
      );
      if (action === "hide") {
        setTimeline((current) => {
          const next = removeLiveRoomTimelineItems(
            current,
            new Set([messageId]),
          );
          setTimelineState(next.length ? "ready" : "empty");
          return next;
        });
      } else if (result.message) {
        setTimeline((current) =>
          mergeLiveRoomTimeline(current, [
            result.message as LiveRoomChatMessage,
          ]),
        );
        setTimelineState("ready");
      }
      const nextHiddenMessages = await repository.listHiddenMessages();
      setHiddenMessages(nextHiddenMessages);
      setRoomNotice(
        action === "hide" ? "Message hidden." : "Message restored.",
      );
    } catch (error) {
      setRoomNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMessageActionId(null);
    }
  };

  const handleLoadPosts = useCallback(
    async (before?: string | null) => {
      if (!before) setPostsState("loading");
      try {
        const page = await repository.listPosts(before);
        setPosts((current) =>
          before
            ? [
                ...current,
                ...page.items.filter(
                  (post) =>
                    !current.some((item) => item.id === post.id),
                ),
              ]
            : page.items,
        );
        setPostsCursor(page.nextCursor);
        setPostsState("ready");
      } catch (error) {
        setPostsState("error");
        throw error;
      }
    },
    [repository],
  );

  return (
    <>
      <StockRadarAppShell
        activeNavigationItem={null}
        themeMode="user-selectable"
      >
        <div className={styles.page}>
        <div
          className={styles.roomHeaderRow}
          data-ad-enabled={adsEnabledForViewer ? "true" : undefined}
        >
          <CompanyRoomHeader
            historyButtonRef={historyOpenerRef}
            identity={identity}
            inviteState={inviteState}
            isGuest={profile?.isGuest === true}
            loginHref={roomLoginHref}
            membershipBusy={membershipBusy}
            membershipJoined={membershipJoined}
            onInvite={handleInvite}
            onJoin={handleJoinRoom}
            onLeave={handleLeaveRoom}
            onOpenHistory={() => handleDesktopTabChange("events")}
            quote={quote}
            roomCounts={roomCounts}
          />
          <LiveRoomHeaderAdSlot
            enabledForViewer={adsEnabledForViewer}
          />
        </div>

        <LiveRoomMobileInlineAdSlot
          enabledForViewer={adsEnabledForViewer}
        />

        {membershipJoined ? (
          <div className={styles.followNote}>
            <p>
              Joined. This room stays in My Rooms and tracks unread
              activity until you choose Leave room.
            </p>
          </div>
        ) : null}

        <RoomTabs
          active={activeTab}
          items={[
            { label: "Chat", value: "chat" },
            { label: "Posts", value: "posts" },
            { label: "Events", value: "events" },
          ]}
          onChange={handleDesktopTabChange}
          visibility="desktop"
        />
        <RoomTabs
          active={mobileSheet ?? "chat"}
          dockOnMobile
          idPrefix="live-room-mobile"
          items={mobileLiveRoomTabs}
          onChange={handleMobileTabChange}
          onItemElementChange={handleMobileTabElementChange}
          visibility="mobile"
        />

        <div className={styles.workspaceLayout}>
          <div className={styles.primaryColumn}>
        <section
          aria-labelledby="live-room-events-tab"
          className={`${styles.latestSection} ${styles.desktopTabPanel}`}
          hidden={activeTab !== "events"}
          id="live-room-events-panel"
          role="tabpanel"
        >
          <div className={styles.latestHeading}>
            <div>
              <span>
                {latestEvent?.eventId === newUpdateId
                  ? "New company update"
                  : "Latest company update"}
              </span>
              <p>
                This always follows the newest news or filing for the company.
              </p>
              <small
                className={styles.eventSource}
                data-event-source={eventSource}
              >
                {getEventSourceLabel(eventSource, events.length)}
              </small>
            </div>
          </div>
          {latestEvent ? (
            <CompanyEventCard event={latestEvent} latest />
          ) : (
            <p className={styles.panelEmpty}>
              {eventSource === "loading"
                ? "Loading company events…"
                : eventSource === "error"
                  ? "Company events could not be loaded."
                  : "No current company news or filing is available."}
            </p>
          )}
        </section>

        {activeTab === "events" ? (
          <section
            className={`${styles.latestSection} ${styles.desktopTabPanel}`}
          >
            <EventHistoryPanel
              events={historicalEvents}
              onMention={handleMention}
            />
          </section>
        ) : null}

        {activeTab === "posts" ? (
          <div className={styles.desktopTabPanel}>
          <PostsPanel
            cursor={postsCursor}
            events={events}
            loginHref={roomLoginHref}
            onLoad={handleLoadPosts}
            onPostsChange={setPosts}
            onCreated={handlePostCreated}
            posts={posts}
            profile={profile}
            repository={repository}
            currentTicker={ticker}
            state={postsState}
          />
          </div>
        ) : null}

        <div
          aria-labelledby="live-room-chat-tab"
          className={styles.roomLayout}
          data-desktop-hidden={activeTab !== "chat"}
          id="live-room-chat-panel"
          role="tabpanel"
        >
          <section
            aria-label={`${ticker} company discussion`}
            className={styles.chatPanel}
          >
            <div
              className={styles.timeline}
              onScroll={handleTimelineScroll}
              ref={timelineElementRef}
            >
              {roomNotice ? (
                <p className={styles.roomNotice} role="status">
                  {roomNotice}
                </p>
              ) : null}
              {eventSource === "loading" ? (
                <div
                  aria-hidden="true"
                  className={styles.latestChatEventLoading}
                >
                  <span />
                  <span />
                </div>
              ) : latestEvent?.detailHref ? (
                <LatestChatEventStrip event={latestEvent} />
              ) : null}
              {olderCursor && timelineState === "ready" ? (
                <button
                  className={styles.loadOlderButton}
                  disabled={loadingOlder}
                  onClick={handleLoadOlder}
                  type="button"
                >
                  {loadingOlder ? "Loading…" : "Load older messages"}
                </button>
              ) : null}
              <ChatTimeline
                canModerate={profile?.canModerate === true}
                currentProfileName={profile?.displayName.trim() || ""}
                highlightedMessageId={highlightedMessageId}
                items={timeline}
                loginHref={roomLoginHref}
                messageActionId={messageActionId}
                messageLikeIds={messageLikeIds}
                onBlock={handleBlock}
                onHide={(messageId) =>
                  handleModerate(messageId, "hide")
                }
                onMessageMember={handleMessageMember}
                onOpenReplyTarget={handleOpenReplyTarget}
                onReply={handleReply}
                onReport={handleReport}
                onToggleMemberFollow={handleMemberFollow}
                onToggleMessageLike={handleToggleMessageLike}
                onRetry={() => setReloadKey((value) => value + 1)}
                state={timelineState}
                viewerIsGuest={profile?.isGuest !== false}
              />
            </div>
            <MessageComposer
              body={body}
              decision={decision}
              disabled={
                profile === null ||
                timelineState === "error" ||
                timelineState === "loading"
              }
              eventReference={reference}
              focusRequestId={composerFocusRequestId}
              loginHref={roomLoginHref}
              onBodyChange={(nextBody) => {
                setBody(nextBody);
                setDecision(null);
              }}
              onClearReference={() => setReference(null)}
              onCancelReply={() => setReplyingTo(null)}
              onProfileChange={handleProfileChange}
              onPresenceSettingChange={handlePresenceSettingChange}
              onSend={handleSend}
              profile={profile}
              profileOpen={profileOpen}
              replyPreview={
                replyingTo
                  ? {
                      authorDisplayName: replyingTo.author.displayName,
                      authorEmoji: replyingTo.author.emoji,
                      bodyPreview: createLiveRoomReplyBodyPreview(
                        replyingTo.body,
                      ),
                      messageId: replyingTo.id,
                    }
                  : null
              }
              presenceSettingBusy={presenceSettingBusy}
              sending={sending}
              setProfileOpen={setProfileOpen}
              showPresence={showPresence}
            />
          </section>

        </div>
          </div>
          <div className={styles.desktopRail}>
            <LiveRoomDesktopSidePanel
              currentRoomHref={`/live/${ticker}`}
              eventSource={eventSource}
              events={events}
              isGuest={profile?.isGuest === true}
              joinedRooms={joinedRooms}
              joinedRoomsError={joinedRoomsError}
              joinedRoomsLoading={joinedRoomsLoading}
              loginHref={roomLoginHref}
              memberSummaries={memberSummaries}
              messageActionId={messageActionId}
              onChangeMainTab={handleDesktopTabChange}
              onMessageMember={handleMessageMember}
              onRetryPosts={() => {
                void handleLoadPosts().catch(() => undefined);
              }}
              onToggleMemberFollow={handleMemberFollow}
              posts={posts}
              postsState={postsState}
              timeline={timeline}
            />
            <LiveRoomRailAdSlot
              enabledForViewer={adsEnabledForViewer}
            />
          </div>
        </div>

        </div>
      {mobileSheet ? (
        <BottomSheetShell
          aria-label={
            mobileSheet === "posts"
              ? "Posts"
              : mobileSheet === "events"
                ? "Events"
                : mobileSheet === "members"
                  ? "Members"
                  : "My Rooms"
          }
          closeLabel={`Close ${mobileSheet}`}
          fixedFooter={
            <RoomTabs
              active={mobileSheet}
              dockInMobileSheet
              idPrefix="live-room-sheet"
              items={mobileLiveRoomTabs}
              onChange={handleMobileTabChange}
              visibility="mobile"
            />
          }
          id={`live-room-${mobileSheet}-sheet`}
          isOpen
          layout="full-scroll"
          onDismiss={() => {
            setMobileSheet(null);
            setActiveTab("chat");
          }}
          openerRef={
            mobileSheet === "posts"
              ? mobilePostsOpenerRef
              : mobileSheet === "events"
                ? mobileEventsOpenerRef
                : mobileSheet === "members"
                  ? mobileMembersOpenerRef
                  : mobileRoomsOpenerRef
          }
          overlayLabel={`Close ${mobileSheet}`}
          viewport="mobile"
        >
          {mobileSheet === "posts" ? (
            <div className={styles.mobileSheetContent}>
              <PostsPanel
                cursor={postsCursor}
                currentTicker={ticker}
                events={events}
                loginHref={roomLoginHref}
                onCreated={handlePostCreated}
                onLoad={handleLoadPosts}
                onPostsChange={setPosts}
                posts={posts}
                profile={profile}
                repository={repository}
                state={postsState}
              />
            </div>
          ) : null}
          {mobileSheet === "events" ? (
            <div className={styles.mobileSheetContent}>
              <header className={styles.mobileSheetHeading}>
                <h2>Events</h2>
              </header>
              <div className={styles.mobileEventsContent}>
                {latestEvent ? (
                  <CompanyEventCard event={latestEvent} latest />
                ) : (
                  <p className={styles.panelEmpty}>
                    {eventSource === "loading"
                      ? "Loading company events..."
                      : eventSource === "error"
                        ? "Company events could not be loaded."
                        : "No current company news or filing is available."}
                  </p>
                )}
                <EventHistoryPanel
                  events={historicalEvents}
                  onMention={handleMention}
                />
              </div>
            </div>
          ) : null}
          {mobileSheet === "members" ? (
            <div className={styles.mobileSheetContent}>
              <header className={styles.mobileSheetHeading}>
                <h2>Members</h2>
                <p>
                  Follow public members or start a conversation from their
                  latest visible activity.
                </p>
              </header>
              <LiveRoomMemberList
                isGuest={profile?.isGuest === true}
                loginHref={roomLoginHref}
                members={members}
                memberSummaries={memberSummaries}
                messageActionId={messageActionId}
                onMessageMember={handleMobileMessageMember}
                onToggleMemberFollow={handleMemberFollow}
              />
            </div>
          ) : null}
          {mobileSheet === "rooms" ? (
            <div className={styles.mobileSheetContent}>
              <header className={styles.mobileSheetHeading}>
                <h2>My Rooms</h2>
                <p>Only rooms you have joined appear here.</p>
              </header>
              {profile?.isGuest ? (
                <div className={styles.joinedRoomsStatus}>
                  <Link href={roomLoginHref}>
                    Sign in to view My Rooms
                  </Link>
                </div>
              ) : (
                <JoinedRoomsList
                  currentHref={`/live/${ticker}`}
                  data={joinedRooms}
                  error={joinedRoomsError}
                  loading={joinedRoomsLoading}
                />
              )}
              <Link
                className={styles.mobileRoomsViewAll}
                href={
                  profile?.isGuest
                    ? roomLoginHref
                    : "/live?view=joined"
                }
              >
                View all joined rooms
              </Link>
            </div>
          ) : null}
        </BottomSheetShell>
      ) : null}
      {messageRequestTarget ? (
        <DirectMessageRequestModal
          busy={messageRequestBusy}
          error={messageRequestError}
          onCancel={handleCloseMessageRequest}
          onSubmit={handleSendMessageRequest}
          target={messageRequestTarget}
        />
      ) : null}
      </StockRadarAppShell>
    </>
  );
}

async function readJsonResponse(response: Response) {
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<unknown>;
}

function getEventSourceLabel(
  source: CompanyEventSource,
  eventCount: number,
) {
  if (source === "loading") return "Checking the company events API";
  if (source === "error") return "Company events API unavailable";
  return eventCount
    ? "Company events API"
    : "Company events API · no current events";
}

function getModerationReason(code: string): ModerationReason {
  if (code.includes("DUPLICATE")) return "duplicate";
  if (code.includes("RATE_LIMIT")) return "rate_limit";
  if (code.includes("MAX_LENGTH")) return "max_length";
  if (code.includes("EXCESSIVE_LINKS")) return "excessive_links";
  if (code.includes("BLOCKED_WORD")) return "blocked_word";
  return "empty";
}

function getLatestChatMessageId(
  items: readonly LiveRoomTimelineItem[],
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind === "message") return item.id;
  }
  return null;
}
