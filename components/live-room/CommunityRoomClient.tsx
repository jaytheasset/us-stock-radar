"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Hash,
} from "lucide-react";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
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
import type {
  LiveRoomBlockedActor,
  LiveRoomChatMessage,
  LiveRoomModerationItem,
  LiveRoomProfile,
  LiveRoomPublicRoomCounts,
  LiveRoomReportReason,
  LiveRoomTimelineItem,
} from "@/lib/live-room/types";
import {
  getCommunityFocusTagLabel,
  getCommunityLanguageLabel,
  getCommunityRoomIndustryLabel,
  getCommunityRoomStyleLabel,
  getCommunityRoomThemeLabel,
  getCommunityTopicLabel,
  type CommunityRoom,
} from "@/lib/live-room/community";
import { ChatTimeline } from "./ChatTimeline";
import { LiveRoomInviteMenu } from "./LiveRoomInviteMenu";
import { MessageComposer } from "./MessageComposer";
import { PostsPanel } from "./PostsPanel";
import { RoomMembershipControl } from "./RoomMembershipControl";
import { RoomTabs, type LiveRoomTab } from "./RoomTabs";
import roomStyles from "./LiveRoom.module.css";
import styles from "./CommunityRooms.module.css";

type TimelineState = "empty" | "error" | "loading" | "ready";

