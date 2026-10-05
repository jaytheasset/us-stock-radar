// Saved real SEC XML fixtures; HTTP envelopes below are deterministic test scaffolding.
import { readFileSync } from "node:fs";
import { fetchSecEdgarRawItems } from "../sources/sec/parser.ts";
export function effectFixture(name: string) {
  const f = JSON.parse(readFileSync(new URL(`../sources/sec/forms/effect/fixtures/${name}.json`, import.meta.url), "utf8"));
  const issuer = /<cik>(\d+)<\/cik>/.exec(f.filing.text)![1];
  const accession = f.filing.accessionNumber;
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(issuer)}/${accession.replaceAll("-", "")}`;
  return { ...f, issuer, accession, url: `${base}/primary_doc.xml`, index: `${base}/${accession}-index.html` };
}
export async function collectEffectFixture(name: string) {
  const f = effectFixture(name), originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input); requests.push(url);
    if (url.includes("/cgi-bin/browse-edgar")) return new Response(`<feed><entry><title>EFFECT - Test issuer</title><updated>2024-04-18T10:00:00Z</updated><category label="form type" term="EFFECT"/><link href="${f.index}"/></entry></feed>`);
    if (url.includes("/files/company_tickers_exchange.json")) return Response.json({fields:["cik","name","ticker","exchange"],data:[]});
    if (url === f.index) return new Response(`<span class="companyName">Test issuer</span><div class="infoHead">Filing Date</div><div class="info">2024-04-18</div><table summary="Document Format Files"><tr><td>1</td><td>EFFECT</td><td><a href="${f.url}">primary_doc.xml</a></td><td>EFFECT</td><td>4000</td></tr></table>`);
    if (url === f.url) return new Response(f.filing.text,{headers:{"content-type":"text/xml"}});
    throw new Error(`Unexpected fixture request: ${url}`);
  };
  try {
    const result = await fetchSecEdgarRawItems({formTypes:["EFFECT"],limit:1,includeDocuments:true});
    if (!result.ok || result.items.length !== 1 || result.diagnostics.documentsFailed) throw new Error(JSON.stringify(result.diagnostics));
    return { raw: JSON.parse(JSON.stringify(result.items[0])), requests };
  } finally { globalThis.fetch = originalFetch; }
}
