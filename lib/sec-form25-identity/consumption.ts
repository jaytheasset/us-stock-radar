/** Form 25 identity is SEC evidence / Human decision, never an analysis ticker. */
export type Form25IdentityGate = Readonly<{
  status: "not_applicable" | "available" | "blocked";
  ticker: string | null;
  exchange: string | null;
  reason: string;
}>;

type Row = Record<string, unknown>;
type EffectiveIdentity = {
  status: string;
  state?: string;
  ticker?: string | null;
  exchange?: string | null;
  reason?: string;
};
export type Form25IdentityConsumerReaders = {
  event(eventId: string): Promise<Row | null>;
  identity(rawItemId: string): Promise<EffectiveIdentity>;
};

export function isSecForm25IdentityForm(value: unknown) {
  return /^(?:FORM\s+)?25(?:-NSE)?(?:\/A)?$/.test(text(value).toUpperCase());
}

export function readStoredSecForm25EventIdentity(event: Row): Form25IdentityGate {
  const metadata = record(event.metadata);
  if (!isSecForm25IdentityForm(metadata.form_type || metadata.sec_form_type || metadata.formType)) {
    return { status: "not_applicable", ticker: null, exchange: null, reason: "not_form25" };
  }
  return gate(record(metadata.form25_ticker_identity) as EffectiveIdentity);
}

/** Fresh read for evaluation / delivery; persisted UI metadata is not an approval authority. */
export async function readSecForm25EventIdentity(
  eventOrId: Row | string,
  readers: Form25IdentityConsumerReaders = defaultReaders,
): Promise<Form25IdentityGate> {
  try {
    const event = typeof eventOrId === "string" ? await readers.event(eventOrId) : eventOrId;
    if (!event) return blocked("form25_event_identity_unavailable");
    const stored = readStoredSecForm25EventIdentity(event);
    if (stored.status === "not_applicable") return stored;
    const rawItemId = text(event.raw_item_id);
    if (!rawItemId) return blocked("form25_raw_identity_unavailable");
    return gate(await readers.identity(rawItemId));
  } catch {
    return blocked("form25_identity_reader_unavailable");
  }
}

function gate(identity: EffectiveIdentity): Form25IdentityGate {
  const ticker = text(identity.ticker).toUpperCase();
  if (identity.status === "available" &&
      (identity.state === "AUTO" || identity.state === "HUMAN_APPROVED") &&
      /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(ticker)) {
    return { status: "available", ticker, exchange: text(identity.exchange) || null,
      reason: text(identity.reason) || "form25_identity_confirmed" };
  }
  return blocked(text(identity.reason) || "form25_identity_not_confirmed");
}

function blocked(reason: string): Form25IdentityGate {
  return { status: "blocked", ticker: null, exchange: null, reason };
}
const defaultReaders: Form25IdentityConsumerReaders = {
  event: async (eventId) => {
    const { supabaseSelect } = await import("../supabase.ts");
    const result = await supabaseSelect("events", {
      select: "id,raw_item_id,ticker,metadata", id: `eq.${eventId}`, limit: "1",
    });
    if (!result.ok) throw new Error("event_identity_read_failed");
    return Array.isArray(result.data) ? result.data[0] as Row ?? null : null;
  },
  identity: async (rawItemId) => (await import("./persistence.ts"))
    .readEffectiveSecForm25Identity({ rawItemId }),
};
function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
