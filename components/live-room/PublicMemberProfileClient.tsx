"use client";

import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import {
  LiveRoomPostApiRepository,
  toLiveRoomApiError,
} from "@/lib/live-room/apiRepository";
import type {
  LiveRoomPost,
  LiveRoomPublicMember,
} from "@/lib/live-room/types";
import styles from "./PostDetail.module.css";

export function PublicMemberProfileClient({
  publicProfileId,
}: {
  publicProfileId: string;
}) {
  const repository = useMemo(() => new LiveRoomPostApiRepository(), []);
  const [member, setMember] = useState<LiveRoomPublicMember | null>(null);
  const [posts, setPosts] = useState<LiveRoomPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async (before?: string | null) => {
    setLoading(true);
    try {
      const page = await repository.listMemberPosts(publicProfileId, before);
      setMember(page.member);
      setPosts((current) => (before ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError(null);
    } catch (reason) {
      setError(toLiveRoomApiError(reason).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // The route identifier changes only when the page changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicProfileId]);

  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
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
              <span aria-hidden="true">{member.emoji}</span>
              <div>
                <small>Live Room member</small>
                <h1>{member.displayName}</h1>
              </div>
            </header>
            <div aria-label="Member profile sections" className={styles.profileTabs} role="tablist">
              <button aria-selected="true" role="tab" type="button">Posts</button>
            </div>
            <section aria-labelledby="member-posts-title">
              <h2 id="member-posts-title">Visible posts</h2>
              <p className={styles.profileIntro}>
                Public posts only. Chat messages are never included in member history.
              </p>
              <div className={styles.profilePosts}>
                {posts.length ? posts.map((post) => (
                  <article key={post.id}>
                    <small>{post.room.label} · {formatDate(post.createdAt)}</small>
                    <h3><Link href={`/live/posts/${post.id}`}>{post.title}</Link></h3>
                    <p>{post.body}</p>
                  </article>
                )) : <p>No visible posts yet.</p>}
              </div>
              {cursor ? (
                <button
                  className={styles.loadMore}
                  disabled={loading}
                  onClick={() => void load(cursor)}
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
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
}
