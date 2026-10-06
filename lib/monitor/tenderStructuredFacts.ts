import {
  readTenderStructured,
  rows,
  tenderRepository,
  type TenderReadResult,
  type TenderRepository,
} from "../sec-tender/persistence.ts";

export type TenderMonitorFacts =
  | Readonly<{ status: "not_ready"; reason: string }>
  | Readonly<{
      status: "available";
      eventId: string;
      rawItemId: string;
      sourceExecutionId: string;
      persistedAt: string;
      filedAt: string;
      facts: Readonly<{
        offer_price_change: "changed" | null;
        board_recommendation: "accept" | "reject" | "no_recommendation" | null;
        offer_status: "withdrawn" | "terminated" | null;
        final_results_observed: true | null;
      }>;
    }>;

export function tenderMonitorFacts(read: TenderReadResult, eventId: string): TenderMonitorFacts {
  if (read.status !== "available") return read;
  const board = read.canonical.facts.find((fact) => fact.type === "board_recommendation");
  const offerStatus = read.canonical.facts.find((fact) => fact.type === "offer_status");
  const finalResults = read.canonical.facts.find((fact) => fact.type === "final_results_observed");
  const price = read.canonical.facts.find((fact) => fact.type === "offer_price");
  const current = price?.current;
  const previous = price?.previous;
  // Compare only explicit canonical prices; abstention is never an unchanged fact.
  const priceChanged = current && previous
    && typeof current.amount === "number" && Number.isFinite(current.amount)
    && typeof previous.amount === "number" && Number.isFinite(previous.amount)
    && typeof current.currency_text === "string" && current.currency_text.length > 0
    && current.currency_text === previous.currency_text
    && current.unit === "cash_per_share" && previous.unit === "cash_per_share"
    && current.amount !== previous.amount;
  return {
    status: "available",
    eventId,
    rawItemId: read.rawItemId,
    sourceExecutionId: read.sourceExecutionId,
    persistedAt: read.persistedAt,
    filedAt: read.filedAt,
    facts: {
      offer_price_change: priceChanged ? "changed" : null,
      board_recommendation: board?.type === "board_recommendation" ? board.current : null,
      offer_status: offerStatus?.type === "offer_status" ? offerStatus.current : null,
      final_results_observed: finalResults?.type === "final_results_observed" ? true : null,
    },
  };
}

export async function readCurrentTenderFacts(
  eventId: string,
  supplied?: TenderRepository,
): Promise<TenderMonitorFacts> {
  try {
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new Error("tender_invalid_event_id");
    const repo = supplied ?? await tenderRepository();
    const events = rows(await repo.select("events", {
      select: "id,raw_item_id,source_code",
      id: `eq.${eventId}`,
      limit: "2",
    }));
    if (events.length !== 1 || events[0].source_code !== "sec_edgar") {
      throw new Error("tender_event_identity_invalid");
    }
    return tenderMonitorFacts(
      await readTenderStructured(String(events[0].raw_item_id), repo),
      eventId,
    );
  } catch (error) {
    return { status: "not_ready", reason: error instanceof Error ? error.message : "tender_reader_failed" };
  }
}
