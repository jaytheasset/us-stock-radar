import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { CommunityRoomCreateDialog } from "@/components/live-room/CommunityRoomCreateDialog";
import {
  COMMUNITY_ROOM_FOCUS_TAGS,
  COMMUNITY_ROOM_LANGUAGES,
  COMMUNITY_ROOM_SORTS,
  COMMUNITY_ROOM_STYLES,
  COMMUNITY_ROOM_TOPICS,
  getCommunityFocusTagLabel,
  getCommunityLanguageLabel,
  getCommunityRoomStyleLabel,
  getCommunityTopicLabel,
  normalizeCommunityRoomDirectoryFilters,
  type CommunityRoomDirectoryPage,
} from "@/lib/live-room/community";
import {
  communityFiltersToSearchParams,
  listCommunityRooms,
} from "@/lib/live-room/communityServerRepository";
import styles from "@/components/live-room/CommunityRooms.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/live" },
  description:
    "Browse public member-created Community Rooms by topic, style, focus, and language.",
  title: "Community Rooms | Stock Radar",
};

type DirectoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommunityRoomDirectoryPage({
  searchParams,
}: DirectoryPageProps) {
  const query = await searchParams;
  const requestedFilters = {
    cursor: readQuery(query.cursor),
    focusTag: readQuery(query.tag),
    language: readQuery(query.language),
    roomStyle: readQuery(query.style),
    search: readQuery(query.q),
    sort: readQuery(query.sort),
    topic: readQuery(query.topic),
  };
  let directoryUnavailable = false;
  let page: CommunityRoomDirectoryPage;
  try {
    page = await listCommunityRooms(requestedFilters);
  } catch {
    directoryUnavailable = true;
    let filters: CommunityRoomDirectoryPage["filters"];
    try {
      filters = normalizeCommunityRoomDirectoryFilters(
        requestedFilters,
      );
    } catch {
      filters = normalizeCommunityRoomDirectoryFilters({});
    }
    page = { filters, items: [], nextCursor: null };
  }
  const nextFilters = page.nextCursor
    ? { ...page.filters, cursor: page.nextCursor }
    : null;
  const resetHref = "/live";

  return (
    <StockRadarAppShell
      activeNavigationItem={null}
      themeMode="user-selectable"
    >
      <main className={styles.directoryPage}>
        <header className={styles.directoryHero}>
          <div>
            <span>Public member-created discussions</span>
            <h1>Community Rooms</h1>
            <p>
              Find focused conversations by topic, discussion style,
              category, and language. Company rooms remain under each
              ticker&apos;s Company Live Room.
            </p>
          </div>
          <CommunityRoomCreateDialog />
        </header>

        <form className={styles.directoryFilters} method="get">
          <label className={styles.searchField}>
            <span>Search rooms</span>
            <div>
              <Search aria-hidden="true" size={16} />
              <input
                defaultValue={page.filters.search}
                maxLength={80}
                name="q"
                placeholder="Search name or introduction"
              />
            </div>
          </label>
          <label>
            <span>Topic</span>
            <select defaultValue={page.filters.topic ?? ""} name="topic">
              <option value="">All topics</option>
              {COMMUNITY_ROOM_TOPICS.map((topic) => (
                <option key={topic.value} value={topic.value}>
                  {getCommunityTopicLabel(topic.value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Style</span>
            <select
              defaultValue={page.filters.roomStyle ?? ""}
              name="style"
            >
              <option value="">All styles</option>
              {COMMUNITY_ROOM_STYLES.map((roomStyle) => (
                <option key={roomStyle.value} value={roomStyle.value}>
                  {getCommunityRoomStyleLabel(roomStyle.value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Focus</span>
            <select
              defaultValue={page.filters.focusTag ?? ""}
              name="tag"
            >
              <option value="">All focus tags</option>
              {COMMUNITY_ROOM_FOCUS_TAGS.map((tag) => (
                <option key={tag.value} value={tag.value}>
                  {getCommunityFocusTagLabel(tag.value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select
              defaultValue={page.filters.language ?? ""}
              name="language"
            >
              <option value="">All languages</option>
              {COMMUNITY_ROOM_LANGUAGES.map((language) => (
                <option key={language.value} value={language.value}>
                  {getCommunityLanguageLabel(language.value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Sort</span>
            <select defaultValue={page.filters.sort} name="sort">
              {COMMUNITY_ROOM_SORTS.map((sort) => (
                <option key={sort.value} value={sort.value}>
                  {sort.label}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.filterActions}>
            <button type="submit">Apply filters</button>
            <Link href={resetHref}>Reset</Link>
          </div>
        </form>

        <section
          aria-label="Community Room results"
          className={styles.directoryResults}
        >
          <div className={styles.resultsHeading}>
            <div>
              <span>Directory</span>
              <h2>
                {page.items.length
                  ? `${page.items.length} rooms on this page`
                  : "No rooms found"}
              </h2>
            </div>
            <small>20 rooms per page · server-filtered</small>
          </div>
          {directoryUnavailable ? (
            <div className={styles.directoryEmpty} role="alert">
              <strong>Community Rooms are temporarily unavailable.</strong>
              <p>
                The directory could not be loaded safely. Try again after
                the database migration and service are available.
              </p>
              <Link href={resetHref}>Retry directory</Link>
            </div>
          ) : page.items.length ? (
            <div className={styles.roomGrid}>
              {page.items.map((room) => (
                <article className={styles.roomCard} key={room.slug}>
                  <div className={styles.cardHeading}>
                    <span>Community Room</span>
                    <small>
                      {formatRelativeActivity(room.lastActivityAt)}
                    </small>
                  </div>
                  <h3>
                    <Link href={`/live/community/${room.slug}`}>
                      {room.name}
                    </Link>
                  </h3>
                  <p>{room.summary}</p>
                  <div className={styles.cardPrimaryMeta}>
                    <span>{getCommunityTopicLabel(room.topic)}</span>
                    <span>
                      {getCommunityRoomStyleLabel(room.roomStyle)}
                    </span>
                    <span>
                      {getCommunityLanguageLabel(room.language)}
                    </span>
                  </div>
                  <div className={styles.cardTags}>
                    {room.focusTags.map((tag) => (
                      <span key={tag}>
                        {getCommunityFocusTagLabel(tag)}
                      </span>
                    ))}
                  </div>
                  {room.relatedTickers.length ? (
                    <div className={styles.cardTickers}>
                      <small>Related</small>
                      {room.relatedTickers.map((ticker) => (
                        <span key={ticker}>{ticker}</span>
                      ))}
                    </div>
                  ) : null}
                  <Link
                    aria-label={`Open ${room.name} Community Room`}
                    className={styles.openRoomLink}
                    href={`/live/community/${room.slug}`}
                  >
                    Open room
                    <ArrowRight aria-hidden="true" size={15} />
                  </Link>
                </article>
              ))}
            </div>
          ) : (
            <div className={styles.directoryEmpty}>
              <strong>No Community Rooms match these filters.</strong>
              <p>Try a broader search or reset one of the filters.</p>
              <Link href={resetHref}>Clear filters</Link>
            </div>
          )}
          {nextFilters ? (
            <div className={styles.pagination}>
              <Link
                href={`/live?${communityFiltersToSearchParams(
                  nextFilters,
                  { includeCursor: true },
                )}`}
              >
                Next 20 rooms
                <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </div>
          ) : null}
        </section>
      </main>
    </StockRadarAppShell>
  );
}

function readQuery(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

function formatRelativeActivity(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "Recently active";
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  if (minutes < 1) return "Active now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
