import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Building2, Search } from "lucide-react";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { CommunityRoomCreateDialog } from "@/components/live-room/CommunityRoomCreateDialog";
import { JoinedRoomsDirectory } from "@/components/live-room/JoinedRoomsDirectory";
import {
  COMMUNITY_ROOM_FOCUS_TAGS,
  COMMUNITY_ROOM_INDUSTRY_OPTIONS,
  COMMUNITY_ROOM_LANGUAGES,
  COMMUNITY_ROOM_SORTS,
  COMMUNITY_ROOM_STYLES,
  COMMUNITY_ROOM_TOPICS,
  COMMUNITY_ROOM_THEME_OPTIONS,
  getCommunityFocusTagLabel,
  getCommunityLanguageLabel,
  getCommunityRoomIndustryLabel,
  getCommunityRoomStyleLabel,
  getCommunityRoomThemeLabel,
  getCommunityTopicLabel,
  normalizeCommunityRoomDirectoryFilters,
  type CommunityRoomDirectoryPage,
} from "@/lib/live-room/community";
import {
  communityFiltersToSearchParams,
  findCompanyLiveRoomDirectoryResult,
  listCommunityRooms,
} from "@/lib/live-room/communityServerRepository";
import styles from "@/components/live-room/CommunityRooms.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/live" },
  description:
    "Browse public member-created Community Rooms by ticker, market theme, industry, topic, style, focus, and language.",
  title: "Community Rooms | Stock Radar",
};

type DirectoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CommunityRoomDirectoryPage({
  searchParams,
}: DirectoryPageProps) {
  const query = await searchParams;
  const joinedView = readQuery(query.view) === "joined";
  if (joinedView) {
    return (
      <StockRadarAppShell
        activeNavigationItem={null}
        themeMode="user-selectable"
      >
        <main className={styles.directoryPage}>
          <header className={styles.directoryHero}>
            <div>
              <span>Room membership</span>
              <h1>My Rooms</h1>
              <p>
                Find every company and Community Room you have joined.
              </p>
            </div>
            <div className={styles.directoryHeroActions}>
              <Link href="/live">Browse rooms</Link>
              <CommunityRoomCreateDialog />
            </div>
          </header>
          <JoinedRoomsDirectory />
        </main>
      </StockRadarAppShell>
    );
  }
  const requestedFilters = {
    cursor: readQuery(query.cursor),
    focusTag: readQuery(query.tag),
    industry: readQuery(query.industry),
    language: readQuery(query.language),
    roomStyle: readQuery(query.style),
    search: readQuery(query.q),
    sort: readQuery(query.sort),
    topic: readQuery(query.topic),
    theme: readQuery(query.theme),
  };
  let directoryUnavailable = false;
  let page: CommunityRoomDirectoryPage;
  const [directoryResult, companyResult] = await Promise.allSettled([
    listCommunityRooms(requestedFilters),
    findCompanyLiveRoomDirectoryResult(requestedFilters.search),
  ]);
  if (directoryResult.status === "fulfilled") {
    page = directoryResult.value;
  } else {
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
  const companyRoom =
    companyResult.status === "fulfilled" ? companyResult.value : null;
  const companyLookupUnavailable = companyResult.status === "rejected";
  const nextFilters = page.nextCursor
    ? { ...page.filters, cursor: page.nextCursor }
    : null;
  const resetHref = "/live";
  const openCreateOnLoad = readQuery(query.create) === "room";

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
              Find focused conversations by ticker, market theme,
              industry, discussion style, and language. Company rooms
              remain under each ticker&apos;s Company Live Room.
            </p>
          </div>
          <div className={styles.directoryHeroActions}>
            <Link href="/live?view=joined">Joined rooms</Link>
            <CommunityRoomCreateDialog openOnLoad={openCreateOnLoad} />
          </div>
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
            <span>Theme</span>
            <select
              defaultValue={page.filters.theme ?? ""}
              name="theme"
            >
              <option value="">All themes</option>
              {COMMUNITY_ROOM_THEME_OPTIONS.filter(
                (option) => option.kind === "main",
              ).map((mainTheme) => (
                <optgroup
                  key={mainTheme.value}
                  label={mainTheme.groupLabel}
                >
                  {COMMUNITY_ROOM_THEME_OPTIONS.filter(
                    (option) =>
                      option.groupSlug === mainTheme.groupSlug,
                  ).map((theme) => (
                    <option key={theme.value} value={theme.value}>
                      {theme.kind === "main" ? "MAIN — " : ""}
                      {getCommunityRoomThemeLabel(theme.value)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            <span>Industry</span>
            <select
              defaultValue={page.filters.industry ?? ""}
              name="industry"
            >
              <option value="">All industries</option>
              {[
                ...new Set(
                  COMMUNITY_ROOM_INDUSTRY_OPTIONS.map(
                    (option) => option.groupLabel,
                  ),
                ),
              ].map((sector) => (
                <optgroup key={sector} label={sector}>
                  {COMMUNITY_ROOM_INDUSTRY_OPTIONS.filter(
                    (option) => option.groupLabel === sector,
                  ).map((industry) => (
                    <option
                      key={industry.value}
                      value={industry.value}
                    >
                      {getCommunityRoomIndustryLabel(industry.value)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
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
                {companyRoom
                  ? `${companyRoom.ticker} Company Room${
                      page.items.length
                        ? ` · ${page.items.length} Community Rooms`
                        : ""
                    }`
                  : page.items.length
                    ? `${page.items.length} Community Rooms on this page`
                    : "No rooms found"}
              </h2>
            </div>
            <small>20 rooms per page · server-filtered</small>
          </div>
          {companyRoom ? (
            <article className={styles.companyRoomResult}>
              <div className={styles.companyRoomIcon}>
                <Building2 aria-hidden="true" size={20} />
              </div>
              <div>
                <span>Company Live Room</span>
                <h3>
                  <Link href={`/live/${companyRoom.ticker}`}>
                    {companyRoom.ticker} Company Live Room
                  </Link>
                </h3>
                <p>
                  {companyRoom.companyName}
                  {companyRoom.exchange
                    ? ` · ${companyRoom.exchange}`
                    : ""}
                  . This ticker-scoped Company Room is separate from
                  member-created Community Rooms.
                </p>
              </div>
              <Link
                aria-label={`Open ${companyRoom.ticker} Company Live Room`}
                className={styles.openCompanyRoomLink}
                href={`/live/${companyRoom.ticker}`}
              >
                Open Company Room
                <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </article>
          ) : null}
          {companyLookupUnavailable ? (
            <p className={styles.companyLookupNotice} role="status">
              The Company Live Room match could not be checked right now.
              Community results are still shown below.
            </p>
          ) : null}
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
                  {room.themes.length || room.industries.length ? (
                    <div
                      aria-label="Discovery themes and industries"
                      className={styles.cardDiscovery}
                    >
                      {room.themes.map((theme) => (
                        <span key={`theme:${theme}`}>
                          Theme · {getCommunityRoomThemeLabel(theme)}
                        </span>
                      ))}
                      {room.industries.map((industry) => (
                        <span key={`industry:${industry}`}>
                          Industry ·{" "}
                          {getCommunityRoomIndustryLabel(industry)}
                        </span>
                      ))}
                    </div>
                  ) : null}
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
          ) : !companyRoom && !companyLookupUnavailable ? (
            <div className={styles.directoryEmpty}>
              <strong>No Community Rooms match these filters.</strong>
              <p>
                No member-created Community Room or matching Company Live
                Room was found. Try a broader search or reset a filter.
              </p>
              <Link href={resetHref}>Clear filters</Link>
            </div>
          ) : null}
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
