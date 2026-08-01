import { verifyEmailUnsubscribeToken } from "../../../../../lib/alerts/emailUnsubscribeToken.ts";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
};

export async function GET(request: Request) {
  const verified = verifyUnsubscribeRequest(request);
  if (!verified) return invalidTokenResponse();

  const actionUrl = new URL(request.url);
  actionUrl.search = "";
  actionUrl.searchParams.set("token", verified.token);

  return new Response(
    `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><body><main><h1>Turn off Stock Radar alert emails?</h1><p>This keeps Web, Telegram, tickers, and other alert settings unchanged.</p><form method="post" action="${escapeHtml(actionUrl.toString())}"><button type="submit">Turn off Email alerts</button></form></main></body></html>`,
    {
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": "text/html; charset=utf-8",
      },
    },
  );
}

export async function POST(request: Request) {
  const verified = verifyUnsubscribeRequest(request);
  if (!verified) return invalidTokenResponse();

  const updated = await disableEmailChannel(verified.userId);
  if (!updated) {
    return new Response("Unable to update Email alerts.", {
      status: 503,
      headers: NO_STORE_HEADERS,
    });
  }

  return new Response("Email alerts are off. Other alert channels remain unchanged.", {
    headers: NO_STORE_HEADERS,
  });
}

function verifyUnsubscribeRequest(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim() || "";
  const secret = process.env.ALERT_EMAIL_UNSUBSCRIBE_SECRET || "";
  const verified = verifyEmailUnsubscribeToken(token, secret);
  return verified ? { ...verified, token } : null;
}

async function disableEmailChannel(userId: string) {
  const baseUrl = (process.env.SUPABASE_URL || "")
    .replace(/\/rest\/v1\/?$/i, "")
    .replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!baseUrl || !key) return false;

  const url = new URL(`${baseUrl}/rest/v1/user_delivery_channels`);
  url.searchParams.set("user_id", `eq.${userId}`);
  url.searchParams.set("channel", "eq.email");

  try {
    const response = await fetch(url, {
      method: "PATCH",
      cache: "no-store",
      headers: supabaseHeaders(key),
      body: JSON.stringify({ enabled: false }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function supabaseHeaders(key: string) {
  const headers: Record<string, string> = {
    apikey: key,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  if (!key.startsWith("sb_secret_") && !key.startsWith("sb_publishable_")) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

function invalidTokenResponse() {
  return new Response("Invalid or expired unsubscribe link.", {
    status: 400,
    headers: NO_STORE_HEADERS,
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
