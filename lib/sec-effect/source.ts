import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { parseEffectFiling } from "../sources/sec/forms/effect/parser.ts";

export type EffectSource = { version: "effect_source_v1"; url: string; xml: string; sha256: string };
export const accessionPattern = /^\d{10}-\d{2}-\d{6}$/;
export const fileNumberPattern = /^333-\d+(?:-\d+)?$/;
export function cik(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^\d{1,10}$/.test(text) && Number(text) > 0 ? text.padStart(10, "0") : "";
}
export function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
export function secDocumentUrl(url: string, accession?: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "www.sec.gov"
      && /^\/Archives\/edgar\/data\/\d+\/\d{18}\/[^/]+$/.test(parsed.pathname)
      && (!accession || parsed.pathname.split("/")[5] === accession.replaceAll("-", ""));
  } catch { return false; }
}

/** Preserve only the small original EFFECT XML, never the entire submission or a parent summary. */
export function captureEffectSource(form: string | null, document: { url: string | null; type: string | null }, text: string): EffectSource | undefined {
  if (form !== "EFFECT" || document.type !== "EFFECT" || !document.url || !secDocumentUrl(document.url)) return;
  const matches = [...text.matchAll(/<edgarSubmission\b[^>]*>[\s\S]*?<\/edgarSubmission>/g)];
  if (matches.length !== 1 || matches[0][0].length > 100_000) return;
  const xml = matches[0][0];
  if (XMLValidator.validate(xml) !== true || /<!DOCTYPE|<!ENTITY/i.test(xml)) return;
  if (!/<submissionType>\s*EFFECT\s*<\/submissionType>/.test(xml)
    || !/<testOrLive>\s*LIVE\s*<\/testOrLive>/.test(xml)) return;
  return { version: "effect_source_v1", url: document.url, xml, sha256: hash(xml) };
}

export function readEffectNotice(raw: Record<string, any>) {
  const payload = record(raw.raw_payload);
  const accession = payload.accession_number;
  if (raw.source_code !== "sec_edgar" || payload.form_type !== "EFFECT"
    || !accessionPattern.test(accession ?? "") || raw.source_unique_id !== accession) return null;
  const sources = (Array.isArray(payload.documents) ? payload.documents : [])
    .map((d: unknown) => record(record(d).effectOriginalSource))
    .filter((s: Record<string, any>) => s.version === "effect_source_v1");
  if (sources.length !== 1) return null;
  const source = sources[0] as EffectSource;
  if (typeof source.xml !== "string" || hash(source.xml) !== source.sha256 || !secDocumentUrl(source.url, accession)) return null;
  const captured = captureEffectSource("EFFECT", { type: "EFFECT", url: source.url }, source.xml);
  if (!captured || captured.sha256 !== source.sha256) return null;
  const root = record(new XMLParser({ parseTagValue: false, trimValues: true }).parse(source.xml)).edgarSubmission;
  const data = record(record(root).effectiveData);
  const singleText = (v: unknown) => typeof v === "string" && v.length > 0;
  if (record(root).submissionType !== "EFFECT" || record(root).testOrLive !== "LIVE"
    || !singleText(data.finalEffectivenessDispDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.finalEffectivenessDispDate)
    || !Number.isFinite(Date.parse(data.finalEffectivenessDispDate))
    || new Date(data.finalEffectivenessDispDate).toISOString().slice(0,10) !== data.finalEffectivenessDispDate
    || (!singleText(data.form) && !singleText(data.submissionType))
    || (data.form !== undefined && !singleText(data.form))
    || (data.submissionType !== undefined && (!singleText(data.submissionType) || (data.form && data.form !== data.submissionType)))
    || (data.accessionNumber !== undefined && !singleText(data.accessionNumber))) return null;
  const xmlFilers = Array.isArray(data.filer) ? data.filer : [data.filer];
  if (xmlFilers.some(f => !singleText(record(f).cik) || !cik(record(f).cik)
    || !singleText(record(f).fileNumber) || !fileNumberPattern.test(record(f).fileNumber)
    || record(f).seriesClassContractData !== undefined)) return null;
  // No metadata/parent/fallback input is passed to the original deterministic parser.
  const parsed = parseEffectFiling({ text: source.xml, formType: "EFFECT" });
  const facts = parsed.facts;
  if (!facts.effectiveDate || !facts.effectiveFilingForm || !facts.filers.length
    || facts.hasSeriesClassContractData || facts.filers.length !== xmlFilers.length
    || facts.filers.some(f => !cik(f.cik) || !fileNumberPattern.test(f.fileNumber ?? ""))
    || (facts.referenceAccessionNumber && !accessionPattern.test(facts.referenceAccessionNumber))) return null;
  const filers = facts.filers.map(f => ({ cik: cik(f.cik), fileNumber: f.fileNumber!, name: f.entityName ?? "" }));
  if (!filers.some(f => f.cik === cik(payload.cik))) return null;
  return { accession: accession as string, form: facts.effectiveFilingForm,
    referenceAccession: facts.referenceAccessionNumber, effectiveDate: facts.effectiveDate,
    filers, sourceUrl: source.url, sourceHash: source.sha256 };
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
