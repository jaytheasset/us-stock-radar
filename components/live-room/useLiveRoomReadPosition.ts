"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  requestLiveRoomUnreadRefresh,
  type LiveRoomApiRepository,
  type LiveRoomMessagePage,
} from "@/lib/live-room/apiRepository";
import {
  getLiveRoomTimelineDistanceFromBottom,
  isLiveRoomTimelineNearBottom,
} from "@/lib/live-room/timelineScroll";
import type { LiveRoomTimelineItem } from "@/lib/live-room/types";
import {
  getUnreadMessageIdsThrough,
  countIncomingUnreadMessages,
} from "@/lib/live-room/readPosition";
import { getLatestVisibleLiveRoomMessageId } from "./liveRoomReadPosition";

export const LIVE_ROOM_MARK_READ_THROTTLE_MS = 800;

export function useLiveRoomReadPosition({
  membershipJoined,
  repository,
  timeline,
}: {
  membershipJoined: boolean | null;
  repository: LiveRoomApiRepository;
  timeline: readonly LiveRoomTimelineItem[];
}) {
  const timelineElementRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef(timeline);
  const membershipJoinedRef = useRef(membershipJoined === true);
  const timelineSticksToBottomRef = useRef(true);
  const firstUnreadMessageIdRef = useRef<string | null>(null);
  const isLatestLoadedRef = useRef(true);
  const knownTimelineIdsRef = useRef<Set<string>>(new Set());
  const lastMarkedCursorRef = useRef<string | null>(null);
  const markReadTimerRef = useRef<number | null>(null);
  const [firstUnreadMessageId, setFirstUnreadMessageId] =
    useState<string | null>(null);
  const [isLatestLoaded, setIsLatestLoaded] = useState(true);
  const [nearBottom, setNearBottom] = useState(true);
  const [pendingUnreadCount, setPendingUnreadCount] = useState(0);

  timelineRef.current = timeline;
  membershipJoinedRef.current = membershipJoined === true;

  const markVisibleReadPosition = useCallback(async () => {
    const container = timelineElementRef.current;
    if (!container || !membershipJoinedRef.current) return;
    const latestVisibleMessageId =
      getLatestVisibleLiveRoomMessageId(container, timelineRef.current);
    if (!latestVisibleMessageId) return;
    const latestVisibleMessage = timelineRef.current.find(
      (item) =>
        item.kind === "message" &&
        item.id === latestVisibleMessageId,
    );
    if (!latestVisibleMessage) return;
    const nextCursor = `${latestVisibleMessage.createdAt}:${latestVisibleMessage.id}`;
    if (
      lastMarkedCursorRef.current &&
      nextCursor <= lastMarkedCursorRef.current
    ) {
      return;
    }
    lastMarkedCursorRef.current = nextCursor;
    try {
      const result = await repository.markRead(latestVisibleMessageId);
      if (!result.markedRead) {
        lastMarkedCursorRef.current = null;
        return;
      }
      const latestLoadedMessageId = [...timelineRef.current]
        .reverse()
        .find((item) => item.kind === "message")?.id;
      if (
        isLatestLoadedRef.current &&
        latestLoadedMessageId === latestVisibleMessageId
      ) {
        firstUnreadMessageIdRef.current = null;
        setFirstUnreadMessageId(null);
        setPendingUnreadCount(0);
      } else {
        const newlyReadIds = getUnreadMessageIdsThrough(
          timelineRef.current,
          firstUnreadMessageIdRef.current,
          latestVisibleMessageId,
        );
        if (newlyReadIds.length) {
          const latestVisibleIndex = timelineRef.current.findIndex(
            (item) =>
              item.kind === "message" &&
              item.id === latestVisibleMessageId,
          );
          const nextFirstUnread =
            timelineRef.current
              .slice(latestVisibleIndex + 1)
              .find(
                (item) =>
                  item.kind === "message" &&
                  item.isMine !== true,
              )?.id ?? null;
          firstUnreadMessageIdRef.current = nextFirstUnread;
          setFirstUnreadMessageId(nextFirstUnread);
          setPendingUnreadCount((current) =>
            Math.max(0, current - newlyReadIds.length),
          );
        }
      }
      requestLiveRoomUnreadRefresh();
    } catch {
      lastMarkedCursorRef.current = null;
    }
  }, [repository]);

  const scheduleVisibleRead = useCallback(() => {
    if (markReadTimerRef.current !== null) {
      window.clearTimeout(markReadTimerRef.current);
    }
    markReadTimerRef.current = window.setTimeout(() => {
      markReadTimerRef.current = null;
      void markVisibleReadPosition();
    }, LIVE_ROOM_MARK_READ_THROTTLE_MS);
  }, [markVisibleReadPosition]);

  const handleTimelineScroll = useCallback(() => {
    const element = timelineElementRef.current;
    if (!element) return;
    const nextNearBottom = isLiveRoomTimelineNearBottom(
      getLiveRoomTimelineDistanceFromBottom(element),
    );
    timelineSticksToBottomRef.current = nextNearBottom;
    setNearBottom(nextNearBottom);
    scheduleVisibleRead();
  }, [scheduleVisibleRead]);

  const initializeReadPosition = useCallback(
    (page: LiveRoomMessagePage) => {
      firstUnreadMessageIdRef.current = page.firstUnreadMessageId;
      isLatestLoadedRef.current = page.isLatest;
      lastMarkedCursorRef.current = null;
      timelineSticksToBottomRef.current =
        page.initialMode === "latest";
      setFirstUnreadMessageId(page.firstUnreadMessageId);
      setIsLatestLoaded(page.isLatest);
      setNearBottom(page.initialMode === "latest");
      setPendingUnreadCount(page.unreadCount);
    },
    [],
  );

  const resetReadPosition = useCallback(() => {
    firstUnreadMessageIdRef.current = null;
    isLatestLoadedRef.current = true;
    knownTimelineIdsRef.current.clear();
    lastMarkedCursorRef.current = null;
    timelineSticksToBottomRef.current = true;
    setFirstUnreadMessageId(null);
    setIsLatestLoaded(true);
    setNearBottom(true);
    setPendingUnreadCount(0);
  }, []);

  const recordIncomingMessages = useCallback(
    (messages: readonly LiveRoomTimelineItem[]) => {
      if (!membershipJoinedRef.current) return;
      const incomingUnread = messages.filter(
        (item) =>
          !knownTimelineIdsRef.current.has(item.id) &&
          item.kind === "message" &&
          item.isMine !== true,
      );
      messages.forEach((item) =>
        knownTimelineIdsRef.current.add(item.id),
      );
      if (!incomingUnread.length) return;
      if (!firstUnreadMessageIdRef.current) {
        firstUnreadMessageIdRef.current = incomingUnread[0].id;
        setFirstUnreadMessageId(incomingUnread[0].id);
      }
      setPendingUnreadCount(
        (current) =>
          current + countIncomingUnreadMessages(incomingUnread),
      );
    },
    [],
  );

  const markLatestLoaded = useCallback(() => {
    isLatestLoadedRef.current = true;
    setIsLatestLoaded(true);
  }, []);

  useEffect(() => {
    timeline.forEach((item) =>
      knownTimelineIdsRef.current.add(item.id),
    );
    if (timeline.length) scheduleVisibleRead();
  }, [scheduleVisibleRead, timeline]);

  useEffect(
    () => () => {
      if (markReadTimerRef.current !== null) {
        window.clearTimeout(markReadTimerRef.current);
      }
    },
    [],
  );

  return {
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
  };
}
