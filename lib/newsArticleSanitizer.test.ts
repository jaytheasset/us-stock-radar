import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeNewsArticleHtml } from "./newsArticleSanitizer.ts";

const SOURCE_URL = "https://news.example.com/releases/2026/article.html";

function sanitize(html: string) {
  return sanitizeNewsArticleHtml(html, SOURCE_URL);
}

function assertNoActiveContent(output: string) {
  assert.doesNotMatch(
    output,
    /<(?:base|button|embed|form|iframe|input|link|meta|object|script|style|svg|textarea)\b/i,
  );
  assert.doesNotMatch(output, /\s(?:on[a-z]+|srcdoc)\s*=/i);
  assert.doesNotMatch(output, /(?:javascript|vbscript):/i);
  assert.doesNotMatch(output, /data:(?:text\/html|image\/svg\+xml)/i);
}

test("removes active content, event handlers, and dangerous URLs", async (t) => {
  const attacks = [
    ["unclosed iframe", '<p>Before</p><iframe src="https://evil.example/payload">'],
    ["parser-repaired image event handler", "<img/src=x/onerror=alert(1)><p>After</p>"],
    ["javascript link", '<a href="javascript:alert(1)">unsafe</a>'],
    ["vbscript link", '<a href="vbscript:msgbox(1)">unsafe</a>'],
    ["executable HTML data URL", '<a href="data:text/html,<script>alert(1)</script>">unsafe</a>'],
    ["SVG data image", '<img src="data:image/svg+xml,<svg onload=alert(1)></svg>" alt="unsafe">'],
    ["SVG element", '<svg onload="alert(1)"><circle /></svg><p>Safe</p>'],
    ["form controls", '<form><input autofocus onfocus="alert(1)"><p>Hidden</p></form><p>Safe</p>'],
    ["object", '<object data="https://evil.example/payload"><p>Hidden</p></object><p>Safe</p>'],
    ["embed", '<embed src="https://evil.example/payload"><p>Safe</p>'],
    ["style import", '<style>@import url("https://evil.example/style.css");</style><p>Safe</p>'],
    ["srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe><p srcdoc="unsafe">Safe</p>'],
    ["external stylesheet", '<link rel="stylesheet" href="https://evil.example/style.css"><p>Safe</p>'],
    ["document base override", '<base href="https://evil.example/"><a href="report">Safe link</a>'],
    ["document metadata", '<meta http-equiv="refresh" content="0;url=https://evil.example/"><p>Safe</p>'],
  ] as const;

  for (const [name, input] of attacks) {
    await t.test(name, () => {
      const output = sanitize(input);
      assertNoActiveContent(output);
    });
  }
});

test("converts relative article links and images to absolute URLs", () => {
  const output = sanitize('<a href="../report">Report</a><img src="./images/chart.png" alt="Chart">');

  assert.match(output, /href="https:\/\/news\.example\.com\/releases\/report"/);
  assert.match(output, /src="https:\/\/news\.example\.com\/releases\/2026\/images\/chart\.png"/);
  assert.match(output, /rel="noreferrer noopener"/);
  assert.match(output, /target="_blank"/);
});

test("keeps only safe raster data images", () => {
  const safeImages = [
    "data:image/png;base64,iVBORw0KGgo=",
    "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    "data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA==",
    "data:image/webp;base64,UklGRiIAAABXRUJQVlA=",
  ];
  const input = [
    ...safeImages.map((src, index) => `<img src="${src}" alt="safe-${index}">`),
    '<img src="data:text/html;base64,PHNjcmlwdD4=" alt="html">',
    '<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" alt="svg">',
  ].join("");
  const output = sanitize(input);

  for (const src of safeImages) {
    assert.ok(output.includes(`src="${src}"`), `expected safe raster URL to remain: ${src}`);
  }
  assert.doesNotMatch(output, /data:text\/html/i);
  assert.doesNotMatch(output, /data:image\/svg\+xml/i);
  assert.equal((output.match(/\ssrc=/g) ?? []).length, safeImages.length);
});

test("preserves normal article structure including tables and code", () => {
  const output = sanitize(`
    <article>
      <h2>Quarterly update</h2>
      <p>The company published its results.</p>
      <ul><li>Revenue increased</li></ul>
      <ol><li>Review guidance</li></ol>
      <table>
        <thead><tr><th scope="col">Metric</th><th scope="col">Value</th></tr></thead>
        <tbody><tr><td>Revenue</td><td>$10M</td></tr></tbody>
      </table>
      <pre><code>const value = 10;</code></pre>
    </article>
  `);

  for (const tag of ["article", "h2", "p", "ul", "li", "ol", "table", "thead", "tbody", "tr", "th", "td", "pre", "code"]) {
    assert.match(output, new RegExp(`<${tag}\\b`));
  }
  assert.match(output, /Quarterly update/);
  assert.match(output, /Revenue increased/);
  assert.match(output, /const value = 10;/);
});

test("is idempotent for already-sanitized article markup", () => {
  const once = sanitize(`
    <article>
      <h2>Quarterly update</h2>
      <p>Read the <a href="../report">full report</a>.</p>
      <img src="./images/chart.png" alt="Revenue chart">
    </article>
  `);

  assert.equal(sanitize(once), once);
});

test("does not throw for malformed HTML", () => {
  const malformedInputs = [
    '<iframe src="https://evil.example/payload">',
    "<img/src=x/onerror=alert(1)>",
    "<table><tr><td>open",
    "<p><strong>broken</p></strong>",
    '<a href="javascript:alert(1)"><svg onload="alert(1)">',
  ];

  for (const input of malformedInputs) {
    assert.doesNotThrow(() => sanitize(input));
    assertNoActiveContent(sanitize(input));
  }
});
