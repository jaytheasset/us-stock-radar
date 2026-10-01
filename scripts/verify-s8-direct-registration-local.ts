/** Three bounded real filings through normal raw ingest. No Primary/LLM/Monitor.
 * Run with --experimental-strip-types --experimental-loader ./scripts/resolve-ts-paths.mjs
 * and an evidence directory OUTSIDE the repository. Only the verified main test DB is permitted. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve, relative, isAbsolute } from "node:path";
import pg from "pg";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export{}" };
  return next(specifier, context);
} });
assert.ok(process.argv[2], "An outside-repository evidence directory is required");
const out = resolve(process.argv[2]); const rel = relative(process.cwd(), out);
assert.ok(rel.startsWith("..") || isAbsolute(rel), "Evidence must remain outside repository");
const cli = JSON.parse(execFileSync(process.execPath, ["node_modules/supabase/dist/supabase.js", "status", "-o", "json"],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
const target = new URL(cli.DB_URL);
assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "56322");
process.env.SUPABASE_URL = cli.API_URL;
process.env.SUPABASE_SECRET_KEY = cli.SECRET_KEY || cli.SERVICE_ROLE_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = cli.SERVICE_ROLE_KEY;
process.env.SUPABASE_PUBLISHABLE_KEY = cli.PUBLISHABLE_KEY || cli.ANON_KEY;
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^SEC_USER_AGENT=(.*)$/); if (m) process.env.SEC_USER_AGENT = m[1].replace(/^["']|["']$/g, "");
}
const db = new pg.Client({ connectionString: cli.DB_URL }); await db.connect();
mkdirSync(out, { recursive: true });
const report: Record<string, unknown> = { target: "127.0.0.1:56322/postgres", providerCalls: 0, startedAt: new Date().toISOString() };
const save = (name: string, data: unknown) => writeFileSync(resolve(out, name), JSON.stringify(data, null, 2));
try {
  assert.equal((await db.query("select system_identifier::text id from pg_control_system()")).rows[0].id, "7678429483712069671");
  const { runSecRawIngest } = await import("../lib/secIngest.ts");
  const { readS8Registration, readS8RegistrationHistory } = await import("../lib/sec-s8/persistence.ts");
  const { parseS8Filing } = await import("../lib/sources/sec/forms/s8/parser.ts");
  const before = (await db.query("select (select count(*) from events)::int events, (select count(*) from ai_runs)::int ai_runs")).rows[0];
  const cases = [
    { accession: "0001213900-26-059260", cik: "803578", amounts: ["556343"], amendment: false },
    { accession: "0001583708-25-000053", cik: "1583708", amounts: ["16278955", "3255791"], amendment: false },
    { accession: "0001641172-25-017852", cik: "1673481", amounts: [], amendment: true },
  ];
  const results = [];
  for (const c of cases) {
    const first = await runSecRawIngest({ accessionNumber: c.accession, cik: c.cik, includeDocuments: true, force: false });
    save(`${c.accession}-ingest.json`, first);
    assert.equal(first.ok, true);
    const row = first.items?.[0];
    assert.equal((row?.s8_registration_persistence as Record<string, unknown>)?.status, "available", JSON.stringify(row));
    const read = await readS8Registration(c.accession); save(`${c.accession}-readback.json`, read);
    assert.equal(read.status, "available"); if (read.status !== "available") throw new Error("missing readback");
    assert.deepEqual(read.facts.registrationRows.map(r => r.amountRegistered?.value), c.amounts);
    assert.equal(read.facts.isAmendment, c.amendment); assert.ok(read.facts.planDisclosures.length > 0);
    const raw = (await db.query("select * from raw_items where id=$1", [read.provenance.rawItemId])).rows[0];
    save(`${c.accession}-stored-raw.json`, raw);
    const oldParser = parseS8Filing({ fixtureName: c.accession, formType: raw.raw_payload.form_type,
      filingText: raw.body_text, attachments: raw.raw_payload.attachment_texts });
    if (c.amendment) {
      assert.equal(oldParser.facts.registeredShares, 500000);
      assert.deepEqual(read.facts.registrationRows, []); // narrative maximum must not be promoted
    }
    const second = await runSecRawIngest({ accessionNumber: c.accession, cik: c.cik, includeDocuments: true, force: false });
    save(`${c.accession}-rerun.json`, second);
    assert.equal((second.items?.[0]?.s8_registration_persistence as Record<string, unknown>)?.writeStatus, "replayed");
    assert.deepEqual(await readS8Registration(c.accession), read);
    const history = await readS8RegistrationHistory(c.cik.padStart(10, "0"));
    assert.equal(history.status, "available");
    const n = (await db.query("select count(*)::int n from sec_s8_registration_filings where accession_number=$1", [c.accession])).rows[0].n;
    assert.equal(n, 1);
    results.push({ accession: c.accession, form: read.facts.formType, amounts: c.amounts,
      plans: read.facts.plans.length, planDisclosures: read.facts.planDisclosures.length,
      sourceSha256: read.provenance.sourceSha256, firstWrite: row?.s8_registration_persistence,
      replay: "replayed", rowCount: n, parserRegisteredSharesNotPromoted: oldParser.facts.registeredShares });
    console.log(JSON.stringify(results.at(-1)));
  }
  const after = (await db.query("select (select count(*) from events)::int events, (select count(*) from ai_runs)::int ai_runs")).rows[0];
  assert.deepEqual(after, before);
  const permissions = (await db.query(`select
    has_table_privilege('anon','sec_s8_registration_filings','SELECT') anon_read,
    has_table_privilege('authenticated','sec_s8_registration_filings','INSERT') user_write,
    has_table_privilege('service_role','sec_s8_registration_filings','UPDATE') service_update,
    has_table_privilege('service_role','sec_s8_registration_filings','DELETE') service_delete,
    has_function_privilege('authenticated','persist_sec_s8_registration(uuid,jsonb,jsonb,text,text)','EXECUTE') user_rpc`)).rows[0];
  assert.ok(Object.values(permissions).every(v => v === false));
  Object.assign(report, { status: "passed", results, before, after, permissions });
} catch (error) {
  Object.assign(report, { status: "failed", error: error instanceof Error ? error.message : String(error) });
  throw error;
} finally { save("runtime-report.json", report); await db.end(); }
