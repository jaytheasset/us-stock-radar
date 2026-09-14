/** Ordinary withdrawal keeps its original reset semantics; forced withdrawal pops only its override. */
export function activeForm25IdentityDecision(history: Record<string, unknown>[]) {
  const stack: Record<string, unknown>[] = [];
  for (const row of history) {
    if (row.action === "withdrawn") stack.length = 0;
    else if (row.action === "forced_withdrawn") {
      const active = stack.at(-1);
      if (active?.action !== "forced_approved" || active.id !== row.withdraws_decision_id) throw new Error("identity_override_history_invalid");
      stack.pop();
    } else if (["approved", "held", "forced_approved"].includes(String(row.action))) stack.push(row);
    else throw new Error("identity_action_invalid");
  }
  return stack.at(-1);
}

export function normalizeForm25OverrideReference(value: unknown): string | null {
  const reference = String(value ?? "").trim();
  if (!reference) return null;
  if (/^\d{10}-\d{2}-\d{6}$/.test(reference)) return reference;
  try {
    const url = new URL(reference);
    if (url.protocol === "https:" && ["sec.gov", "www.sec.gov"].includes(url.hostname) && !url.username && !url.password && !url.port && reference.length <= 2000) return url.href;
  } catch { /* A reference is optional, but rendered URLs must stay on SEC. */ }
  throw new Error("Use a SEC accession or an https://www.sec.gov reference URL.");
}

/** The archive path's CIK may identify a filer/agent, never an issuer identity. */
export function form25ReferenceAccession(reference: string | null): string | null {
  if (!reference) return null;
  if (/^\d{10}-\d{2}-\d{6}$/.test(reference)) return reference;
  const digits = reference.match(/\/([0-9]{18})(?:\/|$)/)?.[1];
  return digits ? `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}` : null;
}

function securityKind(value: string | null) {
  if (!value) return null;
  const title = value.toLowerCase();
  const kind = /\bwarrants?\b/.test(title) ? "warrant" : /\bpreferred\b/.test(title) ? "preferred"
    : /\bcommon stock\b|\bordinary shares?\b/.test(title) ? "equity"
    : /\bnotes?\b|\bdebentures?\b|\bbonds?\b/.test(title) ? "debt" : null;
  return kind ? { kind, securityClass: title.match(/\bclass\s+([a-z0-9-]+)\b/)?.[1] ?? null } : null;
}

export function clearForm25SecurityConflict(subject: string | null, reference: string | null): boolean {
  const a = securityKind(subject), b = securityKind(reference);
  return Boolean(a && b && (a.kind !== b.kind || (a.securityClass && b.securityClass && a.securityClass !== b.securityClass)));
}

export function forcedDecisionTicker(decision: Record<string, unknown> | undefined): string | null {
  const ticker = typeof decision?.override_ticker === "string" ? decision.override_ticker : null;
  return decision?.action === "forced_approved" && ticker && /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) ? ticker : null;
}
