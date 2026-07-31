import "server-only";

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";
import { LiveRoomPolicyError } from "./policy";

export const LIVE_ROOM_AVATAR_BUCKET = "live-room-member-avatars";

const AVATAR_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export function buildLiveRoomAvatarPath(publicProfileId: string) {
  const path = `${publicProfileId}/${randomUUID()}.webp`;
  if (!AVATAR_PATH_PATTERN.test(path)) {
    throw avatarError(
      "LIVE_ROOM_AVATAR_PATH_INVALID",
      "The profile image path could not be created.",
      500,
    );
  }
  return path.toLowerCase();
}

export function buildLiveRoomAvatarUrl(path: unknown) {
  if (typeof path !== "string" || !AVATAR_PATH_PATTERN.test(path)) {
    return null;
  }
  const { supabaseUrl } = getServerEnv();
  if (!supabaseUrl) return null;
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${LIVE_ROOM_AVATAR_BUCKET}/${encodedPath}`;
}

export async function uploadLiveRoomAvatarObject(
  path: string,
  bytes: Uint8Array,
) {
  const storage = getStorageClient();
  const { error } = await storage
    .from(LIVE_ROOM_AVATAR_BUCKET)
    .upload(path, bytes, {
      cacheControl: "31536000",
      contentType: "image/webp",
      upsert: false,
    });
  if (error) {
    throw avatarError(
      "LIVE_ROOM_AVATAR_UPLOAD_FAILED",
      "The profile photo could not be uploaded.",
      502,
    );
  }
}

export async function removeLiveRoomAvatarObject(path: string | null) {
  if (!path || !AVATAR_PATH_PATTERN.test(path)) return false;
  const storage = getStorageClient();
  const { error } = await storage
    .from(LIVE_ROOM_AVATAR_BUCKET)
    .remove([path]);
  return !error;
}

function getStorageClient() {
  const { supabaseServiceRoleKey, supabaseUrl } = getServerEnv();
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw avatarError(
      "LIVE_ROOM_AVATAR_UNAVAILABLE",
      "Profile photo storage is not configured.",
      503,
    );
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  }).storage;
}

function avatarError(code: string, message: string, status: number) {
  return new LiveRoomPolicyError(code, message, status);
}
