"use client";

import {
  Plus,
  Send,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BrokerageEvidencePicker } from "@/components/brokerage/BrokerageEvidencePicker";
import type { BrokerageProofSummary } from "@/lib/brokerage/types";
import {
  KlipyPicker,
} from "@/components/klipy/KlipyPicker";
import {
  KlipyReplyMedia,
  KlipySelectedMedia,
} from "@/components/klipy/KlipyMedia";
import type { KlipyMediaAttachment } from "@/lib/klipy/types";
import {
  LIVE_ROOM_MESSAGE_MAX_LENGTH,
  type ModerationDecision,
} from "@/lib/live-room/moderation";
import type {
  CompanyEventReference,
  LiveRoomProfile,
  LiveRoomReplyPreview,
} from "@/lib/live-room/types";
import { formatPublicChatName } from "@/lib/live-room/chatIdentity";
import { ChatNameSetup } from "./ChatNameSetup";
import { LiveRoomDisclosureNotice } from "./LiveRoomDisclosureNotice";
import styles from "./LiveRoom.module.css";

type MessageComposerProps = {
  body: string;
  decision: ModerationDecision | null;
  disabled: boolean;
  eventReference: CompanyEventReference | null;
  focusRequestId?: number;
  loginHref: string;
  onBodyChange: (body: string) => void;
  onClearReference: () => void;
  onCancelReply: () => void;
  onProfileAvatarChange: (
    photo: File | null,
  ) => Promise<LiveRoomProfile>;
  onProfileSave: (
    profile: Pick<LiveRoomProfile, "bio" | "displayName">,
  ) => Promise<LiveRoomProfile>;
  onPresenceSettingChange: (showPresence: boolean) => void;
  onMediaChange: (media: KlipyMediaAttachment | null) => void;
  onProofChange: (proof: BrokerageProofSummary | null) => void;
  onSend: () => void;
  profile: LiveRoomProfile | null;
  profileOpen: boolean;
  replyPreview: LiveRoomReplyPreview | null;
  placeholder?: string;
  presenceSettingBusy: boolean;
  media: KlipyMediaAttachment | null;
  proof: BrokerageProofSummary | null;
  sending: boolean;
  setProfileOpen: (open: boolean) => void;
  showPresence: boolean | null;
};

