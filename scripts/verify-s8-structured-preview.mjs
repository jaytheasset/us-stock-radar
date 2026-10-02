// Retained real normal-ingest records -> independent analyzer; never connects to DB.
// Default offline. --live permits ONE Structured request per fixed case, no repair.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { shortCircuit: true, url: "data:text/javascript,export{}" };
  return next(specifier, context);
} });
const [evidenceDir, outputDir, credentials] = process.argv.slice(2);
assert.ok(evidenceDir && outputDir, "Supply existing S8 factual evidence directory and external output directory");
const out = resolve(outputDir), live = process.argv.includes("--live");
assert.ok(relative(process.cwd(), out).startsWith("..") || isAbsolute(relative(process.cwd(), out)));
mkdirSync(out, { recursive: true });
const read = path => JSON.parse(readFileSync(path, "utf8"));
const save = (name, value) => writeFileSync(resolve(out, name), JSON.stringify(value, null, 2));
const sha = value => createHash("sha256").update(value).digest("hex");
const { buildS8StructuredSource } = await import("../lib/sec-s8/structuredSource.ts");
const { runS8StructuredAnalyzerPreview, buildS8StructuredPrompt } = await import("../lib/ai/s8StructuredAnalyzerPreview.ts");
const { readS8Registration } = await import("../lib/sec-s8/persistence.ts");
const codePaths = [
  "lib/sec-s8/structuredCandidates.ts", "lib/sec-s8/structuredSource.ts", "lib/sec-s8/structuredContract.ts", "lib/ai/s8StructuredAnalyzerPreview.ts",
  "scripts/verify-s8-structured-preview.mjs", "lib/sec-s8/directFacts.ts", "lib/sec-s8/persistence.ts",
  "lib/ai/geminiStructuredJson.ts", "lib/env.ts", "lib/minimalOfferingMonitor.ts",
  "lib/sources/sec/forms/s8/parser.ts", "lib/sources/sec/forms/s8/analysisPrompt.ts", "lib/ai/secS8AnalysisAdapter.ts",
];
const hashes = () => Object.fromEntries(codePaths.map(p => [p, sha(readFileSync(p))]));
const frozen = hashes();
assert.equal(execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim(), "codex/s8-structured-monitor-v1");
execFileSync("git", ["diff", "--exit-code", "9e5afda70b5b7314bcb747aaaef26462ce21888b", "--",
  "lib/ai/secS8AnalysisAdapter.ts", "lib/sources/sec/forms/s8", "lib/ai/secFilingAnalysisPreview.ts",
  "lib/sec-s8/directFacts.ts", "lib/sec-s8/persistence.ts"]);
if (live) {
  assert.ok(credentials && credentials !== "--live");
  assert.ok(existsSync(resolve(out, "ground-truth.md")));
  assert.ok(!existsSync(resolve(out, "live-start.json")), "Already called; do not rerun/repair");
  assert.deepEqual(read(resolve(out, "offline.json")).codeHashes, frozen);
}
const cases = [
  ["Microsoft", "0001193125-25-337056"],
  ["Nautilus", "0001808805-26-000013"],
  ["Lottery", "0001641172-25-017852"],
];
const prepared = [];
for (const [name, accession] of cases) {
  const rawPath = resolve(evidenceDir, accession + "-raw.json");
  const canonicalPath = resolve(evidenceDir, accession + "-canonical.json");
  const raw = read(rawPath), canonical = read(canonicalPath);
  const official = await readS8Registration(accession, {
    async select(table) { assert.equal(table, "sec_s8_registration_filings"); return { ok: true, data: [canonical] }; },
    async rpc() { throw new Error("No writes allowed"); },
  });
  assert.equal(official.status, "available");
  const source = buildS8StructuredSource(raw), prompt = buildS8StructuredPrompt(source);
  assert.equal(source.sourceSha256, official.provenance.sourceSha256);
  assert.equal(source.directFactsSha256, official.provenance.factsSha256);
  const request = { systemInstruction: { parts: [{ text: prompt.system }] },
    contents: [{ role: "user", parts: [{ text: prompt.user }] }],
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4000, temperature: 0,
      thinkingConfig: { thinkingBudget: 0 } } };
  const requestHash = sha(JSON.stringify(request)), rawHash = sha(readFileSync(rawPath));
  if (live) assert.equal(read(resolve(out, name + "-offline.json")).requestHash, requestHash);
  else {
    save(name + "-source-package.json", source);
    save(name + "-request.json", request);
    save(name + "-official-reader.json", official);
    save(name + "-offline.json", { accession, rawPath, rawHash, canonicalPath, canonicalHash: sha(readFileSync(canonicalPath)),
      requestHash, sourceFingerprint: source.fingerprint, directRowCount: source.directRows.length,
      evidenceBlockCount: source.evidence.length, systemCharacters: prompt.system.length,
      userCharacters: prompt.user.length, totalRequestBytes: Buffer.byteLength(JSON.stringify(request)) });
  }
  prepared.push({ name, accession, raw, source, request, requestHash, rawHash });
}
if (!live) {
  save("offline.json", { passed: true, at: new Date().toISOString(), codeHashes: frozen,
    primaryDiff: "empty", databaseAccess: false, providerCalls: 0 });
  console.log("Offline package/official reader/Primary-diff checks PASS");
} else {
  const env = Object.fromEntries(readFileSync(credentials, "utf8").split(/\r?\n/).flatMap(line => {
    const match = line.match(/^(GEMINI_API_KEY|GEMINI_MODEL)=(.*)$/);
    return match ? [[match[1], match[2].replace(/^["']|["']$/g, "")]] : [];
  }));
  // This frozen validation follows the currently configured generic secondary model.
  assert.equal(env.GEMINI_MODEL, "gemini-2.5-flash"); assert.ok(env.GEMINI_API_KEY);
  save("live-start.json", { at: new Date().toISOString(), model: env.GEMINI_MODEL, codeHashes: frozen,
    groundTruthHash: sha(readFileSync(resolve(out, "ground-truth.md"))), maximumCalls: 3 });
  for (const p of prepared) {
    assert.deepEqual(hashes(), frozen);
    let calls = 0; const start = performance.now(), startedAt = new Date().toISOString();
    const result = await runS8StructuredAnalyzerPreview(p.raw, {
      apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL,
      fetchImpl: async (url, init) => {
        assert.equal(++calls, 1);
        assert.deepEqual(JSON.parse(init.body), p.request);
        writeFileSync(resolve(out, p.name + "-actual-request.json"), init.body);
        const response = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
        writeFileSync(resolve(out, p.name + "-raw-response.json"), await response.clone().text());
        return response;
      },
    });
    const latencyMs = Math.round(performance.now() - start);
    save(p.name + "-result.json", result);
    writeFileSync(resolve(out, p.name + "-output.txt"), result.run?.outputText ?? "");
    assert.deepEqual(buildS8StructuredSource(p.raw), p.source);
    save(p.name + "-execution.json", { startedAt, finishedAt: new Date().toISOString(), calls, latencyMs,
      stage: result.stage, error: result.error, requestHash: p.requestHash, outputHash: sha(result.run?.outputText ?? ""),
      model: result.run?.body?.modelVersion, http: result.run?.status, usage: result.run?.body?.usageMetadata,
      finishReasons: result.run?.body?.candidates?.map(c => c.finishReason), directFactsUnchanged: true });
    console.log(JSON.stringify({ case: p.name, calls, stage: result.stage, error: result.error, latencyMs }));
  }
}
