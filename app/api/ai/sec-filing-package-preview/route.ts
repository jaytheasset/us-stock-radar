import { NextRequest, NextResponse } from "next/server";
import { buildSecFilingAnalysisPackage } from "@/lib/prompts/secFilingAnalysisPackage";
import { supabaseSelect } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const rawItemId = params.get("rawItemId");
  const accession = params.get("accession");
  const maxChars = readNumber(params.get("maxChars"), 60_000, 10_000, 180_000);
  const maxDocumentChars = readNumber(params.get("maxDocumentChars"), 24_000, 4_000, 80_000);

  const rawItemResult = rawItemId
    ? await fetchRawItemById(rawItemId)
    : accession
      ? await fetchRawItemByAccession(accession)
      : await fetchLatestSecRawItem();

  if (!rawItemResult.ok || !rawItemResult.data) {
    return NextResponse.json(
      {
        ok: false,
        status: rawItemResult.status,
        error: rawItemResult.error || "SEC raw item not found",
      },
      { status: rawItemResult.status || 404 },
    );
  }

  const filingPackage = buildSecFilingAnalysisPackage(rawItemResult.data, {
    maxChars,
    maxDocumentChars,
  });

  return NextResponse.json({
    ok: true,
    package: filingPackage,
  });
}

async function fetchRawItemById(id: string) {
  const result = await supabaseSelect("raw_items", {
    select: "*",
    id: `eq.${id}`,
    source_code: "eq.sec_edgar",
    limit: "1",
  });
  return normalizeRawItemResult(result);
}

async function fetchRawItemByAccession(accession: string) {
  const result = await supabaseSelect("raw_items", {
    select: "*",
    source_code: "eq.sec_edgar",
    source_unique_id: `eq.${accession}`,
    limit: "1",
  });
  return normalizeRawItemResult(result);
}

async function fetchLatestSecRawItem() {
  const result = await supabaseSelect("raw_items", {
    select: "*",
    source_code: "eq.sec_edgar",
    order: "fetched_at.desc",
    limit: "1",
  });
  return normalizeRawItemResult(result);
}

function normalizeRawItemResult(result: { ok: boolean; status: number; data?: unknown; error?: string }) {
  const data = Array.isArray(result.data) ? result.data[0] || null : null;
  return {
    ok: result.ok && Boolean(data),
    status: result.ok && data ? 200 : result.status || 404,
    data,
    error: result.error,
  };
}

function readNumber(value: string | null, fallback: number, min: number, max: number) {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}
