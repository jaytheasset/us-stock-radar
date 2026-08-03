import type { MetadataRoute } from "next";
import { buildManifest } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return buildManifest();
}
