"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DirectMessageRequestModal } from "@/components/direct-messages/DirectMessageRequestModal";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import type { BrokerageProofSummary } from "@/lib/brokerage/types";
import type { KlipyMediaAttachment } from "@/lib/klipy/types";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import { DirectMessageApiRepository } from "@/lib/direct-messages/apiRepository";
import {
  LiveRoomApiRepository,
  requestLiveRoomUnreadRefresh,
  toLiveRoomApiError,
  type LiveRoomRealtimeConfig,
} from "@/lib/live-room/apiRepository";
import {
  evaluateLiveRoomMessage,
  type ModerationDecision,
  type ModerationReason,
} from "@/lib/live-room/moderation";
import { createLiveRoomReplyBodyPreview } from "@/lib/live-room/replyPolicy";
import { createLiveRoomMemberLoginHref } from "@/lib/live-room/memberActions";
import {
  applyLiveRoomPresence,
  clearLiveRoomPresence,
  getLiveRoomPresenceMessageIds,
  LIVE_ROOM_PRESENCE_POLL_INTERVAL_MS,
  shouldRunLiveRoomPresence,
} from "@/lib/live-room/presence";
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
import type {
  LiveRoomBlockedActor,
  LiveRoomChatMessage,
  LiveRoomMembershipList,
  LiveRoomMemberSummary,
  LiveRoomModerationItem,
  LiveRoomPost,
  LiveRoomPostPreview,
  LiveRoomProfile,
  LiveRoomPublicRoomCounts,
  LiveRoomReportReason,
  LiveRoomTimelineItem,
} from "@/lib/live-room/types";
import type { CommunityRoom } from "@/lib/live-room/community";
import { selectLiveRoomSidePanelMembers } from "@/lib/live-room/sidePanel";
import type { Plan } from "@/lib/subscriptionPolicy";
import { ChatTimeline } from "./ChatTimeline";
import { CommunityRoomAbout } from "./CommunityRoomAbout";
import { CommunityRoomHeader } from "./CommunityRoomHeader";
import { JoinedRoomsList } from "./JoinedRoomsList";
import {
  LiveRoomHeaderAdSlot,
  LiveRoomMobileInlineAdSlot,
  LiveRoomRailAdSlot,
} from "./LiveRoomAdSlots";
import {
  LiveRoomDesktopSidePanel,
  LiveRoomMemberList,
} from "./LiveRoomDesktopSidePanel";
import { LiveRoomLatestButton } from "./LiveRoomLatestButton";
import { MessageComposer } from "./MessageComposer";
import { PostsPanel } from "./PostsPanel";
import { RoomTabs } from "./RoomTabs";
import { useLiveRoomReadPosition } from "./useLiveRoomReadPosition";
import roomStyles from "./LiveRoom.module.css";

type TimelineState = "empty" | "error" | "loading" | "ready";
type PostsState = "error" | "loading" | "ready";
type CommunityMainTab = "about" | "chat" | "posts";
type CommunityMobileSheet = "about" | "members" | "posts" | "rooms";
type CommunityMobileTab = "chat" | CommunityMobileSheet;

