"use client";

import Link from "next/link";
import {
  ArrowLeft,
  Heart,
  LoaderCircle,
  MessageCircle,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import {
  LiveRoomPostApiRepository,
  toLiveRoomApiError,
} from "@/lib/live-room/apiRepository";
import { createLiveRoomMemberLoginHref } from "@/lib/live-room/memberActions";
import type {
  LiveRoomPost,
  LiveRoomPostDraft,
  LiveRoomReportReason,
} from "@/lib/live-room/types";
import { PostComments } from "./PostComments";
import {
  PostSignalChips,
  PostSignalSelector,
} from "./PostSignals";
import styles from "./PostDetail.module.css";

export function PostDetailClient({ postId }: { postId: string }) {
  const repository = useMemo(() => new LiveRoomPostApiRepository(), []);
  const [post, setPost] = useState<LiveRoomPost | null>(null);
  const [state, setState] = useState<"error" | "loading" | "ready">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<LiveRoomPostDraft | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void repository
      .read(postId)
      .then((value) => {
        if (!active) return;
        setPost(value);
        setState("ready");
      })
      .catch((error) => {
        if (!active) return;
        setNotice(toLiveRoomApiError(error).message);
        setState("error");
      });
    return () => {
      active = false;
    };
  }, [postId, repository]);

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

  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <main className={styles.page}>
        {state === "loading" ? (
          <div aria-busy="true" className={styles.state}>
            <LoaderCircle aria-hidden="true" size={22} />
            Loading post…
          </div>
        ) : state === "error" || !post ? (
          <div className={styles.state} role="alert">
            <strong>Post unavailable</strong>
            <span>{notice || "This post may have been hidden or deleted."}</span>
            <Link href="/live">Browse Live Rooms</Link>
          </div>
        ) : (
          <article className={styles.article}>
            <Link className={styles.backLink} href={post.room.href}>
              <ArrowLeft aria-hidden="true" size={15} />
              Back to {post.room.label}
            </Link>
            <div className={styles.eyebrow}>Live Room Post</div>
            {editing && draft ? (
              <form
                className={styles.editForm}
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const updated = await repository.update(post.id, draft);
                    setPost(updated);
                    setEditing(false);
                    setNotice("Post updated.");
                  });
                }}
              >
                <label>
                  Title
                  <input
                    maxLength={120}
                    minLength={4}
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                    required
                    value={draft.title}
                  />
                </label>
                <label>
                  Body
                  <textarea
                    maxLength={10000}
                    minLength={20}
                    onChange={(event) =>
                      setDraft({ ...draft, body: event.target.value })
                    }
                    required
                    rows={14}
                    value={draft.body}
                  />
                </label>
                <PostSignalSelector
                  idPrefix={`edit-post-${post.id}-signal`}
                  onChange={(signalLabels) =>
                    setDraft({ ...draft, signalLabels })
                  }
                  value={draft.signalLabels}
                />
                <div className={styles.actions}>
                  <button disabled={busy} type="submit">Save changes</button>
                  <button onClick={() => setEditing(false)} type="button">Cancel</button>
                </div>
              </form>
            ) : (
              <>
                <h1>{post.title}</h1>
                <div className={styles.byline}>
                  <Link href={`/live/members/${post.author.publicProfileId}`}>
                    <span aria-hidden="true">{post.author.emoji}</span>
                    {post.author.displayName}
                  </Link>
                  <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
                  {post.updatedAt !== post.createdAt ? <span>Updated</span> : null}
                </div>
                <PostSignalChips signals={post.signalLabels} />
                {post.relatedTickers.length ? (
                  <div className={styles.chips}>
                    {post.relatedTickers.map((ticker) => (
                      <Link href={`/live/${ticker}`} key={ticker}>{ticker}</Link>
                    ))}
                  </div>
                ) : null}
                {post.eventReference ? (
                  <aside className={styles.event}>
                    <span>{post.eventReference.kind === "filing" ? "Filing" : "News"}</span>
                    <strong>{post.eventReference.title}</strong>
                  </aside>
                ) : null}
                <div className={styles.body}>{post.body}</div>
              </>
            )}

            {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

            {!editing ? (
              <div className={styles.actions}>
                {post.canLike ? (
                  <button
                    aria-label={post.isLiked ? "Unlike post" : "Like post"}
                    aria-pressed={post.isLiked}
                    className={styles.engagementAction}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await repository.toggleLike(post.id);
                        setPost((current) =>
                          current
                            ? {
                                ...current,
                                isLiked: result.liked,
                                likeCount: result.likeCount,
                              }
                            : current,
                        );
                      })
                    }
                    type="button"
                  >
                    <Heart
                      aria-hidden="true"
                      fill={post.isLiked ? "currentColor" : "none"}
                      size={15}
                    />
                    {post.likeCount}
                  </button>
                ) : (
                  <Link
                    aria-label="Sign in to like this post"
                    className={styles.engagementAction}
                    href={createLiveRoomMemberLoginHref(
                      `/live/posts/${post.id}`,
                    )}
                  >
                    <Heart aria-hidden="true" size={15} />
                    {post.likeCount}
                  </Link>
                )}
                <span
                  aria-label={`${post.commentCount} comments`}
                  className={styles.engagementCount}
                >
                  <MessageCircle aria-hidden="true" size={15} />
                  {post.commentCount}
                </span>
                <Link href={`${post.room.href}?tab=chat`}>Discuss in room Chat</Link>
                {post.isMine ? (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setDraft({
                          body: post.body,
                          eventId: post.eventReference?.eventId || null,
                          relatedTickers: post.relatedTickers,
                          signalLabels: post.signalLabels,
                          title: post.title,
                        });
                        setEditing(true);
                      }}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await repository.delete(post.id);
                          setPost(null);
                          setState("error");
                          setNotice("Post deleted.");
                        })
                      }
                      type="button"
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await repository.block(post.id);
                        setPost(null);
                        setState("error");
                        setNotice("Author blocked.");
                      })
                    }
                    type="button"
                  >
                    Block author
                  </button>
                )}
                {post.canModerate ? (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await repository.moderate(post.id, "hide", "Hidden from post detail");
                        setPost(null);
                        setState("error");
                        setNotice("Post hidden.");
                      })
                    }
                    type="button"
                  >
                    Hide
                  </button>
                ) : null}
                <ReportButtons
                  busy={busy}
                  onReport={(reason) =>
                    run(async () => {
                      await repository.report(post.id, reason);
                      setNotice("Report received.");
                    })
                  }
                />
              </div>
            ) : null}
            {!editing ? (
              <PostComments postId={post.id}
                onCommentCountChange={(delta) =>
                  setPost((current) =>
                    current
                      ? {
                          ...current,
                          commentCount: Math.max(
                            current.commentCount + delta,
                            0,
                          ),
                        }
                      : current,
                  )
                }
              />
            ) : null}
          </article>
        )}
      </main>
    </StockRadarAppShell>
  );
}

function ReportButtons({
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
        {(["spam", "harassment", "misinformation", "other"] as const).map((reason) => (
          <button
            disabled={busy}
            key={reason}
            onClick={() => void onReport(reason)}
            type="button"
          >
            {reason}
          </button>
        ))}
      </div>
    </details>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}
