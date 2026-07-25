const googlePreferredSourceBaseUrl = "https://google.com/preferences/source";
export const stockRadarPublicHostname = "us-stock-radar.com";

export function buildGooglePreferredSourceUrl(): string {
  return `${googlePreferredSourceBaseUrl}?q=${encodeURIComponent(stockRadarPublicHostname)}`;
}
