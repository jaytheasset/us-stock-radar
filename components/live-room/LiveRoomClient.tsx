"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import {
  createCompanyRoomKey,
  createEventReference,
  getCompanyEventsApiHref,
  resolveCompanyEventSnapshot,
  selectLatestCompanyEvent,
  sortCompanyEvents,
  toCompanyEvent,
} from "@/lib/live-room/adapters";
import {
  createMockCompanyUpdate,
  getMockCompanyEvents,
  getMockCompanyIdentity,
} from "@/lib/live-room/mockData";
import {
  BrowserLiveRoomFollowRepository,
  BrowserLiveRoomProfileRepository,
  InMemoryLiveRoomMessageRepository,
} from "@/lib/live-room/mockRepository";
import {
  evaluateLiveRoomMessage,
  type ModerationDecision,
} from "@/lib/live-room/moderation";
import type {
  CompanyEvent,
  CompanyEventReference,
  CompanyEventSource,
  CompanyRoomIdentity,
  LiveRoomProfile,
  LiveRoomTimelineItem,
} from "@/lib/live-room/types";
import {
  mapStockOverviewEvents,
  mapStockOverviewProfile,
} from "@/lib/watchlist/stockOverview";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { ChatTimeline } from "./ChatTimeline";
import { CompanyEventCard } from "./CompanyEventCard";
import { CompanyRoomHeader } from "./CompanyRoomHeader";
import { EventHistoryPanel } from "./EventHistoryPanel";
import { MessageComposer } from "./MessageComposer";
import styles from "./LiveRoom.module.css";

type LiveRoomClientProps = {
  ticker: string;
};

type MockScenario = "empty" | "error" | "limited" | "loading" | "ready";

const defaultProfile: LiveRoomProfile = {
  displayName: "Guest",
  emoji: "👋",
  isGuest: true,
  plan: "free",
};

const forcedLimitDecision: ModerationDecision = {
  allowed: false,
  message:
    "Sending is paused in this Mock state. Choose Ready to continue.",
  reason: "rate_limit",
  retryAfterSeconds: 20,
};

