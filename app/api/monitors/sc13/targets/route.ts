import { NextRequest, NextResponse } from "next/server";
import { getOptionalCurrentUserId } from "@/lib/currentUser";
import { readSc13FilingByAccession } from "@/lib/sec-sc13-xml/persistence";
import { readSc13IssuerCurrentState } from "@/lib/sec-sc13-xml/currentState";
import { buildStockSc13OwnershipSnapshot } from "@/lib/watchlist/stockSc13Ownership";
import { SC13_MONITOR_NO_STORE_HEADERS, sc13MonitorAuthRequiredResponse } from "../shared";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!await getOptionalCurrentUserId()) return sc13MonitorAuthRequiredResponse();
  const accession = request.nextUrl.searchParams.get("accession")?.trim() || "";
  const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: SC13_MONITOR_NO_STORE_HEADERS });
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) return reply({ ok: false, message: "Enter a filing accession in 0000000000-00-000000 format." }, 400);
  try {
    const filing = await readSc13FilingByAccession(accession);
    if (filing.status === "not_found") return reply({ ok: false, message: "This filing is not in stored Schedule 13 history." }, 404);
    if (filing.status !== "available" || typeof filing.filing.issuer_cik !== "string") return reply({ ok: false, message: "Stored filing evidence is unavailable. Try again later." }, 503);
    const currentState = await readSc13IssuerCurrentState(filing.filing.issuer_cik);
    return reply({ ok: true, data: buildStockSc13OwnershipSnapshot({ currentState, symbol: "" }) });
  } catch { return reply({ ok: false, message: "Stored filing evidence is temporarily unavailable." }, 503); }
}
