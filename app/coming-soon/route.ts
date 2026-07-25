import type { NextRequest } from "next/server.js";
import { sanitizeInternalRedirect } from "../../lib/prelaunch.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  const returnTo = sanitizeInternalRedirect(
    request.nextUrl.searchParams.get("next"),
  );
  const error = request.nextUrl.searchParams.get("error");
  const errorMessage =
    error === "invalid"
      ? "That password was not recognized."
      : error === "unavailable"
        ? "Private access is not configured. Please try again later."
        : "";

  return new Response(renderPage(returnTo, errorMessage), {
    headers: {
      "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function renderPage(returnTo: string, errorMessage: string) {
  const feedback = errorMessage
    ? `<p id="access-error" class="error" role="alert">${escapeHtml(errorMessage)}</p>`
    : '<p class="hint">Authorized developers can continue with the private password.</p>';
  const describedBy = errorMessage ? ' aria-describedby="access-error"' : "";

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="description" content="US Stock Radar is currently in private development.">
  <title>US Stock Radar — In Development</title>
  <style>
    :root {
      color-scheme: dark;
      --sr-color-page-background: #080a0d;
      --sr-color-page-background-top: #0b0d10;
      --sr-color-surface: #0d1014;
      --sr-color-border: #2c333a;
      --sr-color-divider: #20262c;
      --sr-color-border-control: rgba(71, 79, 90, .9);
      --sr-color-text-primary: #e5e8ec;
      --sr-color-text-bright: #f5f6f7;
      --sr-color-text-subtle: #aeb5be;
      --sr-color-text-meta: #8a929d;
      --sr-color-accent: #ff7a1a;
      --sr-color-accent-text: #ff9a3c;
      --sr-color-accent-border: rgba(255, 122, 26, .58);
      --sr-color-negative: #ff675f;
      --sr-font-family-sans: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --sr-font-family-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    * { box-sizing: border-box; }
    body { margin: 0; }
    .page {
      position: relative;
      display: grid;
      min-height: 100svh;
      place-items: center;
      overflow: hidden;
      padding: 32px 20px;
      color: var(--sr-color-text-primary);
      background:
        radial-gradient(circle at 50% -10%, rgba(255, 122, 26, .09), transparent 34%),
        linear-gradient(180deg, var(--sr-color-page-background-top), var(--sr-color-page-background));
      font-family: var(--sr-font-family-sans);
    }
    .panel {
      position: relative;
      width: min(100%, 610px);
      padding: clamp(30px, 6vw, 54px);
      border: 1px solid var(--sr-color-border);
      border-radius: 18px;
      background: rgba(13, 16, 20, .94);
      box-shadow: 0 28px 80px rgba(0, 0, 0, .34), inset 0 1px 0 rgba(255, 255, 255, .025);
    }
    .brand { display: flex; align-items: center; gap: 11px; color: var(--sr-color-text-bright); font-size: 14px; font-weight: 650; }
    .mark {
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      border: 1px solid var(--sr-color-accent-border);
      border-radius: 9px;
      color: var(--sr-color-accent-text);
      background: rgba(255, 122, 26, .1);
      font: 700 12px var(--sr-font-family-mono);
    }
    .eyebrow {
      margin: 54px 0 14px;
      color: var(--sr-color-accent-text);
      font: 650 11px var(--sr-font-family-mono);
      letter-spacing: .13em;
      text-transform: uppercase;
    }
    h1 { max-width: 540px; margin: 0; color: var(--sr-color-text-bright); font-size: clamp(32px, 7vw, 52px); font-weight: 620; letter-spacing: -.04em; line-height: 1.04; }
    .intro { max-width: 480px; margin: 22px 0 0; color: var(--sr-color-text-subtle); font-size: 15px; line-height: 1.7; }
    .divider { height: 1px; margin: 38px 0 30px; background: var(--sr-color-divider); }
    label { display: block; margin-bottom: 10px; font-size: 12px; font-weight: 600; }
    .controls { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; }
    input {
      min-width: 0;
      height: 46px;
      padding: 0 14px;
      border: 1px solid var(--sr-color-border-control);
      border-radius: 9px;
      outline: none;
      color: var(--sr-color-text-primary);
      background: var(--sr-color-surface);
      font: inherit;
    }
    input:focus { border-color: var(--sr-color-accent-border); box-shadow: 0 0 0 3px rgba(255, 122, 26, .12); }
    button {
      height: 46px;
      padding: 0 20px;
      border: 1px solid var(--sr-color-accent-border);
      border-radius: 9px;
      color: #fff;
      background: #d85c08;
      font: 650 13px var(--sr-font-family-sans);
      cursor: pointer;
    }
    button:hover { background: var(--sr-color-accent); }
    .hint, .error { min-height: 18px; margin: 10px 0 0; font-size: 11px; line-height: 1.5; }
    .hint { color: var(--sr-color-text-meta); }
    .error { color: var(--sr-color-negative); }
    @media (max-width: 520px) {
      .page { align-items: start; padding: 16px; }
      .panel { margin-top: 7vh; padding: 28px 22px 26px; border-radius: 14px; }
      .eyebrow { margin-top: 44px; }
      .controls { grid-template-columns: 1fr; }
      button { width: 100%; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="panel" aria-labelledby="prelaunch-title">
      <div class="brand"><span class="mark" aria-hidden="true">SR</span><span>US Stock Radar</span></div>
      <p class="eyebrow">Private development preview</p>
      <h1 id="prelaunch-title">Sharper market context is taking shape.</h1>
      <p class="intro">We're refining the product before opening it more broadly. The public site is not available yet.</p>
      <div class="divider"></div>
      <form action="/api/prelaunch/access" method="post">
        <input type="hidden" name="next" value="${escapeHtml(returnTo)}">
        <label for="prelaunch-password">Developer access</label>
        <div class="controls">
          <input id="prelaunch-password" name="password" type="password" autocomplete="current-password" required placeholder="Password"${describedBy}>
          <button type="submit">Continue</button>
        </div>
        ${feedback}
      </form>
    </section>
  </main>
</body>
</html>`;
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] || character,
  );
}
