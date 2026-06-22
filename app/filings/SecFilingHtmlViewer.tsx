type SecFilingHtmlViewerProps = {
  html: string;
  sourceUrl?: string;
  title?: string;
  emptyText?: string;
};

export function SecFilingHtmlViewer({
  html,
  sourceUrl,
  title = "Original SEC filing document",
  emptyText = "Full source text is not available in the raw item store for this filing.",
}: SecFilingHtmlViewerProps) {
  if (!html.trim()) {
    return (
      <div className="full-text-content filing-text-content sec-filing-viewer-fallback">
        <p>{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="sec-filing-viewer-shell">
      <iframe
        className="sec-filing-viewer-frame"
        loading="lazy"
        referrerPolicy="no-referrer"
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        srcDoc={buildSecFilingSrcDoc(html, sourceUrl)}
        title={title}
      />
    </div>
  );
}

function buildSecFilingSrcDoc(html: string, sourceUrl?: string) {
  const cleaned = sanitizeSecFilingHtml(html);
  const baseHref = sourceUrl ? `<base href="${escapeAttribute(sourceUrl)}" target="_blank" />` : "";
  const viewerHead = `${baseHref}
  <style>${SEC_VIEWER_BASE_CSS}</style>`;

  if (hasHtmlDocumentShell(cleaned)) {
    return injectViewerHead(cleaned, viewerHead);
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${viewerHead}
</head>
<body>
  <main class="sec-document-body">${cleaned}</main>
</body>
</html>`;
}

const SEC_VIEWER_BASE_CSS = `
  :root {
    color-scheme: light;
    background: #ffffff;
  }
  html,
  body {
    min-height: 100%;
    margin: 0;
    background: #ffffff;
    color: #111111;
    font-family: "Times New Roman", Times, serif;
    font-size: 14px;
    line-height: 1.35;
  }
  body {
    padding: 18px;
  }
  a {
    color: #1b4fb8;
    text-decoration: none;
  }
  a:hover,
  a:focus {
    text-decoration: underline;
  }
  table {
    max-width: 100%;
    border-collapse: collapse;
  }
  img {
    max-width: 100%;
    height: auto;
  }
  pre {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .sec-document-body {
    max-width: 980px;
    margin: 0 auto;
  }
`;

function injectViewerHead(html: string, viewerHead: string) {
  if (/<head[\s>]/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>\n${viewerHead}`);
  }

  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1>\n<head>${viewerHead}</head>`);
  }

  return `<!doctype html><html><head>${viewerHead}</head><body>${html}</body></html>`;
}

function sanitizeSecFilingHtml(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>[\s\S]*?<\/embed>/gi, "")
    .replace(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s+(href|src)\s*=\s*"javascript:[^"]*"/gi, "")
    .replace(/\s+(href|src)\s*=\s*'javascript:[^']*'/gi, "");
}

function hasHtmlDocumentShell(value: string) {
  return /<html[\s>]/i.test(value) || /<body[\s>]/i.test(value);
}

function escapeAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
