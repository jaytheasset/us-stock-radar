"use client";

import { BadgeCheck, Send, UserRound, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { MemberPlanBadge } from "@/components/ui/MemberPlanBadge";
import { BrokerageEvidencePicker } from "@/components/brokerage/BrokerageEvidencePicker";
import type { BrokerageProofSummary } from "@/lib/brokerage/types";
import {
  LIVE_ROOM_MESSAGE_MAX_LENGTH,
  type ModerationDecision,
} from "@/lib/live-room/moderation";
import type {
  CompanyEventReference,
  LiveRoomProfile,
  LiveRoomReplyPreview,
} from "@/lib/live-room/types";
import styles from "./LiveRoom.module.css";

const profileEmojis = ["👋", "🦊", "🐻", "🦉", "🚀", "🧭", "📊", "🌱"];

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
  onProfileChange: (profile: LiveRoomProfile) => void;
  onPresenceSettingChange: (showPresence: boolean) => void;
  onProofChange: (proof: BrokerageProofSummary | null) => void;
  onSend: () => void;
  profile: LiveRoomProfile | null;
  profileOpen: boolean;
  replyPreview: LiveRoomReplyPreview | null;
  placeholder?: string;
  presenceSettingBusy: boolean;
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
  onProfileChange,
  onPresenceSettingChange,
  onProofChange,
  onSend,
  profile,
  profileOpen,
  replyPreview,
  placeholder = "Share a company view…",
  presenceSettingBusy,
  proof,
  sending,
  setProfileOpen,
  showPresence,
}: MessageComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusRequestId > 0) textareaRef.current?.focus();
  }, [focusRequestId]);

  return (
    <div className={styles.composer}>
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
            Replying to {replyPreview.authorDisplayName}
          </span>
          <strong>{replyPreview.bodyPreview}</strong>
          <button
            aria-label="Cancel reply"
            onClick={onCancelReply}
            type="button"
          >
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}

      <div className={styles.composerRow}>
        <div className={styles.profileControl}>
          <button
            aria-label={
              profile
                ? `Edit Live Room profile: ${
                    profile.displayName.trim() ||
                    (profile.isGuest ? "Guest" : "Member")
                  }`
                : "Loading Live Room identity"
            }
            aria-expanded={profile ? profileOpen : false}
            aria-haspopup={profile ? "dialog" : undefined}
            className={styles.profileButton}
            disabled={!profile}
            onClick={() => {
              if (profile) setProfileOpen(!profileOpen);
            }}
            type="button"
          >
            {profile ? (
              <>
                <span aria-hidden="true">{profile.emoji}</span>
                <span>
                  <strong>{profile.displayName}</strong>
                  <MemberPlanBadge
                    plan={profile.isGuest ? "visitor" : profile.plan}
                  />
                </span>
              </>
            ) : (
              <>
                <span aria-hidden="true">
                  <UserRound size={18} />
                </span>
                <span>
                  <strong>Loading…</strong>
                  <small>Checking session</small>
                </span>
              </>
            )}
            {profile ? (
              <UserRound aria-hidden="true" size={14} />
            ) : null}
          </button>
          {profile && profileOpen ? (
            <div
              aria-label="Live Room profile picker"
              className={styles.profilePicker}
              role="dialog"
            >
              <strong>Live Room profile</strong>
              <label>
                Display name
                <input
                  maxLength={24}
                  onChange={(event) =>
                    onProfileChange({
                      ...profile,
                      displayName: event.target.value,
                    })
                  }
                  value={profile.displayName}
                />
              </label>
              <span>Choose an emoji</span>
              <div className={styles.emojiGrid}>
                {profileEmojis.map((emoji) => (
                  <button
                    aria-label={`Use ${emoji} profile`}
                    aria-pressed={profile.emoji === emoji}
                    key={emoji}
                    onClick={() => onProfileChange({ ...profile, emoji })}
                    type="button"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              {!profile.isGuest && showPresence !== null ? (
                <div className={styles.presenceSetting}>
                  <span>
                    <strong>Show when I&apos;m active in Live Rooms</strong>
                    <small>
                      Shows you online only in the company room you are
                      currently viewing.
                    </small>
                  </span>
                  <button
                    aria-checked={showPresence}
                    aria-label="Show when I am active in Live Rooms"
                    className={styles.presenceSwitch}
                    disabled={presenceSettingBusy}
                    onClick={() =>
                      onPresenceSettingChange(!showPresence)
                    }
                    role="switch"
                    type="button"
                  >
                    <span />
                  </button>
                </div>
              ) : null}
              <Link
                className={styles.creatorVerificationLink}
                href={
                  profile.isGuest
                    ? loginHref
                    : "/account/creator"
                }
              >
                <BadgeCheck aria-hidden="true" size={18} />
                <span>
                  <strong>
                    {profile.isGuest
                      ? "Sign in to apply"
                      : "Apply for creator verification"}
                  </strong>
                  <small>
                    Verify ownership of Instagram · X · YouTube.
                  </small>
                </span>
              </Link>
              <small>
                {profile.isGuest
                  ? "Saved to this browser’s secure guest session."
                  : "Saved to your member profile."}
              </small>
            </div>
          ) : null}
        </div>

        <label
          className={styles.messageField}
          data-has-value={body.length > 0}
        >
          <span className={styles.visuallyHidden}>Message</span>
          <textarea
            disabled={disabled}
            maxLength={LIVE_ROOM_MESSAGE_MAX_LENGTH + 80}
            onChange={(event) => onBodyChange(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                onSend();
              }
            }}
            placeholder={
              replyPreview
                ? `Reply to ${replyPreview.authorDisplayName}…`
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
        <BrokerageEvidencePicker
          loginHref={loginHref}
          onChange={onProofChange}
          placement="composer"
          value={proof}
        />
        <button
          aria-label="Send message"
          className={styles.sendButton}
          disabled={disabled || sending}
          onClick={onSend}
          type="button"
        >
          <Send aria-hidden="true" size={17} />
          <span>{sending ? "Sending…" : "Send"}</span>
        </button>
      </div>

      <div className={styles.composerMeta}>
        <span>Enter to send · Shift+Enter for a new line</span>
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
    </div>
  );
}
