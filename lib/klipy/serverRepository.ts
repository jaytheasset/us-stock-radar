import "server-only";

import { supabaseSelect } from "@/lib/supabase";
import type {
  KlipyMediaAttachment,
  KlipyReplyMediaPreview,
} from "./types";

type MediaRow = Record<string, unknown>;

export async function getKlipyMediaMapForMessages(
  messageIds: readonly string[],
) {
  const ids = [...new Set(messageIds.filter(Boolean))];
  if (!ids.length) return new Map<string, KlipyMediaAttachment>();
  const result = await supabaseSelect("live_room_message_media", {
    select:
      "message_id,provider,provider_media_id,media_kind,title,alt_text,display_url,preview_url,width,height,item_url",
    message_id: `in.(${ids.join(",")})`,
    limit: String(ids.length),
  });
  if (!result.ok) {
    throw new Error(
      result.error || "KLIPY message media could not be loaded.",
    );
  }
  return new Map(
    readRows(result.data).flatMap((row) => {
      const media = mapMediaRow(row);
      const messageId = readString(row.message_id);
      return media && messageId ? [[messageId, media] as const] : [];
    }),
  );
}

export function toKlipyReplyMediaPreview(
  media: KlipyMediaAttachment | null | undefined,
): KlipyReplyMediaPreview | null {
  return media
    ? { alt: media.alt, kind: "gif", previewUrl: media.previewUrl }
    : null;
}

function mapMediaRow(row: MediaRow): KlipyMediaAttachment | null {
  if (
    row.provider !== "klipy" ||
    row.media_kind !== "gif" ||
    !readString(row.provider_media_id)
  ) {
    return null;
  }
  const width = readPositiveInteger(row.width);
  const height = readPositiveInteger(row.height);
  return {
    alt: readString(row.alt_text) || "KLIPY GIF",
    aspect: width / height,
    description: "",
    displayUrl: readString(row.display_url),
    height,
    itemUrl: readString(row.item_url),
    kind: "gif",
    previewUrl: readString(row.preview_url),
    provider: "klipy",
    providerMediaId: readString(row.provider_media_id),
    title: readString(row.title),
    width,
  };
}

function readRows(value: unknown): MediaRow[] {
  return Array.isArray(value)
    ? value.filter(
        (row): row is MediaRow =>
          Boolean(row && typeof row === "object" && !Array.isArray(row)),
      )
    : [];
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readPositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}
