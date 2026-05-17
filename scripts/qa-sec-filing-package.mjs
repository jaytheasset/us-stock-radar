#!/usr/bin/env node

const args = new Map(
  process.argv
    .slice(2)
    .map((arg) => {
      const [key, value = "true"] = arg.replace(/^--/, "").split("=");
      return [key, value];
    }),
);

const baseUrl = String(args.get("base") || process.env.APP_LOCAL_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const checks = [];

try {
  const accession = args.get("accession");
  const query = accession ? `?accession=${encodeURIComponent(accession)}` : "";
  const result = await getJson(`/api/ai/sec-filing-package-preview${query}`);
  const filingPackage = result.package || {};

  check("package preview returns ok", result.ok === true, result);
  check("package has accession", Boolean(filingPackage.accession_number), filingPackage);
  check("package has form type", Boolean(filingPackage.form_type), filingPackage);
  check("package has form family", Boolean(filingPackage.form_family), filingPackage);
  check("package has primary document URL", Boolean(filingPackage.primary_document_url), filingPackage);
  check("package has llm text", String(filingPackage.llm_text || "").length > 500, filingPackage.package_stats);
  check("package respects max char budget", Number(filingPackage.package_stats?.included_chars || 0) <= 180000, filingPackage.package_stats);
  check("package lists documents", Array.isArray(filingPackage.documents) && filingPackage.documents.length > 0, filingPackage.documents);

  printAndExit();
} catch (error) {
  checks.push({
    name: "qa script failed",
    ok: false,
    detail: error instanceof Error ? error.message : String(error),
  });
  printAndExit();
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { cache: "no-store" });
  const text = await response.text();
  if (!response.ok) throw new Error(`GET ${path} failed: HTTP ${response.status} ${short(text)}`);
  return text ? JSON.parse(text) : null;
}

function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail: ok ? undefined : detail });
}

function printAndExit() {
  const summary = {
    baseUrl,
    checksPassed: checks.filter((item) => item.ok).length,
    checksFailed: checks.filter((item) => !item.ok).length,
  };
  console.log(JSON.stringify({ ok: summary.checksFailed === 0, summary, checks }, null, 2));
  process.exitCode = summary.checksFailed === 0 ? 0 : 1;
}

function short(value) {
  return String(value).length > 500 ? `${String(value).slice(0, 500)}...` : String(value);
}
