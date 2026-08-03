import type { MetadataRoute } from "next";
import { isPrelaunchMode } from "@/lib/prelaunch";
import { buildRobots } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(isPrelaunchMode());
}
