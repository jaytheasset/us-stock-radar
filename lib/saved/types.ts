export const savedContentTypes = [
  "news",
  "filing",
  "live_room_post",
] as const;

export type SavedContentType = (typeof savedContentTypes)[number];

export type SavedContentReference = {
  contentId: string;
  contentType: SavedContentType;
};

export type SavedContentListItem = SavedContentReference & {
  available: boolean;
  companyName: string | null;
  href: string | null;
  savedAt: string;
  ticker: string | null;
  title: string;
};

export type SavedContentTab = "all" | "news" | "filings" | "posts";

export type SavedContentPage = {
  items: SavedContentListItem[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

export function isSavedContentType(value: unknown): value is SavedContentType {
  return savedContentTypes.includes(value as SavedContentType);
}

export function isSavedContentUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function getSavedContentTypeLabel(type: SavedContentType) {
  if (type === "filing") return "Filing";
  if (type === "live_room_post") return "Post";
  return "News";
}

export function normalizeSavedContentTab(value: unknown): SavedContentTab {
  return value === "news" || value === "filings" || value === "posts"
    ? value
    : "all";
}

export function contentTypeForSavedTab(
  tab: SavedContentTab,
): SavedContentType | null {
  if (tab === "news") return "news";
  if (tab === "filings") return "filing";
  if (tab === "posts") return "live_room_post";
  return null;
}
