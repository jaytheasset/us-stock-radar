import type { Metadata, MetadataRoute } from "next";
import { prelaunchRobotsMetadata } from "./prelaunch.ts";

export const SITE_ORIGIN = "https://us-stock-radar.com";
export const SITE_NAME = "Stock Radar";
export const APPLICATION_NAME = "US Stock Radar";
export const SITE_DESCRIPTION =
  "Stock Radar brings together U.S. market movers, company news, SEC filings, event calendars, watchlists, and alerts with investor-focused context.";
export const DEFAULT_SHARE_IMAGE_PATH = "/opengraph-image";

// Crawler discovery policy only. Authentication and authorization remain enforced by routes and the proxy.
export const ROBOTS_DISALLOWED_PATHS = [
  "/admin",
  "/account",
  "/api",
  "/auth",
  "/alerts",
  "/watchlist",
  "/saved",
  "/messages",
  "/proofs",
  "/development",
  "/community",
  "/login",
  "/signup",
  "/forgot-password",
] as const;

export const PUBLIC_SITEMAP_ROUTES = [
  { changeFrequency: "always", path: "/feed", priority: 1 },
  { changeFrequency: "hourly", path: "/news", priority: 0.9 },
  { changeFrequency: "hourly", path: "/filings", priority: 0.9 },
  { changeFrequency: "hourly", path: "/dashboard-v2", priority: 0.9 },
  { changeFrequency: "daily", path: "/calendar", priority: 0.8 },
  { changeFrequency: "daily", path: "/live", priority: 0.7 },
  { changeFrequency: "weekly", path: "/premium", priority: 0.6 },
  { changeFrequency: "monthly", path: "/privacy", priority: 0.3 },
  { changeFrequency: "monthly", path: "/terms", priority: 0.3 },
] as const satisfies ReadonlyArray<{
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  path: `/${string}`;
  priority: number;
}>;

export function buildRootMetadata(prelaunch: boolean): Metadata {
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: {
      default: APPLICATION_NAME,
      template: `%s | ${SITE_NAME}`,
    },
    description: SITE_DESCRIPTION,
    applicationName: APPLICATION_NAME,
    creator: SITE_NAME,
    publisher: SITE_NAME,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ type: "image/svg+xml", url: "/icon.svg" }],
      shortcut: ["/icon.svg"],
      apple: [{ sizes: "180x180", type: "image/png", url: "/apple-icon" }],
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: SITE_NAME,
      title: APPLICATION_NAME,
      description: SITE_DESCRIPTION,
      images: [
        {
          alt: "US Stock Radar market intelligence dashboard",
          height: 630,
          url: DEFAULT_SHARE_IMAGE_PATH,
          width: 1200,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: APPLICATION_NAME,
      description: SITE_DESCRIPTION,
      images: [DEFAULT_SHARE_IMAGE_PATH],
    },
    robots: prelaunchRobotsMetadata(prelaunch),
  };
}

export function buildRobots(prelaunch: boolean): MetadataRoute.Robots {
  return {
    rules: prelaunch
      ? {
          userAgent: "*",
          disallow: "/",
        }
      : {
          userAgent: "*",
          allow: "/",
          disallow: [...ROBOTS_DISALLOWED_PATHS],
        },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}

export function buildSitemap(): MetadataRoute.Sitemap {
  return PUBLIC_SITEMAP_ROUTES.map(({ changeFrequency, path, priority }) => ({
    url: `${SITE_ORIGIN}${path}`,
    changeFrequency,
    priority,
  }));
}

export function buildManifest(): MetadataRoute.Manifest {
  return {
    name: APPLICATION_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/dashboard-v2",
    display: "standalone",
    background_color: "#080a0d",
    theme_color: "#080a0d",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
