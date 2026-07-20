"use client";

import { useSyncExternalStore } from "react";

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
  const theme = useSyncExternalStore(
    subscribeToDocumentTheme,
    readDocumentTheme,
    readServerTheme,
  );

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
        srcDoc={buildSecFilingSrcDoc(html, sourceUrl, theme)}
        title={title}
      />
    </div>
  );
}

type SecFilingViewerTheme = "dark" | "light";

function buildSecFilingSrcDoc(
  html: string,
  sourceUrl: string | undefined,
  theme: SecFilingViewerTheme,
) {
  const cleaned = sanitizeSecFilingHtml(html);
  const baseHref = sourceUrl ? `<base href="${escapeAttribute(sourceUrl)}" target="_blank" />` : "";
  const viewerHead = `${baseHref}
  <style>${buildSecViewerCss(theme)}</style>`;

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
  html,
  body {
    min-height: 100%;
    margin: 0;
    background: var(--sec-document-background);
    color: var(--sec-document-text);
    font-family: "Times New Roman", Times, serif;
    font-size: 14px;
    line-height: 1.35;
  }
  body {
    padding: 18px;
  }
  a {
    color: var(--sec-document-link);
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
  table,
  th,
  td {
    border-color: var(--sec-document-border);
  }
  th,
  td {
    color: inherit;
    background-color: transparent;
  }
  hr {
    border-color: var(--sec-document-border);
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

function buildSecViewerCss(theme: SecFilingViewerTheme) {
  const themeCss =
    theme === "dark"
      ? `
  :root {
    color-scheme: dark;
    --sec-document-background: #0b1017;
    --sec-document-text: #d7dfeb;
    --sec-document-link: #7aa7ff;
    --sec-document-border: #2a3545;
  }`
      : `
  :root {
    color-scheme: light;
    --sec-document-background: #ffffff;
    --sec-document-text: #111111;
    --sec-document-link: #1b4fb8;
    --sec-document-border: #cbd3df;
  }`;

  return `${themeCss}\n${SEC_VIEWER_BASE_CSS}`;
}

function injectViewerHead(html: string, viewerHead: string) {
  if (/<\/head\s*>/i.test(html)) {
    return html.replace(/<\/head\s*>/i, `${viewerHead}\n</head>`);
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
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (_match, attributes, css) => {
      const cleanedCss = stripColorDeclarations(css);
      return cleanedCss.trim() ? `<style${attributes}>${cleanedCss}</style>` : "";
    })
    .replace(/<meta\b[^>]*http-equiv=["']?refresh["']?[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s+(href|src)\s*=\s*"javascript:[^"]*"/gi, "")
    .replace(/\s+(href|src)\s*=\s*'javascript:[^']*'/gi, "")
    .replace(/\s+(?:color|bgcolor)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s+style\s*=\s*(["'])([\s\S]*?)\1/gi, (_match, quote, style) => {
      const cleanedStyle = stripColorDeclarations(style).trim();
      return cleanedStyle ? ` style=${quote}${cleanedStyle}${quote}` : "";
    });
}

function stripColorDeclarations(value: string) {
  return value.replace(
    /(^|[;{]\s*)(?:color|background(?:-color)?)\s*:\s*[^;}]+;?/gim,
    "$1",
  );
}

function subscribeToDocumentTheme(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributeFilter: ["data-theme"],
    attributes: true,
  });
  window.addEventListener("storage", onStoreChange);

  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onStoreChange);
  };
}

function readDocumentTheme(): SecFilingViewerTheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function readServerTheme(): SecFilingViewerTheme {
  return "dark";
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
