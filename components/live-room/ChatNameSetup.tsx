"use client";

import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type RefObject,
} from "react";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import {
  LIVE_ROOM_CHAT_NAME_MAX_LENGTH,
  validateLiveRoomChatName,
} from "@/lib/live-room/chatIdentity";
import {
  LIVE_ROOM_PROFILE_BIO_MAX_LENGTH,
  LiveRoomProfileBioValidationError,
  normalizeLiveRoomProfileBio,
} from "@/lib/live-room/profileBio";
import { toLiveRoomApiError } from "@/lib/live-room/apiRepository";
import type { LiveRoomProfile } from "@/lib/live-room/types";
import styles from "./ChatNameSetup.module.css";

export function ChatNameSetup({
  isOpen,
  onDismiss,
  onAvatarChange,
  onSave,
  onPresenceSettingChange,
  openerRef,
  presenceSettingBusy,
  profile,
  showPresence,
}: {
  isOpen: boolean;
  onDismiss: () => void;
  onAvatarChange: (photo: File | null) => Promise<LiveRoomProfile>;
  onSave: (
    profile: Pick<LiveRoomProfile, "bio" | "displayName">,
  ) => Promise<LiveRoomProfile>;
  onPresenceSettingChange: (showPresence: boolean) => void;
  openerRef: RefObject<HTMLElement | null>;
  presenceSettingBusy: boolean;
  profile: LiveRoomProfile;
  showPresence: boolean | null;
}) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
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
    setBio(profile.bio ?? "");
    setError(null);
    setSaving(false);
    setPhotoBusy(false);
  }, [isOpen, profile.bio, profile.displayName]);

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
      await onSave({
        bio: normalizeLiveRoomProfileBio(bio),
        displayName: validation.value,
      });
      onDismiss();
    } catch (cause) {
      setError(
        cause instanceof LiveRoomProfileBioValidationError
          ? cause.message
          : toLiveRoomApiError(cause).message,
      );
      setSaving(false);
    }
  };

  const changePhoto = async (photo: File | null) => {
    setPhotoBusy(true);
    setError(null);
    try {
      await onAvatarChange(photo);
    } catch (cause) {
      setError(toLiveRoomApiError(cause).message);
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
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
        <MemberAvatar
          displayName={displayName}
          imageUrl={profile.avatarUrl}
          size="large"
        />
        <div>
          <span>Public identity</span>
          <h2 id={titleId}>
            {profile.isChatNameSet ? "Edit profile" : "Choose a chat name"}
          </h2>
          <p>
            This name appears on new messages, posts, comments, and your member
            profile.
          </p>
        </div>
      </div>
      <div className={styles.photoControls}>
        <input
          accept="image/jpeg,image/png,image/webp"
          aria-label="Choose profile photo"
          className={styles.photoInput}
          disabled={photoBusy || saving}
          onChange={(event) => {
            const photo = event.currentTarget.files?.[0] || null;
            if (photo) void changePhoto(photo);
          }}
          ref={photoInputRef}
          type="file"
        />
        <button
          disabled={photoBusy || saving}
          onClick={() => photoInputRef.current?.click()}
          type="button"
        >
          {photoBusy
            ? "Updating..."
            : profile.avatarUrl
              ? "Replace"
              : "Upload photo"}
        </button>
        {profile.avatarUrl ? (
          <button
            disabled={photoBusy || saving}
            onClick={() => void changePhoto(null)}
            type="button"
          >
            Remove
          </button>
        ) : null}
        <small>JPEG, PNG, or WebP. Maximum 5 MB.</small>
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
      <label>
        <span className={styles.labelRow}>
          <span>About (optional)</span>
          <small aria-live="polite">
            {bio.length}/{LIVE_ROOM_PROFILE_BIO_MAX_LENGTH}
          </small>
        </span>
        <textarea
          aria-describedby={`${titleId}-bio-hint`}
          maxLength={LIVE_ROOM_PROFILE_BIO_MAX_LENGTH}
          onChange={(event) => {
            setBio(event.target.value);
            setError(null);
          }}
          placeholder="Share a short introduction."
          rows={4}
          value={bio}
        />
      </label>
      <p className={styles.hint} id={`${titleId}-bio-hint`}>
        Optional plain text, up to 280 characters and 4 lines.
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
        <button disabled={saving || photoBusy} type="submit">
          {saving ? "Saving..." : "Save profile"}
        </button>
        <button
          disabled={saving || photoBusy}
          onClick={onDismiss}
          type="button"
        >
          Cancel
        </button>
      </div>
    </form>
  );

  if (isMobile) {
    return (
      <BottomSheetShell
        aria-labelledby={titleId}
        closeLabel="Close profile editor"
        isOpen
        layout="full-scroll"
        onDismiss={onDismiss}
        openerRef={openerRef}
        overlayLabel="Close profile editor"
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
