const SEC_HTML_NAMED_ENTITIES: Record<string, string> = {
  apos: "'",
  copy: "\u00a9",
  hellip: "\u2026",
  laquo: "\u00ab",
  ldquo: "\u201c",
  lsquo: "\u2018",
  mdash: "\u2014",
  ndash: "\u2013",
  raquo: "\u00bb",
  rdquo: "\u201d",
  reg: "\u00ae",
  rsquo: "\u2019",
  trade: "\u2122",
};

export function decodeSecHtmlEntities(value: string) {
  return normalizeSecTextEncoding(value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => decodeHtmlCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => decodeHtmlCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name) => SEC_HTML_NAMED_ENTITIES[String(name).toLowerCase()] ?? match));
}

export function normalizeSecTextEncoding(value: string) {
  return String(value || "")
    .replace(/\u00e2\u0084\u00a2/g, "\u2122")
    .replace(/\u00c2\u00ae/g, "\u00ae")
    .replace(/\u00c2\u00a9/g, "\u00a9")
    .replace(/\u00e2\u0080\u0093/g, "\u2013")
    .replace(/\u00e2\u0080\u0094/g, "\u2014")
    .replace(/\u00e2\u0080\u0098/g, "\u2018")
    .replace(/\u00e2\u0080\u0099/g, "\u2019")
    .replace(/\u00e2\u0080\u009c/g, "\u201c")
    .replace(/\u00e2\u0080\u009d/g, "\u201d")
    .replace(/\u00e2\u0080\u00a6/g, "\u2026");
}

function decodeHtmlCodePoint(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff) return "";
  return String.fromCodePoint(value);
}
