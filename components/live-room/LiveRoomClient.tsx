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
import { ChatTimeline } from "./ChatTimeline";
import { CompanyEventCard } from "./CompanyEventCard";
import { CompanyRoomHeader } from "./CompanyRoomHeader";
import { EventHistoryPanel } from "./EventHistoryPanel";
import { MessageComposer } from "./MessageComposer";
import styles from "./LiveRoom.module.css";

type LiveRoomClientProps = {
  realtimeConfig: LiveRoomRealtimeConfig | null;
  ticker: string;
};

type TimelineState = "empty" | "error" | "loading" | "ready";

const defaultProfile: LiveRoomProfile = {
  canModerate: false,
  displayName: "Guest",
  emoji: "👋",
  isGuest: true,
  plan: "free",
};

export function LiveRoomClient({
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
  const [profile, setProfile] = useState(defaultProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [roomNotice, setRoomNotice] = useState<string | null>(null);
  const [copyState, setCopyState] =
    useState<"copied" | "error" | "idle">("idle");
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
  const latestEventIdRef = useRef<string | null>(null);
  const followedRef = useRef(false);
  const historyOpenerRef = useRef<HTMLButtonElement>(null);
  const markReadTimerRef = useRef<number | null>(null);
  const profileSaveTimerRef = useRef<number | null>(null);

  const latestEvent = selectLatestCompanyEvent(events);
  const historicalEvents = latestEvent
    ? events.filter((event) => event.eventId !== latestEvent.eventId)
    : events;

  useEffect(() => {
    let active = true;
    let updates: ReturnType<
      typeof repository.updates.subscribe
    > | null = null;
    setTimeline([]);
    setTimelineState("loading");
    setOlderCursor(null);
    setRoomNotice(null);
    setBlocks([]);
    setHiddenMessages([]);

    void (async () => {
      try {
        // Resolve the member/guest profile first. For a new guest this lets the
        // browser store the server-issued HttpOnly identity cookie before the
        // room-scoped requests start.
        const nextProfile = await repository.readProfile();
        if (!active) return;
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
        if (!active) return;
        setTimeline(page.items);
        setOlderCursor(page.nextCursor);
        setTimelineState(page.items.length ? "ready" : "empty");
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
            if (!active) return;
            setTimeline((current) => mergeMessages(current, messages));
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
            if (!active || !messageIds.length) return;
            const removed = new Set(messageIds);
            setTimeline((current) => {
              const next = current.filter((item) => !removed.has(item.id));
              setTimelineState(next.length ? "ready" : "empty");
              return next;
            });
          },
          onSynced: () => {
            if (!active) return;
            setRoomNotice(null);

            if (nextProfile.canModerate) {
              void repository
                .listHiddenMessages()
                .then((messages) => {
                  if (active) setHiddenMessages(messages);
                })
                .catch((error) => {
                  if (active) {
                    setRoomNotice(toLiveRoomApiError(error).message);
                  }
                });
            }
          },
          onError: (error) => {
            if (active) {
              setRoomNotice(
                `${error.message} Automatic retry is still active.`,
              );
            }
          },
        });
      } catch (error) {
        if (!active) return;
        setRoomNotice(toLiveRoomApiError(error).message);
        setTimelineState("error");
      }
    })();

    return () => {
      active = false;
      updates?.close();
      if (markReadTimerRef.current !== null) {
        window.clearTimeout(markReadTimerRef.current);
        markReadTimerRef.current = null;
      }
    };
  }, [reloadKey, repository]);

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

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    window.setTimeout(() => setCopyState("idle"), 2_000);
  };

  const handleMention = (nextReference: CompanyEventReference) => {
    setReference(nextReference);
    setDecision(null);
    setHistoryOpen(false);
  };

  const handleSend = async () => {
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
      setTimeline((current) => mergeMessages(current, [message]));
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
      setTimeline((current) => mergeMessages(page.items, current));
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
        const next = current.filter((item) => !removed.has(item.id));
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
        mergeMessages(current, refreshedPage.items),
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
      const page = await repository.list();
      setTimeline((current) => mergeMessages(current, page.items));
      setTimelineState(page.items.length ? "ready" : "empty");
      setRoomNotice("Author unblocked.");
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
          const next = current.filter((item) => item.id !== messageId);
          setTimelineState(next.length ? "ready" : "empty");
          return next;
        });
      } else if (result.message) {
        setTimeline((current) =>
          mergeMessages(current, [result.message as LiveRoomChatMessage]),
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
          copyState={copyState}
          followed={followed}
          historyButtonRef={historyOpenerRef}
          identity={identity}
          onCopyInvite={handleCopyInvite}
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
              {profile.canModerate ? (
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
              {profile.canModerate && moderationOpen ? (
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
                canModerate={profile.canModerate === true}
                currentProfileName={profile.displayName.trim() || "Guest"}
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
              disabled={timelineState === "error" || timelineState === "loading"}
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

function mergeMessages(
  current: readonly LiveRoomTimelineItem[],
  incoming: readonly LiveRoomTimelineItem[],
) {
  const byId = new Map(
    current.map((item) => [item.id, item] as const),
  );
  incoming.forEach((item) => byId.set(item.id, item));
  return [...byId.values()].sort(
    (left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
      left.id.localeCompare(right.id),
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
