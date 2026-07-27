import {
  SOCIAL_VERIFICATION_PLATFORMS,
  type SocialVerificationPlatform,
} from "./types.ts";

const allowedHosts: Record<
  SocialVerificationPlatform,
  Record<"profile" | "proof", ReadonlySet<string>>
> = {
  x: {
    profile: new Set(["x.com", "twitter.com"]),
    proof: new Set(["x.com", "twitter.com"]),
  },
  youtube: {
    profile: new Set(["youtube.com", "www.youtube.com"]),
    proof: new Set(["youtube.com", "www.youtube.com", "youtu.be"]),
  },
  instagram: {
    profile: new Set(["instagram.com", "www.instagram.com"]),
    proof: new Set(["instagram.com", "www.instagram.com"]),
  },
};

const handlePattern = /^[a-z0-9._-]{1,64}$/;

export class SocialVerificationError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "SocialVerificationError";
    this.code = code;
    this.status = status;
  }
}

export function normalizeSocialPlatform(
  value: unknown,
): SocialVerificationPlatform {
  const platform =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    !SOCIAL_VERIFICATION_PLATFORMS.includes(
      platform as SocialVerificationPlatform,
    )
  ) {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_INVALID_PLATFORM",
      "Choose X, YouTube, or Instagram.",
    );
  }
  return platform as SocialVerificationPlatform;
}

export function normalizeSocialHandle(value: unknown) {
  const handle =
    typeof value === "string"
      ? value.trim().replace(/^@/, "").toLowerCase()
      : "";
  if (!handlePattern.test(handle)) {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_INVALID_HANDLE",
      "Use a public handle with letters, numbers, dots, dashes, or underscores.",
    );
  }
  return handle;
}

export function normalizeSocialUrl(
  value: unknown,
  platform: SocialVerificationPlatform,
  kind: "profile" | "proof",
) {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input || input.length > (kind === "proof" ? 700 : 500)) {
    throw invalidUrl(kind);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw invalidUrl(kind);
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !allowedHosts[platform][kind].has(url.hostname.toLowerCase()) ||
    url.pathname === "/"
  ) {
    throw invalidUrl(kind);
  }

  url.hash = "";
  return url.toString();
}

export function socialPlatformLabel(platform: SocialVerificationPlatform) {
  if (platform === "x") return "X";
  if (platform === "youtube") return "YouTube";
  return "Instagram";
}

export function socialBadgeLabel(platform: SocialVerificationPlatform) {
  return `Verified ${socialPlatformLabel(platform)}`;
}

export function normalizePublicRequestId(value: unknown) {
  const id = typeof value === "string" ? value.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    throw new SocialVerificationError(
      "SOCIAL_VERIFICATION_INVALID_REQUEST",
      "That verification request is invalid.",
    );
  }
  return id;
}

function invalidUrl(kind: "profile" | "proof") {
  return new SocialVerificationError(
    "SOCIAL_VERIFICATION_INVALID_URL",
    `Enter a valid HTTPS ${kind} URL on the selected platform.`,
  );
}
