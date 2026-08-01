import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  LIVE_ROOM_AVATAR_MAX_INPUT_BYTES,
  LIVE_ROOM_AVATAR_OUTPUT_SIZE,
  processLiveRoomAvatarUpload,
} from "./profileAvatarImage.ts";
import { LiveRoomPolicyError } from "./policy.ts";

test("profile avatars decode and become metadata-free square WebP images", async () => {
  const input = await sharp({
    create: {
      background: { alpha: 1, b: 180, g: 120, r: 40 },
      channels: 4,
      height: 360,
      width: 640,
    },
  })
    .withMetadata({
      exif: {
        IFD0: {
          Artist: "Private camera metadata",
        },
      },
    })
    .png()
    .toBuffer();

  const output = await processLiveRoomAvatarUpload({
    bytes: input,
    declaredMimeType: "image/png",
  });
  const metadata = await sharp(output).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, LIVE_ROOM_AVATAR_OUTPUT_SIZE);
  assert.equal(metadata.height, LIVE_ROOM_AVATAR_OUTPUT_SIZE);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
});

test("profile avatars reject disguised MIME types", async () => {
  const png = await sharp({
    create: {
      background: "white",
      channels: 3,
      height: 16,
      width: 16,
    },
  })
    .png()
    .toBuffer();

  await assertAvatarError(
    processLiveRoomAvatarUpload({
      bytes: png,
      declaredMimeType: "image/jpeg",
    }),
    "LIVE_ROOM_AVATAR_TYPE_INVALID",
    400,
  );
});

test("profile avatars reject oversized and corrupt input", async () => {
  await assertAvatarError(
    processLiveRoomAvatarUpload({
      bytes: new Uint8Array(LIVE_ROOM_AVATAR_MAX_INPUT_BYTES + 1),
      declaredMimeType: "image/png",
    }),
    "LIVE_ROOM_AVATAR_TOO_LARGE",
    413,
  );
  await assertAvatarError(
    processLiveRoomAvatarUpload({
      bytes: new TextEncoder().encode("not an image"),
      declaredMimeType: "image/webp",
    }),
    "LIVE_ROOM_AVATAR_INVALID",
    400,
  );
  await assertAvatarError(
    processLiveRoomAvatarUpload({
      bytes: new Uint8Array([0xff, 0xd8, 0xff]),
      declaredMimeType: "application/octet-stream",
    }),
    "LIVE_ROOM_AVATAR_TYPE_INVALID",
    400,
  );
});

async function assertAvatarError(
  promise: Promise<Buffer>,
  code: string,
  status: number,
) {
  await assert.rejects(
    promise,
    (error: unknown) =>
      error instanceof LiveRoomPolicyError &&
      error.code === code &&
      error.status === status,
  );
}
