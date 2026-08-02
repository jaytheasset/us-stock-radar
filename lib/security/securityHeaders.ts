export type SecurityHeader = {
  key: string;
  value: string;
};

type SecurityHeaderOptions = {
  nodeEnv?: string;
  supabaseUrl?: string;
};

const GOOGLE_AD_SCRIPT_SOURCES = [
  "https://pagead2.googlesyndication.com",
  "https://*.googlesyndication.com",
  "https://*.doubleclick.net",
  "https://*.google.com",
  "https://*.google",
] as const;

const GOOGLE_AD_RESOURCE_SOURCES = [
  "https://*.googlesyndication.com",
  "https://*.doubleclick.net",
  "https://*.google.com",
  "https://*.google",
  "https://*.googleusercontent.com",
] as const;

export const COMING_SOON_CONTENT_SECURITY_POLICY =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

export function buildContentSecurityPolicy({
  nodeEnv,
  supabaseUrl,
}: SecurityHeaderOptions = {}) {
  const development = nodeEnv !== "production";
  const scriptSources = [
    "'self'",
    // Next.js currently emits inline bootstrap code and the app has an inline
    // pre-hydration theme initializer. Removing this requires a nonce rollout.
    "'unsafe-inline'",
    ...(development ? ["'unsafe-eval'"] : []),
    ...GOOGLE_AD_SCRIPT_SOURCES,
  ];
  const connectSources = [
    "'self'",
    ...resolveSupabaseConnectSources(supabaseUrl),
    ...(development
      ? ["ws://127.0.0.1:*", "ws://localhost:*"]
      : []),
    ...GOOGLE_AD_RESOURCE_SOURCES,
  ];

  return [
    "default-src 'self'",
    `script-src ${unique(scriptSources).join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https://static.klipy.com ${GOOGLE_AD_RESOURCE_SOURCES.join(" ")}`,
    "font-src 'self' data:",
    `connect-src ${unique(connectSources).join(" ")}`,
    `frame-src 'self' ${GOOGLE_AD_RESOURCE_SOURCES.join(" ")}`,
    "media-src 'self' blob: https://static.klipy.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function buildSecurityHeaders(
  options: SecurityHeaderOptions = {},
): SecurityHeader[] {
  return [
    {
      key: "Content-Security-Policy",
      value: buildContentSecurityPolicy(options),
    },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "Permissions-Policy",
      value:
        "browsing-topics=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
  ];
}

function resolveSupabaseConnectSources(value?: string) {
  const raw = value?.trim();
  if (!raw) return [];

  try {
    const url = new URL(raw.replace(/\/rest\/v1\/?$/i, ""));
    if (url.protocol !== "https:" && url.protocol !== "http:") return [];
    const websocketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    return [url.origin, `${websocketProtocol}//${url.host}`];
  } catch {
    return [];
  }
}

function unique(values: readonly string[]) {
  return [...new Set(values)];
}
