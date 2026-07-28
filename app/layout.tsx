import type { Metadata } from "next";
import Script from "next/script";
import { AdSensePublisherLoader } from "@/components/ads/AdSensePublisherLoader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";
import {
  isPrelaunchMode,
  prelaunchRobotsMetadata,
} from "@/lib/prelaunch";
import "./stock-radar-tokens.css";
import "./globals.css";

const themeScript = `
  try {
    const primaryTheme = localStorage.getItem("sr-theme");
    const legacyTheme = localStorage.getItem("stock-radar-theme");
    const storedTheme =
      primaryTheme === "dark" || primaryTheme === "light"
        ? primaryTheme
        : (legacyTheme === "dark" || legacyTheme === "light" ? legacyTheme : null);
    const theme = storedTheme ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (_) {
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
  }
`;

export function generateMetadata(): Metadata {
  return {
    title: "US Stock Radar",
    description: "US stock alert radar dashboard",
    robots: prelaunchRobotsMetadata(isPrelaunchMode()),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const viewerPlan = await getCurrentViewerPlan();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
      </head>
      <body>
        <AdSensePublisherLoader
          enabledForViewer={areAdsEnabledForPlan(viewerPlan)}
        />
        {children}
        <ThemeToggle />
      </body>
    </html>
  );
}