const communityMobileTabs = [
  { label: "Chat", value: "chat" },
  {
    controlsId: "live-room-posts-sheet",
    label: "Posts",
    value: "posts",
  },
  {
    controlsId: "live-room-about-sheet",
    label: "About",
    value: "about",
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

export function CommunityRoomClient({
  activityMessageId,
  realtimeConfig,
  room,
  viewerPlan,
}: {
  activityMessageId: string | null;
  realtimeConfig: LiveRoomRealtimeConfig | null;
  room: CommunityRoom;
  viewerPlan: Plan;
}) {
  const router = useRouter();
  const adsEnabledForViewer = areAdsEnabledForPlan(viewerPlan);
  const repository = useMemo(
    () =>
      new LiveRoomApiRepository(
        { kind: "community", slug: room.slug },
        realtimeConfig,
      ),
    [realtimeConfig, room.slug],
  );
  const directMessageRepository = useMemo(
    () => new DirectMessageApiRepository(),
    [],
  );
  const roomLoginHref = createLiveRoomMemberLoginHref(
    `/live/community/${room.slug}`,
  );
  const [timeline, setTimeline] = useState<LiveRoomTimelineItem[]>([]);
  const [timelineState, setTimelineState] = useState<TimelineState>("loading");
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [profile, setProfile] = useState<LiveRoomProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [body, setBody] = useState("");
  const [brokerageProof, setBrokerageProof] =
    useState<BrokerageProofSummary | null>(null);
  const [klipyMedia, setKlipyMedia] =
    useState<KlipyMediaAttachment | null>(null);
  const [replyingTo, setReplyingTo] = useState<LiveRoomChatMessage | null>(
    null,
  );
  const [composerFocusRequestId, setComposerFocusRequestId] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<
    string | null
  >(null);
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<LiveRoomBlockedActor[]>([]);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [hiddenMessages, setHiddenMessages] = useState<
    LiveRoomModerationItem[]
  >([]);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [messageActionId, setMessageActionId] = useState<string | null>(null);
  const [messageLikeIds, setMessageLikeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [posts, setPosts] = useState<LiveRoomPost[]>([]);
  const [postsCursor, setPostsCursor] = useState<string | null>(null);
  const [postsState, setPostsState] = useState<PostsState>("loading");
  const [joinedRooms, setJoinedRooms] = useState<LiveRoomMembershipList | null>(
    null,
  );
  const [joinedRoomsError, setJoinedRoomsError] = useState<string | null>(null);
  const [joinedRoomsLoading, setJoinedRoomsLoading] = useState(true);
  const [memberSummaries, setMemberSummaries] = useState<
    LiveRoomMemberSummary[] | null
  >(null);
  const [messageRequestTarget, setMessageRequestTarget] = useState<{
    displayName: string;
    emoji: string;
    messageId: string;
  } | null>(null);
  const [messageRequestBusy, setMessageRequestBusy] = useState(false);
  const [messageRequestError, setMessageRequestError] = useState<string | null>(
    null,
  );
  const [activeTab, setActiveTab] = useState<CommunityMainTab>("chat");
  const [mobileSheet, setMobileSheet] = useState<CommunityMobileSheet | null>(
    null,
  );
  const [membershipJoined, setMembershipJoined] = useState<boolean | null>(
    null,
  );
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [showPresence, setShowPresence] = useState<boolean | null>(null);
  const [presenceSettingBusy, setPresenceSettingBusy] = useState(false);
  const [roomCounts, setRoomCounts] = useState<LiveRoomPublicRoomCounts | null>(
    null,
  );
  const profileSaveTimerRef = useRef<number | null>(null);
  const membershipRef = useRef(false);
  const mobileAboutOpenerRef = useRef<HTMLButtonElement>(null);
  const mobileMembersOpenerRef = useRef<HTMLButtonElement>(null);
  const mobilePostsOpenerRef = useRef<HTMLButtonElement>(null);
  const mobileRoomsOpenerRef = useRef<HTMLButtonElement>(null);
  const presenceMessageIdsRef = useRef<string[]>([]);
  const replyScrollFrameRef = useRef<number | null>(null);
  const timelineScrollFrameRef = useRef<number | null>(null);
  const didInitialTimelineScrollRef = useRef(false);
  const forceOwnTimelineScrollRef = useRef(false);
  const previousTimelineTailIdRef = useRef<string | null>(null);
  const pendingOlderScrollRef = useRef<{
    previousScrollHeight: number;
    previousScrollTop: number;
  } | null>(null);
  const timelineGenerationRef = useRef(0);
  const messageLikeIdsRef = useRef<Set<string>>(new Set());
  const updatesSubscriptionRef = useRef<{ close: () => void } | null>(null);
  const {
    firstUnreadMessageId,
    handleTimelineScroll,
    initializeReadPosition,
    isLatestLoaded,
    markLatestLoaded,
    nearBottom,
    pendingUnreadCount,
    recordIncomingMessages,
    resetReadPosition,
    scheduleVisibleRead,
    timelineElementRef,
    timelineSticksToBottomRef,
  } = useLiveRoomReadPosition({
    membershipJoined,
    repository,
    timeline,
  });
  const members = useMemo(
    () => selectLiveRoomSidePanelMembers({ posts, timeline }),
    [posts, timeline],
  );
  const memberSummaryKey = useMemo(
    () => members.map((member) => member.publicProfileId).join(","),
    [members],
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
    [timelineElementRef],
  );

  useEffect(() => {
    let active = true;
    const generation = timelineGenerationRef.current + 1;
    timelineGenerationRef.current = generation;
    let updates: { close: () => void } | null = null;
    const isCurrent = () =>
      active &&
      isCurrentLiveRoomTimelineGeneration(
        timelineGenerationRef.current,
        generation,
      );

    setTimeline([]);
    setTimelineState("loading");
    setOlderCursor(null);
    setNotice(null);
    setHighlightedMessageId(null);
    setPosts([]);
    setPostsCursor(null);
    setPostsState("loading");
    setJoinedRooms(null);
    setJoinedRoomsError(null);
    setJoinedRoomsLoading(true);
    setMemberSummaries(null);
    didInitialTimelineScrollRef.current = false;
    forceOwnTimelineScrollRef.current = false;
    previousTimelineTailIdRef.current = null;
    pendingOlderScrollRef.current = null;
    resetReadPosition();

    void (async () => {
      try {
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
          nextBlocks,
          nextHiddenMessages,
          membership,
          nextPresenceSetting,
          nextPostsPage,
          nextJoinedRooms,
        ] = await Promise.all([
          repository.list({ resume: !activityMessageId }),
          repository.listBlocks(),
          nextProfile.canModerate
            ? repository.listHiddenMessages()
            : Promise.resolve([]),
          repository.readMembership(),
          presenceSettingPromise,
          postsPagePromise,
          joinedRoomsPromise,
        ]);
        if (!isCurrent()) return;
        let initialItems = page.items;
        if (activityMessageId) {
          try {
            const anchor =
              page.items.find(
                (item) =>
                  item.kind === "message" && item.id === activityMessageId,
              ) || (await repository.readMessageAnchor(activityMessageId));
            if (!isCurrent()) return;
            initialItems = mergeLiveRoomTimeline(initialItems, [anchor]);
            setHighlightedMessageId(anchor.id);
          } catch (error) {
            if (!isCurrent()) return;
            setNotice(toLiveRoomApiError(error).message);
          }
        }
        initializeReadPosition(page);
        setTimeline(replaceLiveRoomTimeline(initialItems));
        setTimelineState(initialItems.length ? "ready" : "empty");
        setOlderCursor(page.nextCursor);
        setBlocks(nextBlocks);
        setHiddenMessages(nextHiddenMessages);
        setMembershipJoined(membership.joined);
        membershipRef.current = membership.joined;
        setRoomCounts(membership);
        if (nextPostsPage.page) {
          setPosts(nextPostsPage.page.items);
          setPostsCursor(nextPostsPage.page.nextCursor);
          setPostsState("ready");
        } else {
          setPosts([]);
          setPostsCursor(null);
          setPostsState("error");
        }
        setJoinedRooms(nextJoinedRooms.data);
        setJoinedRoomsError(nextJoinedRooms.error);
        setJoinedRoomsLoading(false);
        setShowPresence(
          nextProfile.isGuest
            ? false
            : (nextPresenceSetting?.showPresence ?? null),
        );
        updates = repository.updates.subscribe({
          afterChange: page.latestChangeCursor,
          onError: (error) => {
            if (isCurrent()) {
              setNotice(`${error.message} Automatic retry is still active.`);
            }
          },
          onMessages: (messages) => {
            if (!isCurrent()) return;
            setTimeline((current) => mergeLiveRoomTimeline(current, messages));
            setTimelineState("ready");
            recordIncomingMessages(messages);
          },
          onRemoved: (messageIds) => {
            if (!isCurrent() || !messageIds.length) return;
            setTimeline((current) => {
              const next = removeLiveRoomTimelineItems(
                current,
                new Set(messageIds),
              );
              setTimelineState(next.length ? "ready" : "empty");
              return next;
            });
          },
          onSynced: () => {
            if (isCurrent()) setNotice(null);
          },
        });
        updatesSubscriptionRef.current = updates;
      } catch (error) {
        if (!isCurrent()) return;
        setNotice(toLiveRoomApiError(error).message);
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
    };
  }, [
    activityMessageId,
    initializeReadPosition,
    recordIncomingMessages,
    reloadKey,
    repository,
    resetReadPosition,
  ]);

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

    if (initial && firstUnreadMessageId) {
      didInitialTimelineScrollRef.current = true;
      forceOwnTimelineScrollRef.current = false;
      scheduleTimelineScroll((element) => {
        const target = document.getElementById(
          `live-room-message-${firstUnreadMessageId}`,
        );
        if (target && element.contains(target)) {
          const viewport = element.getBoundingClientRect();
          const bounds = target.getBoundingClientRect();
          element.scrollTop +=
            bounds.top - viewport.top - Math.min(element.clientHeight / 4, 96);
        }
        handleTimelineScroll();
        scheduleVisibleRead();
      });
      return;
    }

    if (initial && highlightedMessageId) {
      didInitialTimelineScrollRef.current = true;
      forceOwnTimelineScrollRef.current = false;
      scheduleTimelineScroll((element) => {
        const target = document.getElementById(
          `live-room-message-${highlightedMessageId}`,
        );
        if (target && element.contains(target)) {
          const viewport = element.getBoundingClientRect();
          const bounds = target.getBoundingClientRect();
          element.scrollTo({
            behavior: "auto",
            top: Math.max(
              0,
              element.scrollTop +
                bounds.top -
                viewport.top -
                (element.clientHeight - bounds.height) / 2,
            ),
          });
        }
        handleTimelineScroll();
        scheduleVisibleRead();
      });
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
    scheduleTimelineScroll((element) => {
      element.scrollTo({
        behavior: reason === "incoming" ? "smooth" : "auto",
        top: element.scrollHeight,
      });
      forceOwnTimelineScrollRef.current = false;
      timelineSticksToBottomRef.current = true;
      scheduleVisibleRead();
    });
  }, [
    firstUnreadMessageId,
    handleTimelineScroll,
    highlightedMessageId,
    scheduleTimelineScroll,
    scheduleVisibleRead,
    timelineState,
    timelineTailId,
    timelineSticksToBottomRef,
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
      scheduleVisibleRead();
    });
  }, [
    scheduleTimelineScroll,
    scheduleVisibleRead,
    timeline,
    timelineSticksToBottomRef,
  ]);

  useEffect(() => {
    presenceMessageIdsRef.current = getLiveRoomPresenceMessageIds(timeline);
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
    if (!canReadCounts) return;
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
          if (!heartbeat.recorded) setShowPresence(false);
        }
        const [summary, nextMemberSummaries] = await Promise.all([
          repository.readPresence(presenceMessageIdsRef.current),
          memberPublicProfileIds.length
            ? repository
                .listMemberSummaries(memberPublicProfileIds)
                .catch(() => ({ items: [] }))
            : Promise.resolve({ items: [] }),
        ]);
        if (!active) return;
        setRoomCounts({
          memberCount: summary.memberCount,
          onlineCount: summary.onlineCount,
          participantCount: summary.participantCount,
          visitorCount: summary.visitorCount,
        });
        if (canHeartbeatMember) {
          setTimeline((current) => applyLiveRoomPresence(current, summary));
        }
        setMemberSummaries(nextMemberSummaries.items);
      } catch {
        if (active) setRoomCounts(null);
      } finally {
        requestInFlight = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshPresence();
      }
    };
    void refreshPresence();
    const timer = window.setInterval(
      () => void refreshPresence(),
      LIVE_ROOM_PRESENCE_POLL_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [
    memberSummaryKey,
    profile?.isGuest,
    repository,
    showPresence,
    timelineState,
  ]);

  useEffect(
    () => () => {
      if (profileSaveTimerRef.current !== null) {
        window.clearTimeout(profileSaveTimerRef.current);
      }
      if (replyScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(replyScrollFrameRef.current);
      }
      if (timelineScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(timelineScrollFrameRef.current);
      }
    },
    [],
  );

  const handleProfileChange = (nextProfile: LiveRoomProfile) => {
    setProfile(nextProfile);
    setNotice(null);
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
        .then(setProfile)
        .catch((error) => setNotice(toLiveRoomApiError(error).message));
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

  const handleLoadPosts = useCallback(
    async (before?: string | null) => {
      try {
        const page = await repository.listPosts(before);
        setPosts((current) =>
          before
            ? [
                ...current,
                ...page.items.filter(
                  (post) => !current.some((item) => item.id === post.id),
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

  const handlePostCreated = (preview: LiveRoomPostPreview) => {
    setMembershipJoined(true);
    membershipRef.current = true;
    void refreshJoinedRooms();
    forceOwnTimelineScrollRef.current = true;
    setTimeline((current) => mergeLiveRoomTimeline(current, [preview]));
    setTimelineState("ready");
    setMobileSheet(null);
    setActiveTab("chat");
  };

  const handleDesktopTabChange = (tab: CommunityMainTab) => {
    setMobileSheet(null);
    setActiveTab(tab);
  };

  const handleMobileTabChange = useCallback((tab: CommunityMobileTab) => {
    setActiveTab("chat");
    setMobileSheet(tab === "chat" ? null : tab);
  }, []);

  const handleMobileTabElementChange = useCallback(
    (tab: CommunityMobileTab, element: HTMLButtonElement | null) => {
      if (tab === "about") mobileAboutOpenerRef.current = element;
      if (tab === "members") {
        mobileMembersOpenerRef.current = element;
      }
      if (tab === "posts") mobilePostsOpenerRef.current = element;
      if (tab === "rooms") mobileRoomsOpenerRef.current = element;
    },
    [],
  );

  const handleSend = async () => {
    if (!profile || sending) return;
    const history = timeline
      .filter(
        (item): item is LiveRoomChatMessage =>
          item.kind === "message" && item.isMine === true,
      )
      .map((item) => ({ body: item.body, createdAt: item.createdAt }));
    const nextDecision = evaluateLiveRoomMessage(body, {
      allowEmpty: Boolean(klipyMedia),
      history,
      now: new Date().toISOString(),
    });
    setDecision(nextDecision);
    if (!nextDecision.allowed) return;

    setSending(true);
    setNotice(null);
    try {
      if (profileSaveTimerRef.current !== null) {
        window.clearTimeout(profileSaveTimerRef.current);
        profileSaveTimerRef.current = null;
        setProfile(
          await repository.writeProfile({
            displayName: profile.displayName,
            emoji: profile.emoji,
          }),
        );
      }
      const message = await repository.send({
        body: nextDecision.normalizedBody,
        mediaId: klipyMedia?.providerMediaId || null,
        proofId: brokerageProof?.id || null,
        replyToMessageId: replyingTo?.id || null,
      });
      setMembershipJoined(true);
      membershipRef.current = true;
      void refreshJoinedRooms();
      markLatestLoaded();
      forceOwnTimelineScrollRef.current = true;
      setTimeline((current) => mergeLiveRoomTimeline(current, [message]));
      setTimelineState("ready");
      scheduleTimelineScroll((element) => {
        element.scrollTo({
          behavior: "smooth",
          top: element.scrollHeight,
        });
        didInitialTimelineScrollRef.current = true;
        forceOwnTimelineScrollRef.current = false;
        timelineSticksToBottomRef.current = true;
        scheduleVisibleRead();
      });
      setBody("");
      setBrokerageProof(null);
      setKlipyMedia(null);
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

  const handleJoinRoom = async () => {
    if (membershipBusy || profile?.isGuest !== false) return;
    setMembershipBusy(true);
    setNotice(null);
    try {
      const state = await repository.joinRoom();
      setMembershipJoined(state.joined);
      membershipRef.current = state.joined;
      setRoomCounts(state);
      await refreshJoinedRooms();
      requestLiveRoomUnreadRefresh();
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setMembershipBusy(false);
    }
  };

  const handleLeaveRoom = async () => {
    if (membershipBusy || profile?.isGuest !== false) return;
    setMembershipBusy(true);
    setNotice(null);
    try {
      const state = await repository.leaveRoom();
      setMembershipJoined(state.joined);
      membershipRef.current = state.joined;
      setRoomCounts(state);
      await refreshJoinedRooms();
      requestLiveRoomUnreadRefresh();
      setNotice(
        "You left the room. Reading stays available; contributing again joins the room.",
      );
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMembershipBusy(false);
    }
  };

  const handlePresenceSettingChange = async (nextShowPresence: boolean) => {
    if (presenceSettingBusy || profile?.isGuest !== false) return;
    const previous = showPresence;
    setPresenceSettingBusy(true);
    setNotice(null);
    try {
      const setting = await repository.writePresenceSetting(nextShowPresence);
      setShowPresence(setting.showPresence);
      if (!setting.showPresence) {
        setTimeline((current) => clearLiveRoomPresence(current));
      }
    } catch (error) {
      setShowPresence(previous);
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setPresenceSettingBusy(false);
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
        likeCount: Math.max(0, message.likeCount + (liked ? 1 : -1)),
      }),
    );
    setNotice(null);

    try {
      const result = await repository.setMessageLike(message.id, liked);
      setTimeline((current) =>
        updateLiveRoomMessageEngagement(current, result.messageId, {
          isLiked: result.liked,
          likeCount: result.likeCount,
        }),
      );
    } catch (error) {
      setTimeline((current) =>
        updateLiveRoomMessageEngagement(current, message.id, previous),
      );
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      messageLikeIdsRef.current.delete(message.id);
      setMessageLikeIds(new Set(messageLikeIdsRef.current));
    }
  };

  const handleOpenReplyTarget = (messageId: string) => {
    if (
      !timeline.some((item) => item.kind === "message" && item.id === messageId)
    ) {
      return;
    }
    setActiveTab("chat");
    setHighlightedMessageId(messageId);
    if (replyScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(replyScrollFrameRef.current);
    }
    replyScrollFrameRef.current = window.requestAnimationFrame(() => {
      replyScrollFrameRef.current = null;
      document
        .getElementById(`live-room-message-${messageId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
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
      setTimeline((current) => mergeLiveRoomTimeline(page.items, current));
      setOlderCursor(page.nextCursor);
      setNotice(null);
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleLatest = async () => {
    if (loadingLatest) return;
    setLoadingLatest(true);
    setNotice(null);
    try {
      const page = await repository.list();
      markLatestLoaded();
      forceOwnTimelineScrollRef.current = true;
      setTimeline(replaceLiveRoomTimeline(page.items));
      setOlderCursor(page.nextCursor);
      setTimelineState(page.items.length ? "ready" : "empty");
      scheduleTimelineScroll((element) => {
        element.scrollTo({
          behavior: "auto",
          top: element.scrollHeight,
        });
        didInitialTimelineScrollRef.current = true;
        forceOwnTimelineScrollRef.current = false;
        timelineSticksToBottomRef.current = true;
        handleTimelineScroll();
        scheduleVisibleRead();
      });
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setLoadingLatest(false);
    }
  };

  const handleReport = async (
    messageId: string,
    reason: LiveRoomReportReason,
  ) => {
    setMessageActionId(messageId);
    try {
      await repository.report(messageId, reason);
      setNotice("Report received. Thank you for helping keep the room useful.");
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMessageActionId(null);
    }
  };

  const handleBlock = async (messageId: string) => {
    setMessageActionId(messageId);
    try {
      const result = await repository.block(messageId);
      setTimeline((current) => {
        const next = removeLiveRoomTimelineItems(
          current,
          new Set(result.removedMessageIds),
        );
        setTimelineState(next.length ? "ready" : "empty");
        return next;
      });
      setBlocks((current) => [
        result.block,
        ...current.filter((item) => item.id !== result.block.id),
      ]);
      setNotice(`${result.block.displayName} is blocked.`);
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
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
    setNotice(null);
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
      setNotice(result.followed ? "Member followed." : "Member unfollowed.");
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMessageActionId(null);
    }
  };

  const handleMessageMember = async (messageId: string) => {
    setMessageActionId(messageId);
    setNotice(null);
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
        router.push(`/messages/${encodeURIComponent(result.conversationId)}`);
      }
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
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
      router.push(`/messages/${encodeURIComponent(result.conversationId)}`);
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
    try {
      await repository.unblock(blockId);
      setBlocks((current) => current.filter((item) => item.id !== blockId));
      updatesSubscriptionRef.current?.close();
      updatesSubscriptionRef.current = null;
      const generation = timelineGenerationRef.current + 1;
      timelineGenerationRef.current = generation;
      const page = await repository.list();
      if (
        !isCurrentLiveRoomTimelineGeneration(
          timelineGenerationRef.current,
          generation,
        )
      ) {
        return;
      }
      setTimeline(replaceLiveRoomTimeline(page.items));
      setTimelineState(page.items.length ? "ready" : "empty");
      setOlderCursor(page.nextCursor);
      setNotice("Author unblocked.");
      setReloadKey((value) => value + 1);
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setMessageActionId(null);
    }
  };

  const handleModerate = async (
    messageId: string,
    action: "hide" | "restore",
  ) => {
    setMessageActionId(messageId);
    try {
      const result = await repository.moderate(
        messageId,
        action,
        action === "hide"
          ? "Hidden from the Community Room message menu"
          : "Restored from the Community Room moderation panel",
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
          mergeLiveRoomTimeline(current, [result.message!]),
        );
        setTimelineState("ready");
      }
      setHiddenMessages(await repository.listHiddenMessages());
      setNotice(action === "hide" ? "Message hidden." : "Message restored.");
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
      throw error;
    } finally {
      setMessageActionId(null);
    }
  };

  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <div
        className={roomStyles.page}
        data-ad-enabled={adsEnabledForViewer ? "true" : "false"}
      >
        <div
          className={roomStyles.roomHeaderRow}
          data-ad-enabled={adsEnabledForViewer ? "true" : undefined}
        >
          <CommunityRoomHeader
            isGuest={profile?.isGuest === true}
            loginHref={roomLoginHref}
            membershipBusy={membershipBusy}
            membershipJoined={membershipJoined}
            onJoin={handleJoinRoom}
            onLeave={handleLeaveRoom}
            room={room}
            roomCounts={roomCounts}
          />
          <LiveRoomHeaderAdSlot enabledForViewer={adsEnabledForViewer} />
        </div>

        <LiveRoomMobileInlineAdSlot enabledForViewer={adsEnabledForViewer} />

        {membershipJoined ? (
          <div className={roomStyles.followNote}>
            <p>
              Joined. This room stays in My Rooms and tracks unread activity
              until you choose Leave room.
            </p>
          </div>
        ) : null}
        <RoomTabs
          active={activeTab}
          items={[
            { label: "Chat", value: "chat" },
            { label: "Posts", value: "posts" },
            { label: "About", value: "about" },
          ]}
          onChange={handleDesktopTabChange}
          visibility="desktop"
        />
        <RoomTabs
          active={mobileSheet ?? "chat"}
          dockOnMobile
          idPrefix="live-room-mobile"
          items={communityMobileTabs}
          onChange={handleMobileTabChange}
          onItemElementChange={handleMobileTabElementChange}
          visibility="mobile"
        />

        <div className={roomStyles.workspaceLayout}>
          <div className={roomStyles.primaryColumn}>
            {activeTab === "about" ? (
              <section
                aria-labelledby="live-room-about-tab"
                className={roomStyles.desktopTabPanel}
                id="live-room-about-panel"
                role="tabpanel"
              >
                <CommunityRoomAbout room={room} />
              </section>
            ) : null}

            {activeTab === "posts" ? (
              <div className={roomStyles.desktopTabPanel}>
                <PostsPanel
                  cursor={postsCursor}
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

            <div
              aria-labelledby="live-room-chat-tab"
              className={roomStyles.roomLayout}
              data-desktop-hidden={activeTab !== "chat"}
              id="live-room-chat-panel"
              role="tabpanel"
            >
              <section
                aria-label={`${room.name} Community Room discussion`}
                className={roomStyles.chatPanel}
              >
                <div className={roomStyles.timelineViewport}>
                  <div
                    className={roomStyles.timeline}
                    onScroll={handleTimelineScroll}
                    ref={timelineElementRef}
                  >
                    {notice ? (
                      <p className={roomStyles.roomNotice} role="status">
                        {notice}
                      </p>
                    ) : null}
                    {blocks.length > 0 ||
                    (profile?.canModerate && hiddenMessages.length > 0) ? (
                      <div className={roomStyles.roomManagement}>
                        {blocks.length > 0 ? (
                          <button
                            aria-expanded={blocksOpen}
                            onClick={() => setBlocksOpen((value) => !value)}
                            type="button"
                          >
                            Blocked {blocks.length}
                          </button>
                        ) : null}
                        {profile?.canModerate && hiddenMessages.length > 0 ? (
                          <button
                            aria-expanded={moderationOpen}
                            onClick={() => setModerationOpen((value) => !value)}
                            type="button"
                          >
                            Hidden {hiddenMessages.length}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {blocksOpen && blocks.length > 0 ? (
                      <div
                        aria-label="Blocked Community Room authors"
                        className={roomStyles.managementPanel}
                      >
                        {blocks.map((block) => (
                          <div key={block.id}>
                            <span aria-hidden="true">{block.emoji}</span>
                            <strong>{block.displayName}</strong>
                            <button
                              disabled={messageActionId === block.id}
                              onClick={() => void handleUnblock(block.id)}
                              type="button"
                            >
                              Unblock
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {profile?.canModerate &&
                    moderationOpen &&
                    hiddenMessages.length > 0 ? (
                      <div
                        aria-label="Hidden Community Room messages"
                        className={roomStyles.managementPanel}
                      >
                        {hiddenMessages.map((message) => (
                          <div key={message.id}>
                            <span aria-hidden="true">
                              {message.author.emoji}
                            </span>
                            <p>
                              <strong>{message.author.displayName}</strong>
                              {" · "}
                              {message.body}
                            </p>
                            <button
                              disabled={messageActionId === message.id}
                              onClick={() =>
                                void handleModerate(message.id, "restore")
                              }
                              type="button"
                            >
                              Restore
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {olderCursor && timelineState === "ready" ? (
                      <button
                        className={roomStyles.loadOlderButton}
                        disabled={loadingOlder}
                        onClick={handleLoadOlder}
                        type="button"
                      >
                        {loadingOlder ? "Loading…" : "Load older messages"}
                      </button>
                    ) : null}
                    <ChatTimeline
                      ariaLabel={`${room.name} Community Room messages`}
                      canModerate={profile?.canModerate === true}
                      currentProfileName={profile?.displayName.trim() || ""}
                      emptyDescription="Share the first useful thought with the room."
                      emptyTitle="Start this community discussion."
                      firstUnreadMessageId={firstUnreadMessageId}
                      highlightedMessageId={highlightedMessageId}
                      items={timeline}
                      loginHref={roomLoginHref}
                      messageActionId={messageActionId}
                      messageLikeIds={messageLikeIds}
                      onBlock={handleBlock}
                      onHide={(messageId) => handleModerate(messageId, "hide")}
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
                  {timelineState === "ready" &&
                  (!nearBottom || pendingUnreadCount > 0 || !isLatestLoaded) ? (
                    <LiveRoomLatestButton
                      busy={loadingLatest}
                      onClick={() => void handleLatest()}
                      unreadCount={pendingUnreadCount}
                    />
                  ) : null}
                </div>

                <MessageComposer
                  body={body}
                  decision={decision}
                  disabled={
                    profile === null ||
                    timelineState === "error" ||
                    timelineState === "loading"
                  }
                  eventReference={null}
                  focusRequestId={composerFocusRequestId}
                  loginHref={roomLoginHref}
                  onBodyChange={(nextBody) => {
                    setBody(nextBody);
                    setDecision(null);
                  }}
                  onClearReference={() => undefined}
                  onCancelReply={() => setReplyingTo(null)}
                  onPresenceSettingChange={handlePresenceSettingChange}
                  onProofChange={(proof) => {
                    setBrokerageProof(proof);
                    if (proof) setKlipyMedia(null);
                  }}
                  onMediaChange={(media) => {
                    setKlipyMedia(media);
                    if (media) setBrokerageProof(null);
                  }}
                  onProfileChange={handleProfileChange}
                  onSend={handleSend}
                  placeholder="Share a useful view with this community…"
                  presenceSettingBusy={presenceSettingBusy}
                  media={klipyMedia}
                  proof={brokerageProof}
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
                          mediaPreview: replyingTo.media
                            ? {
                                alt: replyingTo.media.alt,
                                kind: "gif",
                                previewUrl: replyingTo.media.previewUrl,
                              }
                            : null,
                          messageId: replyingTo.id,
                        }
                      : null
                  }
                  sending={sending}
                  setProfileOpen={setProfileOpen}
                  showPresence={showPresence}
                />
              </section>
            </div>
          </div>

          <div className={roomStyles.desktopRail}>
            <LiveRoomDesktopSidePanel
              aboutContent={<CommunityRoomAbout compact room={room} />}
              currentRoomHref={`/live/community/${room.slug}`}
              eventSource="api"
              events={[]}
              isGuest={profile?.isGuest === true}
              joinedRooms={joinedRooms}
              joinedRoomsError={joinedRoomsError}
              joinedRoomsLoading={joinedRoomsLoading}
              loginHref={roomLoginHref}
              memberSummaries={memberSummaries}
              messageActionId={messageActionId}
              onChangeMainTab={(tab) =>
                handleDesktopTabChange(tab === "posts" ? "posts" : "chat")
              }
              onMessageMember={handleMessageMember}
              onOpenAbout={() => handleDesktopTabChange("about")}
              onRetryPosts={() => {
                void handleLoadPosts().catch(() => undefined);
              }}
              onToggleMemberFollow={handleMemberFollow}
              posts={posts}
              postsState={postsState}
              timeline={timeline}
            />
            <LiveRoomRailAdSlot enabledForViewer={adsEnabledForViewer} />
          </div>
        </div>
      </div>

      {mobileSheet ? (
        <BottomSheetShell
          aria-label={
            mobileSheet === "posts"
              ? "Posts"
              : mobileSheet === "about"
                ? "About"
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
              items={communityMobileTabs}
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
              : mobileSheet === "about"
                ? mobileAboutOpenerRef
                : mobileSheet === "members"
                  ? mobileMembersOpenerRef
                  : mobileRoomsOpenerRef
          }
          overlayLabel={`Close ${mobileSheet}`}
          viewport="mobile"
        >
          {mobileSheet === "posts" ? (
            <div className={roomStyles.mobileSheetContent}>
              <PostsPanel
                cursor={postsCursor}
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
          {mobileSheet === "about" ? (
            <div className={roomStyles.mobileSheetContent}>
              <CommunityRoomAbout room={room} />
            </div>
          ) : null}
          {mobileSheet === "members" ? (
            <div
              className={`${roomStyles.mobileSheetContent} ${roomStyles.mobileMembersSheetContent}`}
            >
              <header className={roomStyles.mobileSheetHeading}>
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
            <div className={roomStyles.mobileSheetContent}>
              <header className={roomStyles.mobileSheetHeading}>
                <h2>My Rooms</h2>
                <p>Only rooms you have joined appear here.</p>
              </header>
              {profile?.isGuest ? (
                <div className={roomStyles.joinedRoomsStatus}>
                  <Link href={roomLoginHref}>Sign in to view My Rooms</Link>
                </div>
              ) : (
                <JoinedRoomsList
                  currentHref={`/live/community/${room.slug}`}
                  data={joinedRooms}
                  error={joinedRoomsError}
                  loading={joinedRoomsLoading}
                />
              )}
              <Link
                className={roomStyles.mobileRoomsViewAll}
                href={profile?.isGuest ? roomLoginHref : "/live?view=joined"}
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
  );
}

function getModerationReason(code: string): ModerationReason {
  if (code.includes("DUPLICATE")) return "duplicate";
  if (code.includes("RATE_LIMIT")) return "rate_limit";
  if (code.includes("MAX_LENGTH")) return "max_length";
  if (code.includes("EXCESSIVE_LINKS")) return "excessive_links";
  if (code.includes("BLOCKED_WORD")) return "blocked_word";
  return "empty";
}
