import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";
import {
  buildSecurityHeaders,
  COMING_SOON_CONTENT_SECURITY_POLICY,
} from "./lib/security/securityHeaders";
import { getAllowedDevHostnames } from "./lib/devAllowedOrigins.ts";

const nextConfig: NextConfig = {
  // Workflow's CLI-config dependency reads require.main.filename at import time.
  // Keep Node's module metadata; Webpack's entry module has no filename.
  serverExternalPackages: ["xdg-app-paths"],
  allowedDevOrigins: getAllowedDevHostnames({
    nodeEnv: process.env.NODE_ENV,
    value: process.env.DEV_ALLOWED_ORIGINS,
  }),
  async headers() {
    const securityHeaders = buildSecurityHeaders({
      nodeEnv: process.env.NODE_ENV,
      supabaseUrl: process.env.SUPABASE_URL,
      devAllowedOrigins: process.env.DEV_ALLOWED_ORIGINS,
    });
    const contentSecurityPolicy = securityHeaders.find(
      (header) => header.key === "Content-Security-Policy",
    );
    const commonHeaders = securityHeaders.filter(
      (header) => header.key !== "Content-Security-Policy",
    );
    return [
      {
        source: "/:path*",
        headers: commonHeaders,
      },
      ...(contentSecurityPolicy
        ? [
            {
              source: "/:path*",
              headers: [contentSecurityPolicy],
            },
          ]
        : []),
      {
        source: "/coming-soon",
        headers: [
          {
            key: "Content-Security-Policy",
            value: COMING_SOON_CONTENT_SECURITY_POLICY,
          },
        ],
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "static.klipy.com",
      },
    ],
  },
};

export default withWorkflow(nextConfig);
