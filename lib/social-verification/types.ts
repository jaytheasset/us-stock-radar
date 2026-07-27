export const SOCIAL_VERIFICATION_PLATFORMS = [
  "x",
  "youtube",
  "instagram",
] as const;

export type SocialVerificationPlatform =
  (typeof SOCIAL_VERIFICATION_PLATFORMS)[number];

export type SocialVerificationStatus =
  | "draft"
  | "proof_ready"
  | "pending_review"
  | "verified"
  | "rejected"
  | "expired"
  | "cancelled";

export type SocialVerificationRequest = {
  expiresAt: string | null;
  normalizedHandle: string;
  platform: SocialVerificationPlatform;
  profileUrl: string;
  proofCode: string;
  proofUrl: string | null;
  publicRequestId: string;
  reviewNote: string | null;
  showOnProfile: boolean;
  status: SocialVerificationStatus;
  submittedAt: string | null;
};

export type SocialVerificationReview = {
  applicantDisplayName: string;
  applicantEmoji: string;
  expiresAt: string;
  normalizedHandle: string;
  platform: SocialVerificationPlatform;
  profileUrl: string;
  proofCode: string;
  proofUrl: string;
  publicRequestId: string;
  submittedAt: string;
};

export type LiveRoomSocialBadge = {
  label: string;
  platform: SocialVerificationPlatform;
  profileUrl: string;
};
