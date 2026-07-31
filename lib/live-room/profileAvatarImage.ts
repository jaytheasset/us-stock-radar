import sharp from "sharp";
import { LiveRoomPolicyError } from "./policy.ts";

export const LIVE_ROOM_AVATAR_MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const LIVE_ROOM_AVATAR_OUTPUT_SIZE = 512;
export const LIVE_ROOM_AVATAR_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const MIME_BY_FORMAT = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export async function processLiveRoomAvatarUpload({
  bytes,
  declaredMimeType,
}: {
  bytes: Uint8Array;
  declaredMimeType: string;
}) {
  if (
    !LIVE_ROOM_AVATAR_ALLOWED_MIME_TYPES.includes(
      declaredMimeType as (typeof LIVE_ROOM_AVATAR_ALLOWED_MIME_TYPES)[number],
    )
  ) {
    throw avatarImageError(
      "LIVE_ROOM_AVATAR_TYPE_INVALID",
      "Choose a JPEG, PNG, or WebP image.",
      400,
    );
  }
  if (!bytes.byteLength) {
    throw avatarImageError(
      "LIVE_ROOM_AVATAR_INVALID",
      "The selected image is empty or unreadable.",
      400,
    );
  }
  if (bytes.byteLength > LIVE_ROOM_AVATAR_MAX_INPUT_BYTES) {
    throw avatarImageError(
      "LIVE_ROOM_AVATAR_TOO_LARGE",
      "Profile photos can be up to 5 MB.",
      413,
    );
  }

  try {
    const image = sharp(bytes, {
      failOn: "error",
      limitInputPixels: 40_000_000,
      pages: 1,
    });
    const metadata = await image.metadata();
    const actualMimeType =
      metadata.format && metadata.format in MIME_BY_FORMAT
        ? MIME_BY_FORMAT[metadata.format as keyof typeof MIME_BY_FORMAT]
        : null;
    if (
      !actualMimeType ||
      actualMimeType !== declaredMimeType ||
      !metadata.width ||
      !metadata.height
    ) {
      throw avatarImageError(
        "LIVE_ROOM_AVATAR_TYPE_INVALID",
        "The file content does not match a supported image type.",
        400,
      );
    }

    return await sharp(bytes, {
      failOn: "error",
      limitInputPixels: 40_000_000,
      pages: 1,
    })
      .rotate()
      .resize(LIVE_ROOM_AVATAR_OUTPUT_SIZE, LIVE_ROOM_AVATAR_OUTPUT_SIZE, {
        fit: "cover",
        position: "centre",
      })
      .webp({ effort: 4, quality: 82 })
      .toBuffer();
  } catch (error) {
    if (error instanceof LiveRoomPolicyError) throw error;
    throw avatarImageError(
      "LIVE_ROOM_AVATAR_INVALID",
      "The selected image could not be decoded safely.",
      400,
    );
  }
}

function avatarImageError(
  code: string,
  message: string,
  status: number,
) {
  return new LiveRoomPolicyError(code, message, status);
}
