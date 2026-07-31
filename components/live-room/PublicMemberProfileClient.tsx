"use client";

import {
  Heart,
  LoaderCircle,
  MessageCircle,
  Pencil,
  UserCheck,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { formatPublicChatName } from "@/lib/live-room/chatIdentity";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DirectMessageRequestModal } from "@/components/direct-messages/DirectMessageRequestModal";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { DirectMessageApiRepository } from "@/lib/direct-messages/apiRepository";
import {
  LiveRoomApiRepository,
  LiveRoomPostApiRepository,
  toLiveRoomApiError,
} from "@/lib/live-room/apiRepository";
import { createLiveRoomMemberLoginHref } from "@/lib/live-room/memberActions";
import type {
  LiveRoomPost,
  LiveRoomProfile,
  LiveRoomPublicMember,
  LiveRoomPublicMemberActions,
} from "@/lib/live-room/types";
import { ChatNameSetup } from "./ChatNameSetup";
import styles from "./PostDetail.module.css";

type ProfileActionBusy = "follow" | "message" | "request" | null;

type MessageRequestTarget = {
  displayName: string;
  messageId: string;
};

export function PublicMemberProfileClient({
  publicProfileId,
}: {
  publicProfileId: string;
}) {
  const router = useRouter();
  const repository = useMemo(() => new LiveRoomPostApiRepository(), []);
  const profileRepository = useMemo(
    () => new LiveRoomApiRepository("PROFILE"),
    [],
  );
  const directMessageRepository = useMemo(
    () => new DirectMessageApiRepository(),
    [],
  );
  const [member, setMember] = useState<LiveRoomPublicMember | null>(null);
  const [ownProfile, setOwnProfile] = useState<LiveRoomProfile | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
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
  const editProfileButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMember(null);
    setOwnProfile(null);
    setProfileOpen(false);
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
          if (nextActions.isSelf) {
            const currentProfile = await profileRepository.readProfile();
            if (active) setOwnProfile(currentProfile);
          }
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
  }, [profileRepository, publicProfileId, repository]);

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
  const publicDisplayName = formatPublicChatName(member?.displayName || "");

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
                  <MemberAvatar displayName={member.displayName} size="large" />
                  <div>
                    <small>Live Room member</small>
                    <h1>{publicDisplayName}</h1>
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
                    aria-label={`Actions for ${publicDisplayName}`}
                    className={styles.profileActions}
                    role="group"
                  >
                    {actions.isGuest ? (
                      <>
                        <Link
                          aria-label={`Sign in to follow ${publicDisplayName}`}
                          className={styles.profileActionButton}
                          href={loginHref}
                        >
                          <UserPlus aria-hidden="true" size={15} />
                          Follow
                        </Link>
                        <Link
                          aria-label={`Sign in to message ${publicDisplayName}`}
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
                                ? `Unfollow ${publicDisplayName}`
                                : `Follow ${publicDisplayName}`
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
                            aria-label={`Message ${publicDisplayName}`}
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
                ) : actions?.isSelf && ownProfile ? (
                  <div className={styles.profileActions}>
                    <button
                      className={styles.profileActionButton}
                      onClick={() => setProfileOpen(true)}
                      ref={editProfileButtonRef}
                      type="button"
                    >
                      <Pencil aria-hidden="true" size={15} />
                      Edit profile
                    </button>
                  </div>
                ) : null}
              </header>
              {member.bio ? (
                <section
                  aria-labelledby="member-about-title"
                  className={styles.profileAbout}
                >
                  <h2 id="member-about-title">About</h2>
                  <p>{member.bio}</p>
                </section>
              ) : null}
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
      {ownProfile && actions?.isSelf ? (
        <ChatNameSetup
          isOpen={profileOpen}
          onDismiss={() => setProfileOpen(false)}
          onPresenceSettingChange={() => undefined}
          onSave={async (nextProfile) => {
            const saved =
              await profileRepository.writeProfile(nextProfile);
            setOwnProfile(saved);
            setMember((current) =>
              current
                ? {
                    ...current,
                    bio: saved.bio,
                    displayName: saved.displayName,
                    emoji: saved.emoji,
                  }
                : current,
            );
            return saved;
          }}
          openerRef={editProfileButtonRef}
          presenceSettingBusy={false}
          profile={ownProfile}
          showPresence={null}
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
