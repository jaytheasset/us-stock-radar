"use client";

import Link from "next/link";
import { FileText, LoaderCircle, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  LiveRoomApiRepository,
  LiveRoomPostApiRepository,
  toLiveRoomApiError,
} from "@/lib/live-room/apiRepository";
import type {
  CompanyEvent,
  LiveRoomPost,
  LiveRoomPostDraft,
  LiveRoomPostPreview,
  LiveRoomProfile,
  LiveRoomReportReason,
} from "@/lib/live-room/types";
import styles from "./Posts.module.css";

export function PostsPanel({
  events = [],
  onCreated,
  profile,
  repository,
}: {
  events?: readonly CompanyEvent[];
  onCreated?: (preview: LiveRoomPostPreview) => void;
  profile: LiveRoomProfile | null;
  repository: LiveRoomApiRepository;
}) {
  const postRepository = useMemo(() => new LiveRoomPostApiRepository(), []);
  const [posts, setPosts] = useState<LiveRoomPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<"error" | "loading" | "ready">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tickers, setTickers] = useState("");
  const [eventId, setEventId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = async (before?: string | null) => {
    try {
      const page = await repository.listPosts(before);
      setPosts((current) =>
        before
          ? [...current, ...page.items.filter((post) => !current.some((item) => item.id === post.id))]
          : page.items,
      );
      setCursor(page.nextCursor);
      setState("ready");
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
      setState("error");
    }
  };

  useEffect(() => {
    void load();
    // The repository is stable for the current room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository]);

  const handleCreate = async () => {
    const relatedTickers = [
      ...new Set(
        tickers
          .split(/[\s,]+/)
          .map((ticker) => ticker.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    const draft: LiveRoomPostDraft = {
      body,
      eventId: eventId || null,
      relatedTickers,
      title,
    };
    setBusy(true);
    setNotice(null);
    try {
      const post = await repository.createPost(draft);
      setPosts((current) => [post, ...current]);
      onCreated?.({
        author: post.author,
        createdAt: post.createdAt,
        id: post.id,
        kind: "post_preview",
        room: post.room,
        title: post.title,
      });
      setTitle("");
      setBody("");
      setTickers("");
      setEventId("");
      setFormOpen(false);
      setNotice("Post published. A compact preview was added to Chat.");
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (post: LiveRoomPost) => {
    setActionId(post.id);
    try {
      await postRepository.delete(post.id);
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setNotice("Post deleted.");
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setActionId(null);
    }
  };

  const handleHide = async (post: LiveRoomPost) => {
    setActionId(post.id);
    try {
      await postRepository.moderate(
        post.id,
        "hide",
        "Hidden from the Live Room Posts list",
      );
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setNotice("Post hidden.");
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setActionId(null);
    }
  };

  const handleReport = async (
    post: LiveRoomPost,
    reason: LiveRoomReportReason,
  ) => {
    setActionId(post.id);
    try {
      await postRepository.report(post.id, reason);
      setNotice("Report received.");
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setActionId(null);
    }
  };

  const handleBlock = async (post: LiveRoomPost) => {
    setActionId(post.id);
    try {
      await postRepository.block(post.id);
      setPosts((current) =>
        current.filter(
          (item) =>
            item.author.publicProfileId !== post.author.publicProfileId,
        ),
      );
      setNotice(`${post.author.displayName} is blocked.`);
    } catch (error) {
      setNotice(toLiveRoomApiError(error).message);
    } finally {
      setActionId(null);
    }
  };

  return (
    <section
      aria-labelledby="live-room-posts-tab"
      className={styles.panel}
      id="live-room-posts-panel"
      role="tabpanel"
    >
      <div className={styles.panelHeader}>
        <div>
          <span>Member research</span>
          <h2 id="live-room-posts-title">Posts</h2>
          <p>Long-form views stay separate from chat and company events.</p>
        </div>
        {profile?.isGuest === false ? (
          <button onClick={() => setFormOpen((value) => !value)} type="button">
            <Plus aria-hidden="true" size={16} />
            New post
          </button>
        ) : null}
      </div>

      {profile?.isGuest ? (
        <div className={styles.signInNote}>
          <strong>Sign in to publish a post.</strong>
          <span>Public posts remain readable without an account. Use the account menu to sign in.</span>
        </div>
      ) : null}

      {formOpen && profile?.isGuest === false ? (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <label>
            Title
            <input
              maxLength={120}
              minLength={4}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </label>
          <label>
            Body
            <textarea
              maxLength={10000}
              minLength={20}
              onChange={(event) => setBody(event.target.value)}
              required
              rows={9}
              value={body}
            />
          </label>
          <label>
            Related tickers <small>Optional, up to 5</small>
            <input
              onChange={(event) => setTickers(event.target.value)}
              placeholder="NVDA, AMD"
              value={tickers}
            />
          </label>
          {events.length ? (
            <label>
              News or filing <small>Optional</small>
              <select
                onChange={(event) => setEventId(event.target.value)}
                value={eventId}
              >
                <option value="">No event attached</option>
                {events.slice(0, 30).map((event) => (
                  <option key={event.eventId} value={event.eventId}>
                    {event.kind === "filing" ? "Filing" : "News"} · {event.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              News or filing event ID <small>Optional; must match a related room ticker</small>
              <input
                onChange={(event) => setEventId(event.target.value)}
                placeholder="Event UUID"
                value={eventId}
              />
            </label>
          )}
          <div className={styles.formActions}>
            <button disabled={busy} type="submit">
              {busy ? <LoaderCircle aria-hidden="true" size={16} /> : null}
              Publish post
            </button>
            <button onClick={() => setFormOpen(false)} type="button">
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {notice ? <p className={styles.notice} role="status">{notice}</p> : null}

      {state === "loading" ? (
        <div aria-busy="true" className={styles.emptyState}>
          <LoaderCircle aria-hidden="true" size={20} />
          Loading posts…
        </div>
      ) : state === "error" ? (
        <div className={styles.emptyState} role="alert">
          <strong>Posts could not be loaded.</strong>
          <button onClick={() => void load()} type="button">Retry</button>
        </div>
      ) : posts.length ? (
        <div className={styles.list}>
          {posts.map((post) => (
            <article className={styles.card} key={post.id}>
              <div className={styles.authorLine}>
                <Link href={`/live/members/${post.author.publicProfileId}`}>
                  <span aria-hidden="true">{post.author.emoji}</span>
                  {post.author.displayName}
                </Link>
                <time dateTime={post.createdAt}>{formatPostDate(post.createdAt)}</time>
              </div>
              <h3>
                <Link href={`/live/posts/${post.id}`}>{post.title}</Link>
              </h3>
              <p>{post.body}</p>
              {post.relatedTickers.length ? (
                <div className={styles.chips}>
                  {post.relatedTickers.map((ticker) => (
                    <Link href={`/live/${ticker}`} key={ticker}>{ticker}</Link>
                  ))}
                </div>
              ) : null}
              {post.eventReference ? (
                <div className={styles.eventReference}>
                  {post.eventReference.kind === "filing" ? "Filing" : "News"} · {post.eventReference.title}
                </div>
              ) : null}
              <div className={styles.actions}>
                <Link href={`/live/posts/${post.id}`}>Read post</Link>
                {post.isMine ? (
                  <button
                    disabled={actionId === post.id}
                    onClick={() => void handleDelete(post)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" size={14} />
                    Delete
                  </button>
                ) : (
                  <button
                    disabled={actionId === post.id}
                    onClick={() => void handleBlock(post)}
                    type="button"
                  >
                    Block author
                  </button>
                )}
                {post.canModerate ? (
                  <button
                    disabled={actionId === post.id}
                    onClick={() => void handleHide(post)}
                    type="button"
                  >
                    Hide
                  </button>
                ) : null}
                <details>
                  <summary>
                    <ShieldAlert aria-hidden="true" size={14} />
                    Report
                  </summary>
                  <div>
                    {(["spam", "harassment", "misinformation", "other"] as const).map((reason) => (
                      <button
                        disabled={actionId === post.id}
                        key={reason}
                        onClick={() => void handleReport(post, reason)}
                        type="button"
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                </details>
              </div>
            </article>
          ))}
          {cursor ? (
            <button className={styles.loadMore} onClick={() => void load(cursor)} type="button">
              Load older posts
            </button>
          ) : null}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <FileText aria-hidden="true" size={22} />
          <strong>No posts yet.</strong>
          <span>Publish the first durable view for this room.</span>
        </div>
      )}
    </section>
  );
}

function formatPostDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
