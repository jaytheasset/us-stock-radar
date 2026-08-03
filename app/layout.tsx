import type { Metadata } from "next";
import { AdSensePublisherLoader } from "@/components/ads/AdSensePublisherLoader";
import { ThemeToggle } from "@/components/ThemeToggle";
import { areAdsEnabledForPlan } from "@/lib/advertisingPolicy";
import { getCurrentViewerPlan } from "@/lib/currentViewerPlan";
import { isPrelaunchMode } from "@/lib/prelaunch";
import { buildRootMetadata } from "@/lib/seo";
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
  return buildRootMetadata(isPrelaunchMode());
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const viewerPlan = await getCurrentViewerPlan();

  return (
    <html
      data-theme="light"
      lang="en"
      style={{ colorScheme: "light" }}
      suppressHydrationWarning
    >
      <head>
        <script
          id="theme-init"
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
