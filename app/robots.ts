import type { MetadataRoute } from "next";
import { isPrelaunchMode } from "@/lib/prelaunch";

export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: isPrelaunchMode()
      ? {
          userAgent: "*",
          disallow: "/",
        }
      : {
          userAgent: "*",
          allow: "/",
        },
  };
}
