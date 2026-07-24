const googlePreferredSourceBaseUrl = "https://google.com/preferences/source";

export function buildGooglePreferredSourceUrl(appBaseUrl: string): string | null {
  try {
    const hostname = new URL(appBaseUrl).hostname.trim();
    if (!hostname) return null;

    return `${googlePreferredSourceBaseUrl}?q=${encodeURIComponent(hostname)}`;
  } catch {
    return null;
  }
}
