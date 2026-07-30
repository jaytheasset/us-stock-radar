"use client";

import Image from "next/image";
import { ExternalLink, ImageOff, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  KlipyMediaAttachment,
  KlipyReplyMediaPreview,
} from "@/lib/klipy/types";
import styles from "./Klipy.module.css";

export function KlipyMessageMedia({
  media,
}: {
  media: KlipyMediaAttachment;
}) {
  const [failed, setFailed] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return (
    <a
      aria-label={`Open ${media.alt} on KLIPY`}
      className={styles.messageMedia}
      href={media.itemUrl}
      rel="noopener noreferrer"
      target="_blank"
    >
      {failed ? (
        <span className={styles.mediaFallback}>
          <ImageOff aria-hidden="true" size={18} />
          GIF unavailable
          <ExternalLink aria-hidden="true" size={13} />
        </span>
      ) : (
        <Image
          alt={media.alt}
          height={media.height}
          onError={() => setFailed(true)}
          src={reduceMotion ? media.previewUrl : media.displayUrl}
          unoptimized
          width={media.width}
        />
      )}
    </a>
  );
}

export function KlipyReplyMedia({
  media,
}: {
  media: KlipyReplyMediaPreview;
}) {
  return (
    <span className={styles.replyMedia}>
      <Image
        alt=""
        aria-hidden="true"
        height={28}
        src={media.previewUrl}
        unoptimized
        width={38}
      />
      <span>GIF</span>
    </span>
  );
}

export function KlipySelectedMedia({
  media,
  onRemove,
}: {
  media: KlipyMediaAttachment;
  onRemove: () => void;
}) {
  return (
    <div className={styles.selectedMedia}>
      <Image
        alt={media.alt}
        height={48}
        src={media.previewUrl}
        unoptimized
        width={64}
      />
      <span>
        <strong>{media.title || media.alt}</strong>
        <small>KLIPY GIF selected</small>
      </span>
      <button aria-label="Remove KLIPY GIF" onClick={onRemove} type="button">
        <X aria-hidden="true" size={15} />
      </button>
    </div>
  );
}
