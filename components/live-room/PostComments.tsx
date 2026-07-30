"use client";

import Link from "next/link";
import { LoaderCircle, MessageCircle, Reply } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveRoomApiRepository,
  LiveRoomPostApiRepository,
  toLiveRoomApiError,
} from "@/lib/live-room/apiRepository";
import type {
  LiveRoomPostComment,
  LiveRoomProfile,
  LiveRoomReportReason,
} from "@/lib/live-room/types";
import { ChatNameSetup } from "./ChatNameSetup";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { formatPublicChatName } from "@/lib/live-room/chatIdentity";
import styles from "./PostDetail.module.css";

export function PostComments({
  onCommentCountChange,
  postId,
}: {
  onCommentCountChange?: (delta: number) => void;
  postId: string;
}) {
  const repository = useMemo(() => new LiveRoomPostApiRepository(), []);
  const profileRepository = useMemo(
    () => new LiveRoomApiRepository("BBLG"),
    [],
  );
  const [comments, setComments] = useState<LiveRoomPostComment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [canComment, setCanComment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<LiveRoomPostComment | null>(null);
  const [editing, setEditing] = useState<LiveRoomPostComment | null>(null);
  const [editBody, setEditBody] = useState("");
  const [profile, setProfile] = useState<LiveRoomProfile | null>(null);
  const [profileSetupOpen, setProfileSetupOpen] = useState(false);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);
  const profileOpenerRef = useRef<HTMLElement | null>(null);
  const resumeCommentRef = useRef(false);
  const resumeEditRef = useRef(false);
  const suppressNextProfilePromptRef = useRef(false);

  const load = useCallback(
    async (after?: string | null) => {
      const page = await repository.listComments(postId, after);
      setCanComment(page.canComment);
      setNextCursor(page.nextCursor);
      setComments((current) => {
        if (!after) return orderComments(page.items);
        const byId = new Map(current.map((comment) => [comment.id, comment]));
        page.items.forEach((comment) => byId.set(comment.id, comment));
        return orderComments([...byId.values()]);
      });
    },
    [postId, repository],
  );

  useEffect(() => {
    let active = true;
    void load()
      .catch((error) => {
        if (active) setNotice(toLiveRoomApiError(error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [load]);

  useEffect(() => {
    void profileRepository.readProfile().then(setProfile).catch(() => undefined);
  }, [profileRepository]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  const createComment = async (skipProfileCheck = false) => {
    if (
      !skipProfileCheck &&
      profile?.isGuest === false &&
      profile.isChatNameSet === false
    ) {
      resumeCommentRef.current = true;
      setProfileSetupOpen(true);
      return;
    }
    await run(async () => {
      const created = await repository.createComment(postId, {
        body,
        parentCommentId: replyTo
          ? replyTo.parentCommentId || replyTo.id
          : null,
      });
      setComments((current) => orderComments([...current, created]));
      onCommentCountChange?.(1);
      setBody("");
      setReplyTo(null);
    });
  };

  const updateComment = async (skipProfileCheck = false) => {
    if (!editing) return;
    if (
      !skipProfileCheck &&
      profile?.isGuest === false &&
      profile.isChatNameSet === false
    ) {
      resumeEditRef.current = true;
      setProfileSetupOpen(true);
      return;
    }
    await run(async () => {
      const updated = await repository.updateComment(postId, editing.id, {
        body: editBody,
        parentCommentId: editing.parentCommentId,
      });
      setComments((current) =>
        current.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      );
      setEditing(null);
    });
  };

  return (
    <section className={styles.comments} aria-labelledby="post-comments-title">
      <div className={styles.commentsHeader}>
        <div>
          <span className={styles.commentsEyebrow}>Discussion</span>
          <h2 id="post-comments-title">Comments</h2>
        </div>
        <span>{comments.length}{nextCursor ? "+" : ""}</span>
      </div>

      {canComment ? (
        <form
          className={styles.commentComposer}
          onSubmit={(event) => {
            event.preventDefault();
            void createComment();
          }}
        >
          {replyTo ? (
            <div className={styles.replyContext}>
              Replying to {formatPublicChatName(replyTo.author.displayName)}
              <button onClick={() => setReplyTo(null)} type="button">
                Cancel
              </button>
            </div>
          ) : null}
          <textarea
            aria-label={replyTo ? "Write a reply" : "Write a comment"}
            maxLength={2000}
            onChange={(event) => setBody(event.target.value)}
            onFocus={() => {
              profileOpenerRef.current = commentInputRef.current;
              if (suppressNextProfilePromptRef.current) {
                suppressNextProfilePromptRef.current = false;
                return;
              }
              if (
                profile?.isGuest === false &&
                profile.isChatNameSet === false
              ) {
                setProfileSetupOpen(true);
              }
            }}
            placeholder={
              replyTo
                ? `Reply to ${formatPublicChatName(replyTo.author.displayName)}`
                : "Add context or ask a focused question"
            }
            required
            rows={3}
            value={body}
            ref={commentInputRef}
          />
          <div className={styles.composerFooter}>
            <span>{body.length}/2000</span>
            <button disabled={busy || !body.trim()} type="submit">
              {replyTo ? "Post reply" : "Post comment"}
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.commentSignIn}>
          <MessageCircle aria-hidden="true" size={18} />
          <span>Sign in to join this post discussion.</span>
          <Link
            href={`/login?next=${encodeURIComponent(`/live/posts/${postId}`)}`}
          >
            Sign in
          </Link>
        </div>
      )}

      {profile?.isGuest === false ? (
        <ChatNameSetup
          isOpen={profileSetupOpen}
          onDismiss={() => {
            suppressNextProfilePromptRef.current = true;
            resumeCommentRef.current = false;
            resumeEditRef.current = false;
            setProfileSetupOpen(false);
          }}
          onPresenceSettingChange={() => undefined}
          onSave={async (displayName) => {
            const saved = await profileRepository.writeProfile({
              displayName,
            });
            setProfile(saved);
            if (resumeCommentRef.current) {
              resumeCommentRef.current = false;
              window.setTimeout(() => void createComment(true), 0);
            } else if (resumeEditRef.current) {
              resumeEditRef.current = false;
              window.setTimeout(() => void updateComment(true), 0);
            }
            return saved;
          }}
          openerRef={profileOpenerRef}
          presenceSettingBusy={false}
          profile={profile}
          showPresence={null}
        />
      ) : null}

      {notice ? (
        <p className={styles.commentNotice} role="status">{notice}</p>
      ) : null}

      {loading ? (
        <div className={styles.commentsState} aria-busy="true">
          <LoaderCircle aria-hidden="true" size={17} />
          Loading comments...
        </div>
      ) : comments.length ? (
        <div className={styles.commentList}>
          {comments.map((comment) => (
            <article
              className={comment.parentCommentId ? styles.reply : undefined}
              id={`comment-${comment.id}`}
              key={comment.id}
            >
              <div className={styles.commentMeta}>
                <Link href={`/live/members/${comment.author.publicProfileId}`}>
                  <MemberAvatar
                    displayName={comment.author.displayName}
                    size="small"
                  />
                  {formatPublicChatName(comment.author.displayName)}
                </Link>
                <time dateTime={comment.createdAt}>
                  {formatCommentDate(comment.createdAt)}
                </time>
                {comment.updatedAt !== comment.createdAt ? <span>Edited</span> : null}
              </div>

              {editing?.id === comment.id ? (
                <form
                  className={styles.commentEdit}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void updateComment();
                  }}
                >
                  <textarea
                    maxLength={2000}
                    onChange={(event) => setEditBody(event.target.value)}
                    onFocus={(event) => {
                      profileOpenerRef.current = event.currentTarget;
                      if (suppressNextProfilePromptRef.current) {
                        suppressNextProfilePromptRef.current = false;
                        return;
                      }
                      if (
                        profile?.isGuest === false &&
                        profile.isChatNameSet === false
                      ) {
                        setProfileSetupOpen(true);
                      }
                    }}
                    required
                    rows={3}
                    value={editBody}
                  />
                  <div>
                    <button disabled={busy} type="submit">Save</button>
                    <button onClick={() => setEditing(null)} type="button">
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <p>{comment.body}</p>
              )}

              {editing?.id !== comment.id ? (
                <div className={styles.commentActions}>
                  {canComment ? (
                    <button onClick={() => setReplyTo(comment)} type="button">
                      <Reply aria-hidden="true" size={13} />
                      Reply
                    </button>
                  ) : null}
                  {comment.isMine ? (
                    <>
                      <button
                        onClick={() => {
                          setEditing(comment);
                          setEditBody(comment.body);
                        }}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await repository.deleteComment(postId, comment.id);
                            const removedCount = comments.filter(
                              (item) =>
                                item.id === comment.id ||
                                item.parentCommentId === comment.id,
                            ).length;
                            setComments((current) =>
                              current.filter(
                                (item) =>
                                  item.id !== comment.id &&
                                  item.parentCommentId !== comment.id,
                              ),
                            );
                            onCommentCountChange?.(-removedCount);
                            if (
                              replyTo?.id === comment.id ||
                              replyTo?.parentCommentId === comment.id
                            ) {
                              setReplyTo(null);
                            }
                          })
                        }
                        type="button"
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <CommentReport
                      busy={busy}
                      onReport={(reason) =>
                        run(async () => {
                          await repository.reportComment(
                            postId,
                            comment.id,
                            reason,
                          );
                          setNotice("Report received.");
                        })
                      }
                    />
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.commentsState}>
          No comments yet. Start with a focused question or useful context.
        </div>
      )}

      {nextCursor ? (
        <button
          className={styles.loadComments}
          disabled={busy}
          onClick={() => void run(() => load(nextCursor))}
          type="button"
        >
          Load more comments
        </button>
      ) : null}
    </section>
  );
}

function CommentReport({
  busy,
  onReport,
}: {
  busy: boolean;
  onReport: (reason: LiveRoomReportReason) => Promise<void>;
}) {
  return (
    <details>
      <summary>Report</summary>
      <div>
        {(["spam", "harassment", "misinformation", "other"] as const).map(
          (reason) => (
            <button
              disabled={busy}
              key={reason}
              onClick={() => void onReport(reason)}
              type="button"
            >
              {reason}
            </button>
          ),
        )}
      </div>
    </details>
  );
}

function compareComments(
  left: LiveRoomPostComment,
  right: LiveRoomPostComment,
) {
  return (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function orderComments(items: LiveRoomPostComment[]) {
  const ordered = [...items].sort(compareComments);
  const repliesByParent = new Map<string, LiveRoomPostComment[]>();
  const roots: LiveRoomPostComment[] = [];
  const orphans: LiveRoomPostComment[] = [];
  const ids = new Set(ordered.map((comment) => comment.id));

  for (const comment of ordered) {
    if (!comment.parentCommentId) {
      roots.push(comment);
      continue;
    }
    if (!ids.has(comment.parentCommentId)) {
      orphans.push(comment);
      continue;
    }
    const replies = repliesByParent.get(comment.parentCommentId) || [];
    replies.push(comment);
    repliesByParent.set(comment.parentCommentId, replies);
  }

  return roots.flatMap((root) => [
    root,
    ...(repliesByParent.get(root.id) || []),
  ]).concat(orphans);
}

function formatCommentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
