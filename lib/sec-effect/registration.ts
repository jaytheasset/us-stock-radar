import { accessionPattern, cik, fileNumberPattern, record, secDocumentUrl } from "./source.ts";
import { effectTarget, REGISTRATION_FORMS, type EffectCondition, type RegistrationTarget } from "./conditions.ts";

export type Select = (table: string, query: Record<string, string>) => Promise<{ ok: boolean; data: unknown; error?: string }>;
export async function defaultSelect(table: string, query: Record<string, string>) {
  return (await import("../supabase.ts")).supabaseSelect(table, query);
}
export function rows(result: Awaited<ReturnType<Select>>) {
  if (!result.ok || !Array.isArray(result.data)) throw new Error("Registration evidence could not be read.");
  return result.data.map(record);
}
export function registrationFromRaw(raw: Record<string, any>): RegistrationTarget | null {
  const p = record(raw.raw_payload);
  const form = String(p.form_type ?? "").replace(/\/A$/, "");
  const accession = p.accession_number;
  const fileNumber = String(p.file_number ?? "");
  const issuer = cik(p.cik);
  if (raw.source_code !== "sec_edgar" || !issuer || !fileNumberPattern.test(fileNumber)
    || !(REGISTRATION_FORMS as readonly string[]).includes(form)
    || !accessionPattern.test(accession ?? "") || raw.source_unique_id !== accession
    || !secDocumentUrl(String(raw.source_url ?? ""), accession)) return null;
  return { cik: issuer, fileNumber, form, accession, company: String(p.company_name ?? ""),
    filedAt: String(raw.published_at ?? ""), sourceUrl: raw.source_url, filingCount: 1 };
}
export async function findRegistrationTargets(query: string, form?: string, select: Select = defaultSelect) {
  // Bounded searches report incompleteness; they never select the newest record.
  const q = query.trim();
  if (!q || q.length > 160) throw new Error("Provide a company, ticker, CIK, registration number or accession.");
  const filters: Record<string, string> = { select: "id,source_code,source_unique_id,source_url,published_at,raw_payload", source_code: "eq.sec_edgar", limit: "101" };
  if (accessionPattern.test(q)) filters.source_unique_id = `eq.${q}`;
  else if (fileNumberPattern.test(q)) filters["raw_payload->>file_number"] = `eq.${q}`;
  else if (/^\d{1,10}$/.test(q)) filters["raw_payload->>cik"] = `eq.${cik(q)}`;
  else if (/^[A-Z][A-Z0-9.-]{0,9}$/.test(q)) filters["raw_payload->>ticker"] = `eq.${q}`;
  else if (/^[\p{L}\p{N} .&'-]+$/u.test(q)) filters["raw_payload->>company_name"] = `ilike.*${q}*`;
  else throw new Error("Use an exact company name, ticker, accession or registration number.");
  filters["raw_payload->>form_type"] = `in.(${(form ? [form] : REGISTRATION_FORMS).flatMap(f => [f, `${f}/A`]).join(",")})`;
  const result = rows(await select("raw_items", filters));
  if (result.length >= 101) throw new Error("Too many filings to resolve safely. Specify the registration number or accession.");
  const groups = new Map<string, RegistrationTarget>();
  for (const raw of result.sort((a,b) => String(a.source_unique_id).localeCompare(String(b.source_unique_id)))) {
    const target = registrationFromRaw(raw);
    if (!target) continue;
    const key = `${target.cik}:${target.fileNumber}`;
    const prior = groups.get(key);
    if (prior && prior.form !== target.form) throw new Error("Conflicting registration forms need review.");
    if (prior) prior.filingCount += 1;
    else groups.set(key, target);
  }
  return [...groups.values()];
}
export async function verifyRegistrationTarget(conditions: readonly EffectCondition[], select: Select = defaultSelect) {
  const target = effectTarget(conditions);
  if (!target) throw new Error("Confirm an exact registration target first.");
  const found = rows(await select("raw_items", { select: "*", source_code: "eq.sec_edgar", source_unique_id: `eq.${target.accession}`, limit: "2" }));
  const registration = found.length === 1 ? registrationFromRaw(found[0]) : null;
  if (!registration || registration.cik !== target.cik || registration.fileNumber !== target.fileNumber || registration.form !== target.form) {
    throw new Error("Registration evidence is unavailable or conflicts with the selected target.");
  }
  return registration;
}
