"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { DirectMessageRequestModal } from "@/components/direct-messages/DirectMessageRequestModal";
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
  LiveRoomModerationItem,
  LiveRoomPost,
  LiveRoomProfile,
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
import { ChatTimeline } from "./ChatTimeline";
import {
  CompanyEventCard,
  formatEventTime,
} from "./CompanyEventCard";
import { CompanyRoomHeader } from "./CompanyRoomHeader";
import { EventHistoryPanel } from "./EventHistoryPanel";
import { MessageComposer } from "./MessageComposer";
import {
  LiveRoomMobileInlineAdSlot,
  LiveRoomRailAdSlot,
} from "./LiveRoomAdSlots";
import { LiveRoomDesktopSidePanel } from "./LiveRoomDesktopSidePanel";
import { PostsPanel } from "./PostsPanel";
import { RoomTabs, type LiveRoomTab } from "./RoomTabs";
import styles from "./LiveRoom.module.css";

type LiveRoomClientProps = {
  activityMessageId: string | null;
  realtimeConfig: LiveRoomRealtimeConfig | null;
  ticker: string;
  viewerPlan: Plan;
};

type TimelineState = "empty" | "error" | "loading" | "ready";
type PostsState = "error" | "loading" | "ready";

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
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [profile, setProfile] = useState<LiveRoomProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [showPresence, setShowPresence] = useState<boolean | null>(null);
  const [presenceSettingBusy, setPresenceSettingBusy] = useState(false);
  const [onlineMemberCount, setOnlineMemberCount] = useState<
    number | null
  >(null);
  const [followed, setFollowed] = useState<boolean | null>(null);
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
  const [activeTab, setActiveTab] = useState<LiveRoomTab>("chat");
  const latestEventIdRef = useRef<string | null>(null);
  const followedRef = useRef(false);
  const historyOpenerRef = useRef<HTMLButtonElement>(null);
  const inviteResetTimerRef = useRef<number | null>(null);
  const markReadTimerRef = useRef<number | null>(null);
  const markedActivityMessageRef = useRef<string | null>(null);
  const profileSaveTimerRef = useRef<number | null>(null);
  const loadedTickerRef = useRef<string | null>(null);
  const timelineGenerationRef = useRef(0);
  const timelineElementRef = useRef<HTMLDivElement>(null);
  const timelineScrollFrameRef = useRef<number | null>(null);
  const timelineSticksToBottomRef = useRef(true);
  const didInitialTimelineScrollRef = useRef(false);
  const forceOwnSendScrollRef = useRef(false);
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
      forceOwnSendScrollRef.current = false;
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
      setOnlineMemberCount(null);
      setFollowed(null);
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
        const [
          page,
          preference,
          nextBlocks,
          nextHiddenMessages,
          nextPresenceSetting,
          nextPostsPage,
        ] =
          await Promise.all([
            repository.list(),
            repository.readFollow(),
            repository.listBlocks(),
            nextProfile.canModerate
              ? repository.listHiddenMessages()
              : Promise.resolve([]),
            presenceSettingPromise,
            postsPagePromise,
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
        setFollowed(preference.followed);
        setShowPresence(
          nextProfile.isGuest
            ? false
            : nextPresenceSetting?.showPresence ?? null,
        );
        followedRef.current = preference.followed;
        setBlocks(nextBlocks);
        setHiddenMessages(nextHiddenMessages);
        if (preference.followed) {
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
            if (followedRef.current) {
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
    const forcedByOwnSend = forceOwnSendScrollRef.current;
    if (
      previousTimelineTailIdRef.current === timelineTailId &&
      !forcedByOwnSend
    ) {
      return;
    }
    previousTimelineTailIdRef.current = timelineTailId;

    if (initial && highlightedMessageId) {
      didInitialTimelineScrollRef.current = true;
      forceOwnSendScrollRef.current = false;
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
      forceOwnSendScrollRef.current = false;
      return;
    }

    scheduleTimelineScroll((currentElement) => {
      currentElement.scrollTo({
        behavior: reason === "incoming" ? "smooth" : "auto",
        top: currentElement.scrollHeight,
      });
      forceOwnSendScrollRef.current = false;
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
    if (forceOwnSendScrollRef.current) return;

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
    const canRun =
      (timelineState === "ready" || timelineState === "empty") &&
      shouldRunLiveRoomPresence({
        documentVisible: true,
        isGuest: profile?.isGuest ?? null,
        showPresence,
      });
    if (!canRun) {
      setOnlineMemberCount(null);
      setTimeline((current) => clearLiveRoomPresence(current));
      return;
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
        const heartbeat = await repository.heartbeatPresence();
        if (!active) return;
        if (!heartbeat.recorded) {
          setShowPresence(false);
          return;
        }
        const summary = await repository.readPresence(
          presenceMessageIdsRef.current,
        );
        if (!active || document.visibilityState !== "visible") return;
        setOnlineMemberCount(summary.onlineMemberCount);
        setTimeline((current) =>
          applyLiveRoomPresence(current, summary),
        );
      } catch {
        if (active) {
          setOnlineMemberCount(null);
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

  const handleToggleFollow = async () => {
    if (followed === null) return;
    const previous = followed;
    const nextFollowed = !previous;
    setFollowed(nextFollowed);
    followedRef.current = nextFollowed;
    setRoomNotice(null);
    try {
      const saved = await repository.writeFollow({
        followed: nextFollowed,
        notificationScope: "new_chat_messages",
      });
      setFollowed(saved.followed);
      followedRef.current = saved.followed;
      requestLiveRoomUnreadRefresh();
    } catch (error) {
      setFollowed(previous);
      followedRef.current = previous;
      setRoomNotice(toLiveRoomApiError(error).message);
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
        setOnlineMemberCount(null);
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
    setActiveTab("chat");
  };

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
      });
      forceOwnSendScrollRef.current = true;
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
        forceOwnSendScrollRef.current = false;
        timelineSticksToBottomRef.current = true;
      });
      setBody("");
      setReference(null);
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
        <CompanyRoomHeader
          followed={followed}
          historyButtonRef={historyOpenerRef}
          identity={identity}
          inviteState={inviteState}
          onlineMemberCount={onlineMemberCount}
          onInvite={handleInvite}
          onOpenHistory={() => setActiveTab("events")}
          onToggleFollow={handleToggleFollow}
          quote={quote}
        />

        <LiveRoomMobileInlineAdSlot
          enabledForViewer={adsEnabledForViewer}
        />

        {followed ? (
          <div className={styles.followNote}>
            <p>
              Room saved. New chat messages from other people will be shown
              as unread.
            </p>
          </div>
        ) : null}

        <RoomTabs
          active={activeTab}
          dockOnMobile
          items={[
            { label: "Chat", value: "chat" },
            { label: "Posts", value: "posts" },
            { label: "Events", value: "events" },
          ]}
          onChange={setActiveTab}
        />

        <div className={styles.workspaceLayout}>
          <div className={styles.primaryColumn}>
        <section
          aria-labelledby="live-room-events-tab"
          className={styles.latestSection}
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
          <section className={styles.latestSection}>
            <EventHistoryPanel
              events={historicalEvents}
              onMention={handleMention}
            />
          </section>
        ) : null}

        {activeTab === "posts" ? (
          <PostsPanel
            cursor={postsCursor}
            events={events}
            onLoad={handleLoadPosts}
            onPostsChange={setPosts}
            onCreated={(preview) => {
              setTimeline((current) =>
                mergeLiveRoomTimeline(current, [preview]),
              );
              setTimelineState("ready");
            }}
            posts={posts}
            profile={profile}
            repository={repository}
            currentTicker={ticker}
            state={postsState}
          />
        ) : null}

        <div
          aria-labelledby="live-room-chat-tab"
          className={styles.roomLayout}
          hidden={activeTab !== "chat"}
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
                <Link
                  aria-label={`Open analysis for latest company update: ${latestEvent.title}`}
                  className={styles.latestChatEventStrip}
                  href={latestEvent.detailHref}
                >
                  <span
                    className={styles.latestChatEventKind}
                    data-kind={latestEvent.kind}
                  >
                    {latestEvent.kind === "filing" ? "Filing" : "News"}
                  </span>
                  <span className={styles.latestChatEventCopy}>
                    <small>Latest company update</small>
                    <strong>{latestEvent.title}</strong>
                  </span>
                  <time dateTime={latestEvent.occurredAt}>
                    {formatEventTime(latestEvent.occurredAt)}
                  </time>
                  <ArrowUpRight aria-hidden="true" size={14} />
                </Link>
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
                messageActionId={messageActionId}
                onBlock={handleBlock}
                onHide={(messageId) =>
                  handleModerate(messageId, "hide")
                }
                onMessageMember={handleMessageMember}
                onReport={handleReport}
                onToggleMemberFollow={handleMemberFollow}
                onRetry={() => setReloadKey((value) => value + 1)}
                state={timelineState}
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
              onBodyChange={(nextBody) => {
                setBody(nextBody);
                setDecision(null);
              }}
              onClearReference={() => setReference(null)}
              onProfileChange={handleProfileChange}
              onPresenceSettingChange={handlePresenceSettingChange}
              onSend={handleSend}
              profile={profile}
              profileOpen={profileOpen}
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
              eventSource={eventSource}
              events={events}
              onChangeMainTab={setActiveTab}
              onRetryPosts={() => {
                void handleLoadPosts().catch(() => undefined);
              }}
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
      </StockRadarAppShell>
      {messageRequestTarget ? (
        <DirectMessageRequestModal
          busy={messageRequestBusy}
          error={messageRequestError}
          onCancel={handleCloseMessageRequest}
          onSubmit={handleSendMessageRequest}
          target={messageRequestTarget}
        />
      ) : null}
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
