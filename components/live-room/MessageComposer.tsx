"use client";

import { Send, UserRound, X } from "lucide-react";
import {
  LIVE_ROOM_MESSAGE_MAX_LENGTH,
  type ModerationDecision,
} from "@/lib/live-room/moderation";
import { getPlanDisplayName } from "@/lib/subscriptionPolicy";
import type {
  CompanyEventReference,
  LiveRoomProfile,
} from "@/lib/live-room/types";
import styles from "./LiveRoom.module.css";

const profileEmojis = ["👋", "🦊", "🐻", "🦉", "🚀", "🧭", "📊", "🌱"];

type MessageComposerProps = {
  body: string;
  decision: ModerationDecision | null;
  disabled: boolean;
  eventReference: CompanyEventReference | null;
  onBodyChange: (body: string) => void;
  onClearReference: () => void;
  onProfileChange: (profile: LiveRoomProfile) => void;
  onPresenceSettingChange: (showPresence: boolean) => void;
  onSend: () => void;
  profile: LiveRoomProfile | null;
  profileOpen: boolean;
  presenceSettingBusy: boolean;
  sending: boolean;
  setProfileOpen: (open: boolean) => void;
  showPresence: boolean | null;
};

export function MessageComposer({
  body,
  decision,
  disabled,
  eventReference,
  onBodyChange,
  onClearReference,
  onProfileChange,
  onPresenceSettingChange,
  onSend,
  profile,
  profileOpen,
  presenceSettingBusy,
  sending,
  setProfileOpen,
  showPresence,
}: MessageComposerProps) {
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
                  <small>
                    {profile.isGuest ? "Guest" : "Member"} ·{" "}
                    {getPlanDisplayName(profile.plan)}
                  </small>
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
              <small>
                {profile.isGuest
                  ? "Saved to this browser’s secure guest session."
                  : "Saved to your member profile."}
              </small>
            </div>
          ) : null}
        </div>

        <label className={styles.messageField}>
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
            placeholder="Share a company view…"
            rows={2}
            value={body}
          />
          <small>
            {body.length}/{LIVE_ROOM_MESSAGE_MAX_LENGTH}
          </small>
        </label>
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
        <span
          aria-live="polite"
          className={
            decision && !decision.allowed ? styles.moderationError : undefined
          }
        >
          {decision && !decision.allowed
            ? decision.message
            : "Server moderation is enforced when you send."}
        </span>
      </div>
    </div>
  );
}
