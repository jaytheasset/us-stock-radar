import { NextRequest, NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { isSavedContentType, isSavedContentUuid } from "@/lib/saved/types";
import { supabaseSelect } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: NextRequest) {
  const contentType = request.nextUrl.searchParams.get("contentType");
  const contentIds = Array.from(
    new Set(
      (request.nextUrl.searchParams.get("contentIds") || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  if (
    !isSavedContentType(contentType) ||
    contentIds.length === 0 ||
    contentIds.length > 100 ||
    contentIds.some((contentId) => !isSavedContentUuid(contentId))
  ) {
    return NextResponse.json(
      { ok: false, error: "SAVED_INVALID_REFERENCE" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const userId = await getOptionalCurrentUserId();
  if (!userId) {
    return NextResponse.json(
      { ok: true, authenticated: false, savedIds: [] },
      { headers: NO_STORE_HEADERS },
    );
  }

  const result = await supabaseSelect("saved_content", {
    select: "content_id",
    user_id: `eq.${userId}`,
    content_type: `eq.${contentType}`,
    content_id: `in.(${contentIds.join(",")})`,
    limit: String(contentIds.length),
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: "SAVED_DATABASE_ERROR" },
      { status: 502, headers: NO_STORE_HEADERS },
    );
  }

  const savedIds = Array.isArray(result.data)
    ? result.data
        .map((row) =>
          row && typeof row === "object" && "content_id" in row
            ? row.content_id
            : null,
        )
        .filter((value): value is string => typeof value === "string")
    : [];

  return NextResponse.json(
    { ok: true, authenticated: true, savedIds },
    { headers: NO_STORE_HEADERS },
  );
}
