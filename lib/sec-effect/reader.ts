import { record, readEffectNotice, cik, secDocumentUrl } from "./source.ts";
import { defaultSelect, rows, type Select } from "./registration.ts";
import type { EffectCondition } from "./conditions.ts";
import { effectTarget } from "./conditions.ts";

export type EffectFacts = { status: "available"; eventId: string; sourceExecutionId: string; persistedAt: string;
  notice: NonNullable<ReturnType<typeof readEffectNotice>>; reference: { cik: string; fileNumber: string; form: string } | null }
  | { status: "not_ready"; reason: string };
export async function readEffectFacts(eventId: string, select: Select = defaultSelect): Promise<EffectFacts> {
  try {
    const events = rows(await select("events", { select: "id,raw_item_id,source_code,metadata,detected_at", id: `eq.${eventId}`, limit: "2" }));
    if (events.length !== 1 || events[0].source_code !== "sec_edgar") return unavailable("event_unavailable");
    const event = events[0];
    const rawRows = rows(await select("raw_items", { select: "*", id: `eq.${event.raw_item_id}`, limit: "2" }));
    const notice = rawRows.length === 1 ? readEffectNotice(rawRows[0]) : null;
    if (!notice || record(event.metadata).accession_number !== notice.accession) return unavailable("original_effect_source_unavailable");
    let reference: { cik: string; fileNumber: string; form: string } | null = null;
    if (notice.referenceAccession) {
      const refs = rows(await select("raw_items", { select: "*", source_code: "eq.sec_edgar", source_unique_id: `eq.${notice.referenceAccession}`, limit: "2" }));
      if (refs.length !== 1) return unavailable("referenced_filing_unavailable");
      const p = record(refs[0].raw_payload);
      reference = { cik: cik(p.cik), fileNumber: String(p.file_number ?? ""), form: String(p.form_type ?? "") };
      if (p.accession_number !== notice.referenceAccession
        || refs[0].source_code !== "sec_edgar" || refs[0].source_unique_id !== notice.referenceAccession
        || !secDocumentUrl(String(refs[0].source_url ?? ""), notice.referenceAccession)
        || !notice.filers.some(f => f.cik === reference!.cik && f.fileNumber === reference!.fileNumber)) return unavailable("reference_identity_conflict");
    }
    if (notice.form === "POS AM" && !reference) return unavailable("amendment_reference_required");
    return { status: "available", eventId, sourceExecutionId: String(event.raw_item_id), persistedAt: String(event.detected_at), notice, reference };
  } catch { return unavailable("reader_unavailable"); }
}
export function matchEffect(current: EffectFacts | undefined, conditions: readonly EffectCondition[]) {
  const target = effectTarget(conditions);
  if (!target || !current || current.status !== "available") return "ineligible" as const;
  const { notice, reference } = current;
  if (!notice.filers.some(f => f.cik === target.cik && f.fileNumber === target.fileNumber)) return "no_match" as const;
  if (reference && (reference.cik !== target.cik || reference.fileNumber !== target.fileNumber)) return "ineligible" as const;
  if (notice.form.replace(/\/A$/, "") !== target.form && notice.form !== "POS AM") return "ineligible" as const;
  if (reference && reference.form !== "POS AM" && reference.form.replace(/\/A$/, "") !== target.form) return "ineligible" as const;
  return "match" as const;
}
export type EffectEvidence = {
  kind: "effect_registration_v1"; registrationKey: string; registrationAccession: string; registrationForm: string;
  cik: string; fileNumber: string; effectAccession: string; effectiveDate: string; sourceUrl: string; sourceHash: string;
};
export function effectEvidence(current: EffectFacts, conditions: readonly EffectCondition[]): EffectEvidence | null {
  const target = effectTarget(conditions);
  if (!target || current.status !== "available" || matchEffect(current, conditions) !== "match") return null;
  return { kind: "effect_registration_v1", registrationKey: `${target.cik}:${target.fileNumber}`,
    registrationAccession: target.accession, registrationForm: target.form, cik: target.cik, fileNumber: target.fileNumber,
    effectAccession: current.notice.accession, effectiveDate: current.notice.effectiveDate,
    sourceUrl: current.notice.sourceUrl, sourceHash: current.notice.sourceHash };
}
function unavailable(reason: string): EffectFacts { return { status: "not_ready", reason }; }
