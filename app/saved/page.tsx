import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SavedContentList } from "@/components/saved/SavedContentList";
import styles from "@/components/saved/SavedPage.module.css";
import { StockRadarAppShell } from "@/components/shell/StockRadarAppShell";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { getSavedContentPage } from "@/lib/saved/server";
import {
  normalizeSavedContentTab,
  type SavedContentPage,
  type SavedContentTab,
} from "@/lib/saved/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bookmarks | Stock Radar",
  description: "Review your bookmarked news, filings, and public Live Room posts.",
  robots: { follow: false, index: false },
};

const tabs: Array<{ label: string; value: SavedContentTab }> = [
  { label: "All", value: "all" },
  { label: "News", value: "news" },
  { label: "Filings", value: "filings" },
  { label: "Posts", value: "posts" },
];

export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [userId, params] = await Promise.all([
    getOptionalCurrentUserId(),
    searchParams,
  ]);
  const tab = normalizeSavedContentTab(firstParam(params.tab));
  const page = readPage(firstParam(params.page));
  const returnPath = buildSavedHref(tab, page);
  if (!userId) redirect(`/login?next=${encodeURIComponent(returnPath)}`);

  let contentPage: SavedContentPage | null = null;
  let errorMessage = "";
  try {
    contentPage = await getSavedContentPage({ page, tab, userId });
  } catch {
    errorMessage = "Bookmarks are unavailable.";
  }

  return (
    <StockRadarAppShell activeNavigationItem={null} themeMode="user-selectable">
      <main className={styles.page}>
        <header className={styles.heading}>
          <div>
            <span>Account library</span>
            <h1>Bookmarks</h1>
            <p>
              News, filings, and public Live Room posts you bookmark. Stock Watchlist and Calendar Follow Event stay separate.
            </p>
          </div>
          <strong>
            {contentPage
              ? `${contentPage.totalCount} bookmark${contentPage.totalCount === 1 ? "" : "s"}`
              : "Unavailable"}
          </strong>
        </header>

        <nav aria-label="Filter bookmarks by content type" className={styles.tabs}>
          {tabs.map((item) => (
            <Link
              aria-current={item.value === tab ? "page" : undefined}
              href={buildSavedHref(item.value, 1)}
              key={item.value}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {errorMessage || !contentPage ? (
          <div className={styles.errorState} role="alert">
            <strong>Bookmarks could not be loaded</strong>
            <p>{errorMessage || "Try again in a moment."}</p>
          </div>
        ) : (
          <>
            <SavedContentList initialItems={contentPage.items} />
            {contentPage.totalPages > 1 ? (
              <nav aria-label="Bookmarks pagination" className={styles.pagination}>
                {contentPage.page > 1 ? (
                  <Link href={buildSavedHref(tab, contentPage.page - 1)}>Previous</Link>
                ) : null}
                <span>
                  Page {contentPage.page} of {contentPage.totalPages}
                </span>
                {contentPage.page < contentPage.totalPages ? (
                  <Link href={buildSavedHref(tab, contentPage.page + 1)}>Next</Link>
                ) : null}
              </nav>
            ) : null}
          </>
        )}
      </main>
    </StockRadarAppShell>
  );
}

function buildSavedHref(tab: SavedContentTab, page: number) {
  const query = new URLSearchParams();
  if (tab !== "all") query.set("tab", tab);
  if (page > 1) query.set("page", String(page));
  const value = query.toString();
  return value ? `/saved?${value}` : "/saved";
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readPage(value: string | undefined) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? Math.min(page, 10_000) : 1;
}
