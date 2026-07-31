"use client";

import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import {
  LIVE_ROOM_CHAT_NAME_MAX_LENGTH,
  validateLiveRoomChatName,
} from "@/lib/live-room/chatIdentity";
import { toLiveRoomApiError } from "@/lib/live-room/apiRepository";
import type { LiveRoomProfile } from "@/lib/live-room/types";
import styles from "./ChatNameSetup.module.css";

export function ChatNameSetup({
  isOpen,
  onDismiss,
  onSave,
  onPresenceSettingChange,
  openerRef,
  presenceSettingBusy,
  profile,
  showPresence,
}: {
  isOpen: boolean;
  onDismiss: () => void;
  onSave: (displayName: string) => Promise<LiveRoomProfile>;
  onPresenceSettingChange: (showPresence: boolean) => void;
  openerRef: RefObject<HTMLElement | null>;
  presenceSettingBusy: boolean;
  profile: LiveRoomProfile;
  showPresence: boolean | null;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = `live-room-chat-name-${useId()}`;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    setDisplayName(profile.displayName);
    setError(null);
    setSaving(false);
  }, [isOpen, profile.displayName]);

  useEffect(() => {
    if (!isOpen || isMobile) return;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      openerRef.current?.focus();
    };
  }, [isMobile, isOpen, openerRef]);

  if (!isOpen) return null;

  const submit = async () => {
    const validation = validateLiveRoomChatName(displayName);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(validation.value);
      onDismiss();
    } catch (cause) {
      setError(toLiveRoomApiError(cause).message);
      setSaving(false);
    }
  };

  const content = (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className={styles.heading}>
        <MemberAvatar displayName={displayName} size="large" />
        <div>
          <span>Public identity</span>
          <h2 id={titleId}>
            {profile.isChatNameSet ? "Change chat name" : "Choose a chat name"}
          </h2>
          <p>
            This name appears on new messages, posts, comments, and your member
            profile.
          </p>
        </div>
      </div>
      <label>
        Chat name
        <input
          aria-describedby={`${titleId}-hint`}
          autoComplete="off"
          autoFocus
          maxLength={LIVE_ROOM_CHAT_NAME_MAX_LENGTH}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setError(null);
          }}
          placeholder="Market Scout"
          spellCheck={false}
          value={displayName}
        />
      </label>
      <p className={styles.hint} id={`${titleId}-hint`}>
        2–24 characters. Start with a letter; use letters, numbers, spaces, _
        or -.
      </p>
      {error ? (
        <p aria-live="polite" className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {showPresence !== null ? (
        <div className={styles.presenceSetting}>
          <span>
            <strong>Show when I&apos;m active in Live Rooms</strong>
            <small>Only shows activity in the room you are viewing.</small>
          </span>
          <button
            aria-checked={showPresence}
            aria-label="Show when I am active in Live Rooms"
            className={styles.presenceSwitch}
            disabled={presenceSettingBusy}
            onClick={() => onPresenceSettingChange(!showPresence)}
            role="switch"
            type="button"
          >
            <span />
          </button>
        </div>
      ) : null}
      <Link className={styles.creatorLink} href="/account/creator">
        <BadgeCheck aria-hidden="true" size={17} />
        <span>
          <strong>Apply for creator verification</strong>
          <small>Verify ownership of Instagram, X, or YouTube.</small>
        </span>
      </Link>
      <div className={styles.actions}>
        <button disabled={saving} type="submit">
          {saving ? "Saving..." : "Save chat name"}
        </button>
        <button disabled={saving} onClick={onDismiss} type="button">
          Cancel
        </button>
      </div>
    </form>
  );

  if (isMobile) {
    return (
      <BottomSheetShell
        aria-labelledby={titleId}
        closeLabel="Close chat name setup"
        isOpen
        layout="full-scroll"
        onDismiss={onDismiss}
        openerRef={openerRef}
        overlayLabel="Close chat name setup"
      >
        <div className={styles.mobileContent}>{content}</div>
      </BottomSheetShell>
    );
  }

  return (
    <dialog
      aria-labelledby={titleId}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
      ref={dialogRef}
    >
      {content}
    </dialog>
  );
}
