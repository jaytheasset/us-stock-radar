"use client";

import {
  Heart,
  LoaderCircle,
  MessageCircle,
  UserCheck,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { DirectMessageRequestModal } from "@/components/direct-messages/DirectMessageRequestModal";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { DirectMessageApiRepository } from "@/lib/direct-messages/apiRepository";
import {
  LiveRoomPostApiRepository,
  toLiveRoomApiError,
} from "@/lib/live-room/apiRepository";
import { createLiveRoomMemberLoginHref } from "@/lib/live-room/memberActions";
import type {
  LiveRoomPost,
  LiveRoomPublicMember,
  LiveRoomPublicMemberActions,
} from "@/lib/live-room/types";
import styles from "./PostDetail.module.css";

type ProfileActionBusy = "follow" | "message" | "request" | null;

type MessageRequestTarget = {
  displayName: string;
  emoji: string;
  messageId: string;
};

export function PublicMemberProfileClient({
  publicProfileId,
}: {
  publicProfileId: string;
}) {
  const router = useRouter();
  const repository = useMemo(() => new LiveRoomPostApiRepository(), []);
  const directMessageRepository = useMemo(
    () => new DirectMessageApiRepository(),
    [],
  );
  const [member, setMember] = useState<LiveRoomPublicMember | null>(null);
  const [actions, setActions] =
    useState<LiveRoomPublicMemberActions | null>(null);
  const [posts, setPosts] = useState<LiveRoomPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] =
    useState<ProfileActionBusy>(null);
  const [messageRequestTarget, setMessageRequestTarget] =
    useState<MessageRequestTarget | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMember(null);
    setActions(null);
    setPosts([]);
    setCursor(null);
    setError(null);
    setActionError(null);

    void (async () => {
      try {
        // Let the existing public profile request establish a guest/member
        // cookie before loading actor-specific actions.
        const page = await repository.listMemberPosts(publicProfileId);
        let nextActions: LiveRoomPublicMemberActions | null = null;
        let nextActionError: string | null = null;
        try {
          nextActions =
            await repository.readMemberActions(publicProfileId);
        } catch (reason) {
          nextActionError = toLiveRoomApiError(reason).message;
        }
        if (!active) return;
        setMember(page.member);
        setPosts(page.items);
        setCursor(page.nextCursor);
        setActions(nextActions);
        setActionError(nextActionError);
      } catch (reason) {
        if (active) setError(toLiveRoomApiError(reason).message);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [publicProfileId, repository]);

  const loadOlder = async () => {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await repository.listMemberPosts(
        publicProfileId,
        cursor,
      );
      setPosts((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
      setError(null);
    } catch (reason) {
      setError(toLiveRoomApiError(reason).message);
    } finally {
      setLoading(false);
    }
  };

  const handleFollow = async () => {
    if (
      !actions?.canFollow ||
      actions.isGuest ||
      actions.isSelf ||
      actionBusy
    ) {
      return;
    }
    setActionBusy("follow");
    setActionError(null);
    try {
      const result = await repository.writeMemberFollow(
        publicProfileId,
        !actions.isFollowing,
      );
      setActions((current) =>
        current
          ? { ...current, isFollowing: result.followed }
          : current,
      );
    } catch (reason) {
      setActionError(toLiveRoomApiError(reason).message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleMessage = async () => {
    if (
      !actions?.canMessage ||
      !actions.sourceMessageId ||
      actions.isGuest ||
      actions.isSelf ||
      actionBusy
    ) {
      return;
    }
    setActionBusy("message");
    setActionError(null);
    try {
      const result = await directMessageRepository.start(
        actions.sourceMessageId,
      );
      if (result.mode === "request_required") {
        setMessageRequestTarget({
          displayName: result.peer.displayName,
          emoji: result.peer.emoji,
          messageId: actions.sourceMessageId,
        });
        return;
      }
      if (result.conversationId) {
        router.push(
          `/messages/${encodeURIComponent(result.conversationId)}`,
        );
      }
    } catch (reason) {
      setActionError(toLiveRoomApiError(reason).message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleSendMessageRequest = async (body: string) => {
    if (!messageRequestTarget || actionBusy) return;
    setActionBusy("request");
    setActionError(null);
    try {
      const result = await directMessageRepository.request(
        messageRequestTarget.messageId,
        body,
      );
      if (!result.conversationId) {
        throw new Error("The message request could not be opened.");
      }
      setMessageRequestTarget(null);
      router.push(
        `/messages/${encodeURIComponent(result.conversationId)}`,
      );
    } catch (reason) {
      setActionError(toLiveRoomApiError(reason).message);
    } finally {
      setActionBusy(null);
    }
  };

  const handleCloseMessageRequest = useCallback(() => {
    if (actionBusy === "request") return;
    setMessageRequestTarget(null);
    setActionError(null);
  }, [actionBusy]);

  const profilePath = `/live/members/${encodeURIComponent(
    publicProfileId,
  )}`;
  const loginHref = createLiveRoomMemberLoginHref(profilePath);
  const showActions =
    actions &&
    !actions.isSelf &&
    (actions.isGuest || actions.canFollow || actions.canMessage);

  return (
    <>
      <StockRadarAppShell
        activeNavigationItem={null}
        themeMode="user-selectable"
      >
        <main className={styles.profilePage}>
          {loading && !member ? (
            <div aria-busy="true" className={styles.state}>
              <LoaderCircle aria-hidden="true" size={22} />
              Loading member profile…
            </div>
          ) : error || !member ? (
            <div className={styles.state} role="alert">
              <strong>Member profile unavailable</strong>
              <span>{error}</span>
            </div>
          ) : (
            <>
              <header className={styles.profileHeader}>
                <div className={styles.profileIdentity}>
                  <span aria-hidden="true">{member.emoji}</span>
                  <div>
                    <small>Live Room member</small>
                    <h1>{member.displayName}</h1>
                    {member.brokerageConnected ? (
                      <span className={styles.profileBrokerageBadge}>
                        Brokerage connected
                      </span>
                    ) : null}
                    <span className={styles.profileReceivedLikes}>
                      <Heart aria-hidden="true" size={14} />
                      Received likes {member.receivedLikeCount}
                    </span>
                  </div>
                </div>
                {showActions ? (
                  <div
                    aria-label={`Actions for ${member.displayName}`}
                    className={styles.profileActions}
                    role="group"
                  >
                    {actions.isGuest ? (
                      <>
                        <Link
                          aria-label={`Sign in to follow ${member.displayName}`}
                          className={styles.profileActionButton}
                          href={loginHref}
                        >
                          <UserPlus aria-hidden="true" size={15} />
                          Follow
                        </Link>
                        <Link
                          aria-label={`Sign in to message ${member.displayName}`}
                          className={styles.profileActionButton}
                          href={loginHref}
                        >
                          <MessageCircle
                            aria-hidden="true"
                            size={15}
                          />
                          Message
                        </Link>
                      </>
                    ) : (
                      <>
                        {actions.canFollow ? (
                          <button
                            aria-label={
                              actions.isFollowing
                                ? `Unfollow ${member.displayName}`
                                : `Follow ${member.displayName}`
                            }
                            aria-pressed={actions.isFollowing}
                            className={styles.profileActionButton}
                            data-followed={actions.isFollowing}
                            disabled={Boolean(actionBusy)}
                            onClick={() => void handleFollow()}
                            type="button"
                          >
                            {actions.isFollowing ? (
                              <UserCheck
                                aria-hidden="true"
                                size={15}
                              />
                            ) : (
                              <UserPlus aria-hidden="true" size={15} />
                            )}
                            {actions.isFollowing ? "Following" : "Follow"}
                          </button>
                        ) : null}
                        {actions.canMessage ? (
                          <button
                            aria-label={`Message ${member.displayName}`}
                            className={styles.profileActionButton}
                            disabled={Boolean(actionBusy)}
                            onClick={() => void handleMessage()}
                            type="button"
                          >
                            <MessageCircle
                              aria-hidden="true"
                              size={15}
                            />
                            Message
                          </button>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
              </header>
              {actionError ? (
                <p className={styles.profileActionNotice} role="alert">
                  {actionError}
                </p>
              ) : null}
              <div
                aria-label="Member profile sections"
                className={styles.profileTabs}
                role="tablist"
              >
                <button aria-selected="true" role="tab" type="button">
                  Posts
                </button>
              </div>
              <section aria-labelledby="member-posts-title">
                <h2 id="member-posts-title">Visible posts</h2>
                <p className={styles.profileIntro}>
                  Public posts only. Chat messages are never included in
                  member history.
                </p>
                <div className={styles.profilePosts}>
                  {posts.length ? (
                    posts.map((post) => (
                      <article key={post.id}>
                        <small>
                          {post.room.label} · {formatDate(post.createdAt)}
                        </small>
                        <h3>
                          <Link href={`/live/posts/${post.id}`}>
                            {post.title}
                          </Link>
                        </h3>
                        <p>{post.body}</p>
                      </article>
                    ))
                  ) : (
                    <p>No visible posts yet.</p>
                  )}
                </div>
                {cursor ? (
                  <button
                    className={styles.loadMore}
                    disabled={loading}
                    onClick={() => void loadOlder()}
                    type="button"
                  >
                    {loading ? "Loading…" : "Load older posts"}
                  </button>
                ) : null}
              </section>
            </>
          )}
        </main>
      </StockRadarAppShell>
      {messageRequestTarget ? (
        <DirectMessageRequestModal
          busy={actionBusy === "request"}
          error={actionError}
          onCancel={handleCloseMessageRequest}
          onSubmit={handleSendMessageRequest}
          target={messageRequestTarget}
        />
      ) : null}
    </>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
      }).format(date);
}
