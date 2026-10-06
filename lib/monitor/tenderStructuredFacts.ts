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
  return {
    status: "available",
    eventId,
    rawItemId: read.rawItemId,
    sourceExecutionId: read.sourceExecutionId,
    persistedAt: read.persistedAt,
    filedAt: read.filedAt,
    facts: {
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