export function CommunityRoomClient({
  realtimeConfig,
  room,
}: {
  realtimeConfig: LiveRoomRealtimeConfig | null;
  room: CommunityRoom;
}) {
  const repository = useMemo(
    () =>
      new LiveRoomApiRepository(
        { kind: "community", slug: room.slug },
        realtimeConfig,
      ),
    [realtimeConfig, room.slug],
  );
  const roomLoginHref = createLiveRoomMemberLoginHref(
    `/live/community/${room.slug}`,
  );
  const [timeline, setTimeline] = useState<LiveRoomTimelineItem[]>([]);
  const [timelineState, setTimelineState] =
    useState<TimelineState>("loading");
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [profile, setProfile] = useState<LiveRoomProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [body, setBody] = useState("");
  const [replyingTo, setReplyingTo] =
    useState<LiveRoomChatMessage | null>(null);
  const [composerFocusRequestId, setComposerFocusRequestId] =
    useState(0);
  const [highlightedMessageId, setHighlightedMessageId] =
    useState<string | null>(null);
  const [decision, setDecision] = useState<ModerationDecision | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<LiveRoomBlockedActor[]>([]);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [hiddenMessages, setHiddenMessages] = useState<
    LiveRoomModerationItem[]
  >([]);
  const [moderationOpen, setModerationOpen] = useState(false);
  const [messageActionId, setMessageActionId] =
    useState<string | null>(null);
  const [messageLikeIds, setMessageLikeIds] =
    useState<ReadonlySet<string>>(() => new Set());
  const [activeTab, setActiveTab] = useState<LiveRoomTab>("chat");
  const [membershipJoined, setMembershipJoined] =
    useState<boolean | null>(null);
  const [membershipBusy, setMembershipBusy] = useState(false);
  const [showPresence, setShowPresence] = useState<boolean | null>(null);
  const [presenceSettingBusy, setPresenceSettingBusy] = useState(false);
  const [roomCounts, setRoomCounts] =
    useState<LiveRoomPublicRoomCounts | null>(null);
  const profileSaveTimerRef = useRef<number | null>(null);
  const membershipRef = useRef(false);
  const presenceMessageIdsRef = useRef<string[]>([]);
  const replyScrollFrameRef = useRef<number | null>(null);
  const timelineGenerationRef = useRef(0);
  const messageLikeIdsRef = useRef<Set<string>>(new Set());
  const updatesSubscriptionRef = useRef<{ close: () => void } | null>(
    null,
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

    void (async () => {
      try {
        const nextProfile = await repository.readProfile();
        if (!isCurrent()) return;
        setProfile(nextProfile);
        const presenceSettingPromise = nextProfile.isGuest
          ? Promise.resolve(null)
          : repository.readPresenceSetting().catch(() => null);
        const [
          page,
          nextBlocks,
          nextHiddenMessages,
          membership,
          nextPresenceSetting,
        ] = await Promise.all([
          repository.list(),
          repository.listBlocks(),
          nextProfile.canModerate
            ? repository.listHiddenMessages()
            : Promise.resolve([]),
          repository.readMembership(),
          presenceSettingPromise,
        ]);
        if (!isCurrent()) return;
        setTimeline(replaceLiveRoomTimeline(page.items));
        setTimelineState(page.items.length ? "ready" : "empty");
        setOlderCursor(page.nextCursor);
        setBlocks(nextBlocks);
        setHiddenMessages(nextHiddenMessages);
        setMembershipJoined(membership.joined);
        membershipRef.current = membership.joined;
        setRoomCounts(membership);
        setShowPresence(
          nextProfile.isGuest
            ? false
            : nextPresenceSetting?.showPresence ?? null,
        );
        if (membership.joined) {
          void repository
            .markRead(null)
            .then(requestLiveRoomUnreadRefresh)
            .catch(() => undefined);
        }

        updates = repository.updates.subscribe({
          afterChange: page.latestChangeCursor,
          onError: (error) => {
            if (isCurrent()) {
              setNotice(
                `${error.message} Automatic retry is still active.`,
              );
            }
          },
          onMessages: (messages) => {
            if (!isCurrent()) return;
            setTimeline((current) =>
              mergeLiveRoomTimeline(current, messages),
            );
            setTimelineState("ready");
            if (membershipRef.current) {
              void repository
                .markRead(null)
                .then(requestLiveRoomUnreadRefresh)
                .catch(() => undefined);
            }
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
      }
    })();

    return () => {
      active = false;
      updates?.close();
      if (updatesSubscriptionRef.current === updates) {
        updatesSubscriptionRef.current = null;
      }
    };
  }, [reloadKey, repository]);

  useEffect(() => {
    presenceMessageIdsRef.current =
      getLiveRoomPresenceMessageIds(timeline);
  }, [timeline]);

  useEffect(() => {
    const canReadCounts =
      timelineState === "ready" || timelineState === "empty";
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
        const summary = await repository.readPresence(
          presenceMessageIdsRef.current,
        );
        if (!active) return;
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
      document.removeEventListener(
        "visibilitychange",
        refreshWhenVisible,
      );
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [profile?.isGuest, repository, showPresence, timelineState]);

  useEffect(
    () => () => {
      if (profileSaveTimerRef.current !== null) {
        window.clearTimeout(profileSaveTimerRef.current);
      }
      if (replyScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(replyScrollFrameRef.current);
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
        .catch((error) =>
          setNotice(toLiveRoomApiError(error).message),
        );
    }, 500);
  };

  const handleSend = async () => {
    if (!profile) return;
    const history = timeline
      .filter(
        (item): item is LiveRoomChatMessage =>
          item.kind === "message" && item.isMine === true,
      )
      .map((item) => ({ body: item.body, createdAt: item.createdAt }));
    const nextDecision = evaluateLiveRoomMessage(body, {
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
        replyToMessageId: replyingTo?.id || null,
      });
      setMembershipJoined(true);
      membershipRef.current = true;
      setTimeline((current) =>
        mergeLiveRoomTimeline(current, [message]),
      );
      setTimelineState("ready");
      setBody("");
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

  const handlePresenceSettingChange = async (
    nextShowPresence: boolean,
  ) => {
    if (presenceSettingBusy || profile?.isGuest !== false) return;
    const previous = showPresence;
    setPresenceSettingBusy(true);
    setNotice(null);
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
        likeCount: Math.max(
          0,
          message.likeCount + (liked ? 1 : -1),
        ),
      }),
    );
    setNotice(null);

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
      setNotice(toLiveRoomApiError(error).message);
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
      setTimeline((current) =>
        mergeLiveRoomTimeline(page.items, current),
      );
      setOlderCursor(page.nextCursor);
      setNotice(null);
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setLoadingOlder(false);
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

  const handleUnblock = async (blockId: string) => {
    setMessageActionId(blockId);
    try {
      await repository.unblock(blockId);
      setBlocks((current) =>
        current.filter((item) => item.id !== blockId),
      );
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
      setNotice(
        action === "hide" ? "Message hidden." : "Message restored.",
      );
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
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
      <main className={`${roomStyles.page} ${styles.communityPage}`}>
        <header className={styles.communityHeader}>
          <div>
            <Link className={styles.backLink} href="/live">
              <ArrowLeft aria-hidden="true" size={15} />
              Community Rooms
            </Link>
            <div className={styles.communityHeaderActions}>
              <RoomMembershipControl
                busy={membershipBusy}
                isGuest={profile?.isGuest === true}
                joined={membershipJoined}
                loginHref={roomLoginHref}
                onJoin={handleJoinRoom}
                onLeave={handleLeaveRoom}
                roomLabel={room.name}
              />
              <LiveRoomInviteMenu
                ariaLabel="Invite people to this Community Room"
                room={{
                  kind: "community",
                  name: room.name,
                  slug: room.slug,
                }}
              />
            </div>
            <span className={styles.eyebrow}>Community Room</span>
            <h1>{room.name}</h1>
            <p>{room.summary}</p>
            {roomCounts ? (
              <div className={styles.communityRoomCounts}>
                <strong>{roomCounts.memberCount} members</strong>
                {roomCounts.visitorCount > 0 ? (
                  <span>{roomCounts.visitorCount} visitors</span>
                ) : null}
                <span>{roomCounts.onlineCount} online</span>
              </div>
            ) : null}
            <div className={styles.metaList} hidden={activeTab !== "about"}>
              <span>{getCommunityTopicLabel(room.topic)}</span>
              <span>{getCommunityRoomStyleLabel(room.roomStyle)}</span>
              <span>{getCommunityLanguageLabel(room.language)}</span>
              {room.focusTags.map((tag) => (
                <span key={tag}>
                  <Hash aria-hidden="true" size={12} />
                  {getCommunityFocusTagLabel(tag)}
                </span>
              ))}
            </div>
            {room.themes.length || room.industries.length ? (
              <div
                aria-label="Room discovery themes and industries"
                className={styles.discoveryList}
                hidden={activeTab !== "about"}
              >
                {room.themes.map((theme) => (
                  <Link href={`/live?theme=${theme}`} key={`theme:${theme}`}>
                    Theme · {getCommunityRoomThemeLabel(theme)}
                  </Link>
                ))}
                {room.industries.map((industry) => (
                  <Link
                    href={`/live?industry=${industry}`}
                    key={`industry:${industry}`}
                  >
                    Industry · {getCommunityRoomIndustryLabel(industry)}
                  </Link>
                ))}
              </div>
            ) : null}
            {room.relatedTickers.length ? (
              <div
                aria-label="Related company tickers"
                className={styles.tickerList}
                hidden={activeTab !== "about"}
              >
                {room.relatedTickers.map((ticker) => (
                  <Link href={`/live/${ticker}`} key={ticker}>
                    {ticker}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </header>

        <RoomTabs
          active={activeTab}
          items={[
            { label: "Chat", value: "chat" },
            { label: "Posts", value: "posts" },
            { label: "About", value: "about" },
          ]}
          onChange={setActiveTab}
        />

        {activeTab === "about" ? (
          <section
            aria-labelledby="live-room-about-tab"
            className={`${roomStyles.chatPanel} ${styles.communityChat}`}
            id="live-room-about-panel"
            role="tabpanel"
          >
            <h2>About this room</h2>
            <p>{room.summary}</p>
            <small>
              Created {new Date(room.createdAt).toLocaleDateString("en-US")}
            </small>
          </section>
        ) : null}

        {activeTab === "posts" ? (
          <PostsPanel
            loginHref={roomLoginHref}
            onCreated={(preview) => {
              setMembershipJoined(true);
              membershipRef.current = true;
              setTimeline((current) =>
                mergeLiveRoomTimeline(current, [preview]),
              );
              setTimelineState("ready");
              setActiveTab("chat");
            }}
            profile={profile}
            repository={repository}
          />
        ) : null}

        <section
          aria-label={`${room.name} Community Room discussion`}
          aria-labelledby="live-room-chat-tab"
          className={`${roomStyles.chatPanel} ${styles.communityChat}`}
          hidden={activeTab !== "chat"}
          id="live-room-chat-panel"
          role="tabpanel"
        >
          <div className={roomStyles.chatTop}>
            <div className={roomStyles.chatHeading}>
              <div>
                <span>Open discussion</span>
                <h2>{room.name}</h2>
              </div>
              <small>
                Realtime updates · 45-second polling fallback
                {notice ? ` · ${notice}` : ""}
              </small>
            </div>
            <div className={roomStyles.roomManagement}>
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
                aria-label="Blocked Community Room authors"
                className={roomStyles.managementPanel}
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
                aria-label="Hidden Community Room messages"
                className={roomStyles.managementPanel}
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

          <div className={roomStyles.timeline}>
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
              highlightedMessageId={highlightedMessageId}
              items={timeline}
              loginHref={roomLoginHref}
              messageActionId={messageActionId}
              messageLikeIds={messageLikeIds}
              onBlock={handleBlock}
              onHide={(messageId) =>
                handleModerate(messageId, "hide")
              }
              onOpenReplyTarget={handleOpenReplyTarget}
              onReply={handleReply}
              onReport={handleReport}
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
            onProfileChange={handleProfileChange}
            onSend={handleSend}
            placeholder="Share a useful view with this community…"
            presenceSettingBusy={presenceSettingBusy}
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
            sending={sending}
            setProfileOpen={setProfileOpen}
            showPresence={showPresence}
          />
        </section>
      </main>
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