export function MessageComposer({
  body,
  decision,
  disabled,
  eventReference,
  focusRequestId = 0,
  loginHref,
  onBodyChange,
  onClearReference,
  onCancelReply,
  onProfileAvatarChange,
  onProfileSave,
  onPresenceSettingChange,
  onMediaChange,
  onProofChange,
  onSend,
  profile,
  profileOpen,
  replyPreview,
  placeholder = "Share a company view…",
  presenceSettingBusy,
  media,
  proof,
  sending,
  setProfileOpen,
  showPresence,
}: MessageComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const [proofPickerOpen, setProofPickerOpen] = useState(false);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const handleProofPickerOpenChange = useCallback(
    (nextOpen: boolean) => {
      setProofPickerOpen(nextOpen);
      if (nextOpen) {
        setMediaPickerOpen(false);
        setProfileOpen(false);
      }
    },
    [setProfileOpen],
  );
  const handleMediaPickerOpenChange = useCallback(
    (nextOpen: boolean) => {
      setMediaPickerOpen(nextOpen);
      if (nextOpen) {
        setProofPickerOpen(false);
        setProfileOpen(false);
      }
    },
    [setProfileOpen],
  );

  const requestSend = () => {
    onSend();
  };

  useEffect(() => {
    if (focusRequestId > 0) textareaRef.current?.focus();
  }, [focusRequestId]);

  useEffect(() => {
    if (!profileOpen) return;
    setProofPickerOpen(false);
    setMediaPickerOpen(false);
  }, [profileOpen]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(120, Math.max(52, textarea.scrollHeight))}px`;
  }, [body]);

  return (
    <div
      className={styles.composer}
    >
      {eventReference ? (
        <div className={styles.composerReference}>
          <span>
            Mentioning {eventReference.kind === "filing" ? "filing" : "news"}
          </span>
          <strong>{eventReference.title}</strong>
          <button
            aria-label="Remove event mention"
            onClick={onClearReference}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}
      {replyPreview ? (
        <div className={styles.composerReply}>
          <span>
            Replying to{" "}
            {formatPublicChatName(replyPreview.authorDisplayName)}
          </span>
          <strong>
            {replyPreview.mediaPreview ? (
              <KlipyReplyMedia media={replyPreview.mediaPreview} />
            ) : null}
            <span>{replyPreview.bodyPreview}</span>
          </strong>
          <button
            aria-label="Cancel reply"
            onClick={onCancelReply}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}
      {media ? (
        <div className={styles.composerMedia}>
          <KlipySelectedMedia
            media={media}
            onRemove={() => onMediaChange(null)}
          />
        </div>
      ) : null}

      <div className={styles.composerRow}>
        <div className={styles.profileControl}>
          <button
            aria-label={
              profile
                ? profile.isGuest
                  ? "Guest Live Room identity"
                  : `${profile.isDisplayNameCustom ? "Edit" : "Customize"} Live Room profile: ${formatPublicChatName(profile.displayName)}`
                : "Loading Live Room identity"
            }
            aria-expanded={profile?.isGuest === false ? profileOpen : false}
            aria-haspopup={profile?.isGuest === false ? "dialog" : undefined}
            className={styles.profileButton}
            disabled={!profile || profile.isGuest}
            onClick={() => {
              if (profile?.isGuest === false) {
                setProofPickerOpen(false);
                setMediaPickerOpen(false);
                setProfileOpen(!profileOpen);
              }
            }}
            ref={profileButtonRef}
            type="button"
          >
            {profile ? (
              <Plus aria-hidden="true" size={20} />
            ) : (
              <UserRound aria-hidden="true" size={18} />
            )}
          </button>
          {profile && !profile.isGuest ? (
            <ChatNameSetup
              isOpen={profileOpen}
              onAvatarChange={onProfileAvatarChange}
              onDismiss={() => {
                setProfileOpen(false);
              }}
              onPresenceSettingChange={onPresenceSettingChange}
              onSave={async (nextProfile) => {
                return onProfileSave(nextProfile);
              }}
              openerRef={profileButtonRef}
              presenceSettingBusy={presenceSettingBusy}
              profile={profile}
              showPresence={showPresence}
            />
          ) : null}
        </div>

        <div className={styles.composerSurface}>
          <label
            className={styles.messageField}
            data-has-value={body.length > 0}
          >
            <span className={styles.visuallyHidden}>Message</span>
            <textarea
              aria-describedby="live-room-composer-help"
              disabled={disabled || sending}
              maxLength={LIVE_ROOM_MESSAGE_MAX_LENGTH + 80}
              onChange={(event) => onBodyChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  requestSend();
                }
              }}
              placeholder={
                replyPreview
                  ? `Reply to ${formatPublicChatName(
                      replyPreview.authorDisplayName,
                    )}…`
                  : placeholder
              }
              ref={textareaRef}
              rows={1}
              value={body}
            />
            <small>
              {body.length}/{LIVE_ROOM_MESSAGE_MAX_LENGTH}
            </small>
          </label>
          <div className={styles.composerBrokeragePicker}>
            <BrokerageEvidencePicker
              isOpen={proofPickerOpen}
              loginHref={loginHref}
              onChange={onProofChange}
              onOpenChange={handleProofPickerOpenChange}
              placement="composer"
              value={proof}
            />
          </div>
          <KlipyPicker
            disabled={disabled || sending}
            isOpen={mediaPickerOpen}
            isGuest={profile?.isGuest !== false}
            loginHref={loginHref}
            onOpenChange={handleMediaPickerOpenChange}
            onSelect={onMediaChange}
          />
          <button
            aria-label="Send message"
            className={styles.sendButton}
            disabled={disabled || sending}
            onClick={requestSend}
            type="button"
          >
            <Send aria-hidden="true" size={17} />
            <span>{sending ? "Sending…" : "Send"}</span>
          </button>
        </div>
      </div>

      <div className={styles.composerMeta}>
        <span className={styles.visuallyHidden} id="live-room-composer-help">
          Enter to send. Shift+Enter for a new line.
        </span>
        {decision && !decision.allowed ? (
          <span
            aria-live="polite"
            className={styles.moderationError}
            role="alert"
          >
            {decision.message}
          </span>
        ) : null}
      </div>
      <LiveRoomDisclosureNotice />
    </div>
  );
}
