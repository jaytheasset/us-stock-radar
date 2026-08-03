import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  APPLICATION_NAME,
  DEFAULT_SHARE_IMAGE_PATH,
  PUBLIC_SITEMAP_ROUTES,
  ROBOTS_DISALLOWED_PATHS,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  buildManifest,
  buildRobots,
  buildRootMetadata,
  buildSitemap,
} from "./seo.ts";

test("root metadata uses the canonical production origin and shared brand defaults", () => {
  const metadata = buildRootMetadata(false);
  const title = metadata.title as { default: string; template: string };
  const openGraph = metadata.openGraph as {
    description: string;
    images: Array<{ height: number; url: string; width: number }>;
    siteName: string;
    title: string;
    type: string;
  };
  const twitter = metadata.twitter as {
    card: string;
    description: string;
    images: string[];
    title: string;
  };

  assert.equal(metadata.metadataBase?.toString(), `${SITE_ORIGIN}/`);
  assert.deepEqual(title, {
    default: APPLICATION_NAME,
    template: `%s | ${SITE_NAME}`,
  });
  assert.equal(metadata.description, SITE_DESCRIPTION);
  assert.equal(metadata.applicationName, APPLICATION_NAME);
  assert.equal(metadata.creator, SITE_NAME);
  assert.equal(metadata.publisher, SITE_NAME);
  assert.equal(metadata.manifest, "/manifest.webmanifest");
  assert.equal(openGraph.type, "website");
  assert.equal(openGraph.siteName, SITE_NAME);
  assert.equal(openGraph.title, APPLICATION_NAME);
  assert.equal(openGraph.description, SITE_DESCRIPTION);
  assert.deepEqual(openGraph.images[0], {
    alt: "US Stock Radar market intelligence dashboard",
    height: 630,
    url: DEFAULT_SHARE_IMAGE_PATH,
    width: 1200,
  });
  assert.deepEqual(twitter, {
    card: "summary_large_image",
    description: SITE_DESCRIPTION,
    images: [DEFAULT_SHARE_IMAGE_PATH],
    title: APPLICATION_NAME,
  });
  assert.deepEqual(metadata.robots, { follow: true, index: true });
});

test("prelaunch metadata and robots retain complete search blocking", () => {
  assert.deepEqual(buildRootMetadata(true).robots, {
    follow: false,
    index: false,
    nocache: true,
    googleBot: {
      follow: false,
      index: false,
      noimageindex: true,
    },
  });
  assert.deepEqual(buildRobots(true), {
    rules: { disallow: "/", userAgent: "*" },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  });
});

test("launch robots allow public pages while excluding private and operational paths", () => {
  const robots = buildRobots(false);
  assert.deepEqual(robots, {
    rules: {
      allow: "/",
      disallow: [...ROBOTS_DISALLOWED_PATHS],
      userAgent: "*",
    },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  });

  for (const path of [
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
  ]) {
    assert.ok((ROBOTS_DISALLOWED_PATHS as readonly string[]).includes(path), path);
  }
});

test("sitemap contains only stable public route indexes on the official origin", () => {
  const sitemap = buildSitemap();
  assert.equal(sitemap.length, PUBLIC_SITEMAP_ROUTES.length);
  assert.deepEqual(
    sitemap.map((entry) => entry.url),
    PUBLIC_SITEMAP_ROUTES.map((entry) => `${SITE_ORIGIN}${entry.path}`),
  );

  const urls = sitemap.map((entry) => new URL(entry.url).pathname);
  assert.equal(urls.includes("/"), false, "redirecting root must not be listed");
  for (const pathname of urls) {
    assert.doesNotMatch(pathname, /\[[^\]]+\]|\/admin|\/account|\/api|\/auth|\/alerts|\/watchlist|\/saved|\/messages|\/proofs|\/development/);
  }
});

test("web manifest uses the SR icon and existing product color tokens", () => {
  assert.deepEqual(buildManifest(), {
    name: APPLICATION_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/dashboard-v2",
    display: "standalone",
    background_color: "#080a0d",
    theme_color: "#080a0d",
    icons: [
      {
        purpose: "any",
        sizes: "any",
        src: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
  });

  const icon = readProjectFile("app/icon.svg");
  assert.match(icon, /<text[^>]*>SR<\/text>/);
  assert.match(icon, /#0d1014/);
  assert.match(icon, /#ff7a1a/);
});

test("generated share and Apple images keep their required dimensions", () => {
  const openGraphImage = readProjectFile("app/opengraph-image.tsx");
  const appleIcon = readProjectFile("app/apple-icon.tsx");
  assert.match(openGraphImage, /width: 1200, height: 630/);
  assert.match(openGraphImage, /us-stock-radar\.com/);
  assert.match(appleIcon, /width: 180, height: 180/);
});

test("personal, admin, auth, and development pages retain explicit noindex metadata", () => {
  for (const path of [
    "app/account/page.tsx",
    "app/account/brokerage/page.tsx",
    "app/account/creator/page.tsx",
    "app/account/messages/page.tsx",
    "app/account/update-password/page.tsx",
    "app/admin/layout.tsx",
    "app/alerts/page.tsx",
    "app/auth/callback/page.tsx",
    "app/community/page.tsx",
    "app/development/layout.tsx",
    "app/forgot-password/page.tsx",
    "app/login/page.tsx",
    "app/messages/[conversationId]/page.tsx",
    "app/proofs/[proofId]/page.tsx",
    "app/saved/page.tsx",
    "app/signup/page.tsx",
    "app/watchlist/page.tsx",
  ]) {
    assert.match(
      readProjectFile(path),
      /robots:\s*\{[\s\S]{0,240}index:\s*false/,
      path,
    );
  }
});

function readProjectFile(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
