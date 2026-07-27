"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
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
  LiveRoomProfile,
  LiveRoomReportReason,
  LiveRoomTimelineItem,
} from "@/lib/live-room/types";
import {
  mapStockOverviewEvents,
  mapStockOverviewProfile,
} from "@/lib/watchlist/stockOverview";
import {
  isCurrentLiveRoomTimelineGeneration,
  mergeLiveRoomTimeline,
  removeLiveRoomTimelineItems,
  replaceLiveRoomTimeline,
} from "@/lib/live-room/timeline";
import { ChatTimeline } from "./ChatTimeline";
import { CompanyEventCard } from "./CompanyEventCard";
import { CompanyRoomHeader } from "./CompanyRoomHeader";
import { EventHistoryPanel } from "./EventHistoryPanel";
import { MessageComposer } from "./MessageComposer";
import styles from "./LiveRoom.module.css";

type LiveRoomClientProps = {
  activityMessageId: string | null;
  realtimeConfig: LiveRoomRealtimeConfig | null;
  ticker: string;
};

type TimelineState = "empty" | "error" | "loading" | "ready";

export function LiveRoomClient({
  activityMessageId,
  realtimeConfig,
  ticker,
}: LiveRoomClientProps) {
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
  const [eventSource, setEventSource] =
    useState<CompanyEventSource>("loading");
  const [timeline, setTimeline] = useState<LiveRoomTimelineItem[]>([]);
  const [timelineState, setTimelineState] =
    useState<TimelineState>("loading");
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [body, setBody] = useState("");
  const [reference, setReference] =
    useState<CompanyEventReference | null>(null);
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [profile, setProfile] = useState<LiveRoomProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [followed, setFollowed] = useState<boolean | null>(null);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);
  const [inviteState, setInviteState] =
    useState<LiveRoomInviteUiState>("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [blocks, setBlocks] = useState<LiveRoomBlockedActor[]>([]);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [hiddenMessages, setHiddenMessages] = useState<
    LiveRoomModerationItem[]
  >([]);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [messageActionId, setMessageActionId] =
    useState<string | null>(null);
  const [newUpdateId, setNewUpdateId] = useState<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] =
    useState<string | null>(null);
  const latestEventIdRef = useRef<string | null>(null);
  const followedRef = useRef(false);
  const historyOpenerRef = useRef<HTMLButtonElement>(null);
  const inviteResetTimerRef = useRef<number | null>(null);
  const markReadTimerRef = useRef<number | null>(null);
  const markedActivityMessageRef = useRef<string | null>(null);
  const profileSaveTimerRef = useRef<number | null>(null);
  const loadedTickerRef = useRef<string | null>(null);
  const timelineGenerationRef = useRef(0);
  const updatesSubscriptionRef = useRef<{ close: () => void } | null>(
    null,
  );

  const latestEvent = selectLatestCompanyEvent(events);
  const historicalEvents = latestEvent
    ? events.filter((event) => event.eventId !== latestEvent.eventId)
    : events;

  useEffect(
    () => () => {
      if (inviteResetTimerRef.current !== null) {
        window.clearTimeout(inviteResetTimerRef.current);
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
      setTimeline([]);
      setTimelineState("loading");
      setOlderCursor(null);
      setProfile(null);
      setProfileOpen(false);
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

        const [page, preference, nextBlocks, nextHiddenMessages] =
          await Promise.all([
            repository.list(),
            repository.readFollow(),
            repository.listBlocks(),
            nextProfile.canModerate
              ? repository.listHiddenMessages()
              : Promise.resolve([]),
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
        setFollowed(preference.followed);
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
    setHistoryOpen(false);
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
      setTimeline((current) =>
        mergeLiveRoomTimeline(current, [message]),
      );
      setTimelineState("ready");
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

  return (
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
          onInvite={handleInvite}
          onOpenHistory={() => setHistoryOpen(true)}
          onToggleFollow={handleToggleFollow}
        />

        {followed ? (
          <div className={styles.followNote}>
            <p>
              Room saved. New chat messages from other people will be shown
              as unread.
            </p>
          </div>
        ) : null}

        <section className={styles.latestSection}>
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

        <div className={styles.roomLayout}>
          <section
            aria-label={`${ticker} company discussion`}
            className={styles.chatPanel}
          >
            <div className={styles.chatTop}>
              <div className={styles.chatHeading}>
              <div>
                <span>Company discussion</span>
                <h2>{ticker} Live Room</h2>
              </div>
              <small>
                Realtime updates · 45-second polling fallback
                {roomNotice ? ` · ${roomNotice}` : ""}
              </small>
              </div>
              <div className={styles.roomManagement}>
              <button
                aria-expanded={blocksOpen}
                onClick={() => setBlocksOpen((value) => !value)}
                type="button"
              >
                Blocked {blocks.length}
              </button>
              {profile?.canModerate ? (
                <button
                  aria-expanded={moderationOpen}
                  onClick={() =>
                    setModerationOpen((value) => !value)
                  }
                  type="button"
                >
                  Hidden {hiddenMessages.length}
                </button>
              ) : null}
              </div>
              {blocksOpen ? (
              <div
                aria-label="Blocked Live Room authors"
                className={styles.managementPanel}
              >
                {blocks.length ? (
                  blocks.map((block) => (
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
                  ))
                ) : (
                  <p>No blocked authors.</p>
                )}
              </div>
              ) : null}
              {profile?.canModerate && moderationOpen ? (
              <div
                aria-label="Hidden Live Room messages"
                className={styles.managementPanel}
              >
                {hiddenMessages.length ? (
                  hiddenMessages.map((message) => (
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
                  ))
                ) : (
                  <p>No hidden messages.</p>
                )}
              </div>
              ) : null}
            </div>
            <div className={styles.timeline}>
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
              onSend={handleSend}
              profile={profile}
              profileOpen={profileOpen}
              sending={sending}
              setProfileOpen={setProfileOpen}
            />
          </section>

          <aside className={styles.historyRail}>
            <EventHistoryPanel
              events={historicalEvents}
              onMention={handleMention}
            />
          </aside>
        </div>

        <BottomSheetShell
          aria-labelledby="live-room-history-title"
          closeLabel="Close past events"
          id="live-room-history-sheet"
          isOpen={historyOpen}
          layout="full-scroll"
          onDismiss={() => setHistoryOpen(false)}
          openerRef={historyOpenerRef}
          overlayLabel="Close past events"
          viewport="tablet"
        >
          <EventHistoryPanel
            events={historicalEvents}
            onMention={handleMention}
            titleId="live-room-history-title"
          />
        </BottomSheetShell>
      </div>
    </StockRadarAppShell>
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
