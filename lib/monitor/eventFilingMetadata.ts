/** Read-only projection of existing SEC filing metadata; never reads analysis text. */
export const REGISTRATION_FILING_FORMS = ["S-4", "S-4/A", "F-4", "F-4/A"] as const;
export type RegistrationFilingForm = typeof REGISTRATION_FILING_FORMS[number];
export type EventFilingMetadata = { status: "not_ready"; reason: string } | {
  status: "available"; eventId: string; rawItemId: string; sourceExecutionId: string;
  persistedAt: string; filedAt: string;
  facts: { form: RegistrationFilingForm; accession: string; issuerCik: string; sourceUrl: string };
};
type Row = Record<string, unknown>;
type Repository = { supabaseSelect(table: string, query: Record<string, string>): Promise<{ ok: boolean; data: unknown }> };
const record = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
const uuid = (v: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(v));
export function isRegistrationFilingForm(v: unknown): v is RegistrationFilingForm {
  return (REGISTRATION_FILING_FORMS as readonly unknown[]).includes(v);
}

export function projectEventFilingMetadata(event: Row, raw: Row, run: Row): EventFilingMetadata {
  const p = record(raw.raw_payload), accession = text(raw.source_unique_id), form = p.form_type;
  const fail = (reason: string): EventFilingMetadata => ({ status: "not_ready", reason });
  if (!uuid(event.id) || !uuid(raw.id) || event.raw_item_id !== raw.id
    || event.source_code !== "sec_edgar" || raw.source_code !== "sec_edgar"
    || raw.source_group !== "filings" || !isRegistrationFilingForm(form)
    || !/^\d{10}-\d{2}-\d{6}$/.test(accession) || p.accession_number !== accession) return fail("filing_identity_invalid");
  const cik = text(p.cik), sourceUrl = text(p.primary_document_url);
  if (!/^\d{1,10}$/.test(cik)) return fail("issuer_identity_unavailable");
  try {
    const u = new URL(sourceUrl);
    if (u.protocol !== "https:" || u.hostname !== "www.sec.gov" || u.username || u.password
      || !u.pathname.startsWith(`/Archives/edgar/data/${cik.replace(/^0+/, "")}/${accession.replaceAll("-", "")}/`)) return fail("filing_source_mismatch");
  } catch { return fail("filing_source_unavailable"); }
  // SEC ingestion supplies this metadata. Do not substitute a prose/cover/AI date.
  const filedAt = text(p.filing_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedAt) || !Number.isFinite(Date.parse(filedAt))
    || new Date(filedAt).toISOString().slice(0, 10) !== filedAt) return fail("filing_date_unavailable");
  // Existing Primary run ID is execution provenance only; its output is never read.
  // This path operates on existing saved events, not on unprocessed raw filings.
  if (!uuid(run.id) || run.event_id !== event.id || run.raw_item_id !== raw.id
    || run.prompt_key !== "sec_s4_f4_analysis" || run.status !== "completed"
    || !Number.isFinite(Date.parse(text(run.finished_at)))) return fail("event_execution_unavailable");
  return { status: "available", eventId: text(event.id), rawItemId: text(raw.id), sourceExecutionId: text(run.id),
    persistedAt: text(run.finished_at), filedAt,
    facts: { form, accession, issuerCik: cik, sourceUrl } };
}

export async function readEventFilingMetadata(eventId: string, supplied?: Repository): Promise<EventFilingMetadata> {
  try {
    if (!uuid(eventId)) throw Error("event_identity_invalid");
    const repo = supplied ?? await import("../supabase.ts");
    async function one(table: string, query: Record<string, string>) {
      const r = await repo.supabaseSelect(table, query);
      if (!r.ok || !Array.isArray(r.data) || r.data.length !== 1) throw Error("filing_metadata_unavailable");
      return record(r.data[0]);
    }
    const event = await one("events", { select: "id,raw_item_id,source_code", id: `eq.${eventId}`, limit: "2" });
    if (!uuid(event.raw_item_id)) throw Error("raw_identity_invalid");
    const raw = await one("raw_items", { select: "id,source_code,source_group,source_unique_id,form_type:raw_payload->>form_type,accession_number:raw_payload->>accession_number,cik:raw_payload->>cik,filing_date:raw_payload->>filing_date,primary_document_url:raw_payload->>primary_document_url", id: `eq.${event.raw_item_id}`, limit: "2" });
    const run = await one("ai_runs", { select: "id,event_id,raw_item_id,prompt_key,status,finished_at", event_id: `eq.${eventId}`,
      raw_item_id: `eq.${event.raw_item_id}`, prompt_key: "eq.sec_s4_f4_analysis", status: "eq.completed", order: "finished_at.desc,id.desc", limit: "1" });
    return projectEventFilingMetadata(event, { ...raw, raw_payload: {
      form_type: raw.form_type, accession_number: raw.accession_number, cik: raw.cik,
      filing_date: raw.filing_date, primary_document_url: raw.primary_document_url,
    } }, run);
  } catch (error) { return { status: "not_ready", reason: error instanceof Error ? error.message : "filing_metadata_unavailable" }; }
}

export function registrationFilingAlertText(form: RegistrationFilingForm) {
  return { title: `${form} registration ${form.endsWith("/A") ? "amendment " : ""}filed`,
    message: form.endsWith("/A") ? `An SEC ${form} registration amendment was filed. This does not establish a change in transaction terms.`
      : `An SEC ${form} registration statement was filed. This does not establish a first merger announcement or transaction completion.` };
}