export function LiveRoomClient({ ticker }: LiveRoomClientProps) {
  const fallbackCompany = useMemo(
    () => getMockCompanyIdentity(ticker),
    [ticker],
  );
  const roomKey = useMemo(
    () => createCompanyRoomKey({ ticker }),
    [ticker],
  );
  const [identity, setIdentity] = useState<CompanyRoomIdentity>({
    companyName: fallbackCompany.name,
    exchange: fallbackCompany.exchange,
    roomKey,
    ticker,
  });
  const [events, setEvents] = useState<CompanyEvent[]>([]);
  const [eventSource, setEventSource] =
    useState<CompanyEventSource>("loading");
  const [timeline, setTimeline] = useState<LiveRoomTimelineItem[]>([]);
  const [scenario, setScenario] = useState<MockScenario>("loading");
  const [body, setBody] = useState("");
  const [reference, setReference] =
    useState<CompanyEventReference | null>(null);
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [profile, setProfile] = useState(defaultProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const [followed, setFollowed] = useState(false);
  const [copyState, setCopyState] =
    useState<"copied" | "error" | "idle">("idle");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [newUpdateId, setNewUpdateId] = useState<string | null>(null);
  const updateSequenceRef = useRef(0);
  const mockSimulationActiveRef = useRef(false);
  const historyOpenerRef = useRef<HTMLButtonElement>(null);
  const messageRepositoryRef =
    useRef<InMemoryLiveRoomMessageRepository | null>(null);
  const followRepositoryRef =
    useRef<BrowserLiveRoomFollowRepository | null>(null);
  const profileRepositoryRef =
    useRef<BrowserLiveRoomProfileRepository | null>(null);

  if (!messageRepositoryRef.current) {
    messageRepositoryRef.current = new InMemoryLiveRoomMessageRepository();
  }
  if (!followRepositoryRef.current) {
    followRepositoryRef.current = new BrowserLiveRoomFollowRepository();
  }
  if (!profileRepositoryRef.current) {
    profileRepositoryRef.current = new BrowserLiveRoomProfileRepository();
  }

  const latestEvent = selectLatestCompanyEvent(events);
  const historicalEvents = latestEvent
    ? events.filter((event) => event.eventId !== latestEvent.eventId)
    : events;

  useEffect(() => {
    const repository = messageRepositoryRef.current;
    if (!repository) return;
    let active = true;
    const unsubscribe = repository.subscribe(roomKey, (items) => {
      if (active) setTimeline(items);
    });

    void repository.list(roomKey).then((items) => {
      if (active) {
        setTimeline(items);
        setScenario("ready");
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [roomKey]);

  useEffect(() => {
    const followRepository = followRepositoryRef.current;
    const profileRepository = profileRepositoryRef.current;
    if (!followRepository || !profileRepository) return;
    setFollowed(followRepository.read(roomKey).followed);
    setProfile(profileRepository.read());
  }, [roomKey]);

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
          fallbackCompany.name,
        );
        setIdentity({
          companyName: mappedProfile.companyName || fallbackCompany.name,
          exchange: mappedProfile.exchange || fallbackCompany.exchange,
          roomKey,
          ticker,
        });
      })
      .catch(() => {
        // Company identity already has deterministic local fallback metadata.
      });
    return () => controller.abort();
  }, [
    fallbackCompany.exchange,
    fallbackCompany.name,
    roomKey,
    ticker,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    mockSimulationActiveRef.current = false;
    setEvents([]);
    setEventSource("loading");

    void fetch(getCompanyEventsApiHref(ticker), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(readJsonResponse)
      .then((eventsPayload) => {
        if (
          controller.signal.aborted ||
          mockSimulationActiveRef.current
        ) {
          return;
        }
        const mappedEvents = mapStockOverviewEvents(eventsPayload)
          .filter((event) => event.ticker === ticker)
          .map(toCompanyEvent);
        const snapshot = resolveCompanyEventSnapshot({
          apiEvents: mappedEvents,
          fallbackEvents: getMockCompanyEvents(ticker),
          requestSucceeded: true,
        });
        setEvents(snapshot.events);
        setEventSource(snapshot.source);
      })
      .catch(() => {
        if (
          controller.signal.aborted ||
          mockSimulationActiveRef.current
        ) {
          return;
        }
        const snapshot = resolveCompanyEventSnapshot({
          apiEvents: [],
          fallbackEvents: getMockCompanyEvents(ticker),
          requestSucceeded: false,
        });
        setEvents(snapshot.events);
        setEventSource(snapshot.source);
      });
    return () => controller.abort();
  }, [ticker]);

  const handleProfileChange = (nextProfile: LiveRoomProfile) => {
    setProfile(nextProfile);
    profileRepositoryRef.current?.write(nextProfile);
  };

  const handleToggleFollow = () => {
    const nextFollowed = !followed;
    setFollowed(nextFollowed);
    followRepositoryRef.current?.write({
      followed: nextFollowed,
      notificationScope: "company_updates_only",
      roomKey,
    });
  };

  const handleCopyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyState("copied");
    } catch (_) {
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
    if (scenario === "limited") {
      setDecision(forcedLimitDecision);
      return;
    }

    const now = new Date().toISOString();
    const currentUserHistory = timeline
      .filter(
        (item) =>
          item.kind === "message" &&
          item.author.isGuest &&
          item.author.displayName === (profile.displayName.trim() || "Guest"),
      )
      .map((item) => ({
        body: item.kind === "message" ? item.body : "",
        createdAt: item.createdAt,
      }));
    const nextDecision = evaluateLiveRoomMessage(body, {
      history: currentUserHistory,
      now,
    });
    setDecision(nextDecision);
    if (!nextDecision.allowed) return;

    setSending(true);
    try {
      await messageRepositoryRef.current?.send(roomKey, {
        author: {
          ...profile,
          displayName: profile.displayName.trim() || "Guest",
        },
        body: nextDecision.normalizedBody,
        eventReference: reference,
      });
      setBody("");
      setReference(null);
      setDecision(null);
      setProfileOpen(false);
    } finally {
      setSending(false);
    }
  };

  const handleNewUpdate = async () => {
    updateSequenceRef.current += 1;
    const update = createMockCompanyUpdate(
      ticker,
      updateSequenceRef.current,
      latestEvent?.occurredAt,
    );
    mockSimulationActiveRef.current = true;
    setEvents((current) => {
      const mockBaseEvents =
        eventSource === "api" || eventSource === "loading"
          ? getMockCompanyEvents(ticker)
          : current;
      return sortCompanyEvents([update, ...mockBaseEvents]);
    });
    setEventSource("mock-simulation");
    setNewUpdateId(update.eventId);
    setScenario("ready");
    await messageRepositoryRef.current?.publishCompanyUpdate(roomKey, update);
  };

  const visibleTimeline =
    scenario === "empty" ? [] : timeline;
  const timelineState =
    scenario === "limited" ? "ready" : scenario;
  const displayedDecision =
    scenario === "limited" ? forcedLimitDecision : decision;

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
          <p className={styles.followNote}>
            Guest Follow is saved only in this browser. Account sync and
            push/email notifications are a later step.
          </p>
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
            <div className={styles.mockControls}>
              <label>
                Mock states
                <select
                  onChange={(event) =>
                    setScenario(event.target.value as MockScenario)
                  }
                  value={scenario}
                >
                  <option value="ready">Ready</option>
                  <option value="loading">Loading</option>
                  <option value="error">Error</option>
                  <option value="empty">Empty</option>
                  <option value="limited">Send limited</option>
                </select>
              </label>
              <button onClick={handleNewUpdate} type="button">
                New company update
              </button>
            </div>
          </div>
          {latestEvent ? (
            <CompanyEventCard event={latestEvent} latest />
          ) : (
            <p className={styles.panelEmpty}>
              {eventSource === "loading"
                ? "Loading company events…"
                : "No current company news or filing is available."}
            </p>
          )}
        </section>

        <div className={styles.roomLayout}>
          <section
            aria-label={`${ticker} company discussion`}
            className={styles.chatPanel}
          >
            <div className={styles.chatHeading}>
              <div>
                <span>Company discussion</span>
                <h2>{ticker} Live Room</h2>
              </div>
              <small>
                Mock messages reset on refresh. No database or realtime API is
                connected.
              </small>
            </div>
            <div className={styles.timeline}>
              <ChatTimeline
                currentProfileName={profile.displayName.trim() || "Guest"}
                items={visibleTimeline}
                state={timelineState}
              />
            </div>
            <MessageComposer
              body={body}
              decision={displayedDecision}
              disabled={scenario === "error" || scenario === "loading"}
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
  if (source === "mock-fallback") {
    return "Development Mock fallback · events API unavailable";
  }
  if (source === "mock-simulation") {
    return "Mock scenario · API events replaced, not combined";
  }
  return eventCount
    ? "Company events API"
    : "Company events API · no current events";
}
