import type { MetadataRoute } from "next";
import { loadPublicSitemap } from "@/lib/seoSitemap";

export const dynamic = "force-dynamic";

export default function sitemap(): Promise<MetadataRoute.Sitemap> {
  return loadPublicSitemap();
}
