import { NextRequest, NextResponse } from "next/server";
import {
  loadLiveFeedV2Page,
} from "@/lib/liveFeedV2";
import { normalizeLiveFeedV2Filter } from "@/lib/liveFeedV2Contract";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const filter = normalizeLiveFeedV2Filter(
    request.nextUrl.searchParams.get("filter"),
  );
  const cursor = request.nextUrl.searchParams.get("cursor");
  const page = await loadLiveFeedV2Page({ cursor, filter });

  return NextResponse.json(page, {
    status: page.error ? 502 : 200,
  });
}
