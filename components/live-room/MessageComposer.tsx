"use client";

import {
  CalendarDays,
  DoorOpen,
  FileText,
  LayoutGrid,
  MessageCircle,
  Send,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { BottomSheetShell } from "@/components/ui/BottomSheetShell";
import { MemberAvatar } from "@/components/ui/MemberAvatar";
import { MemberPlanBadge } from "@/components/ui/MemberPlanBadge";
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
  mobileRoomMenuOpenerRef?: RefObject<HTMLButtonElement | null>;
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
  onMobileSectionChange?: (section: MobileLiveRoomSection) => void;
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

export type MobileLiveRoomSection =
  | "chat"
  | "posts"
  | "events"
  | "members"
  | "rooms";

const mobileRoomMenuItems = [
  { icon: MessageCircle, label: "Chat", value: "chat" },
  { icon: FileText, label: "Posts", value: "posts" },
  { icon: CalendarDays, label: "Events", value: "events" },
  { icon: Users, label: "Members", value: "members" },
  { icon: DoorOpen, label: "Rooms", value: "rooms" },
] as const;

export function MessageComposer({
  body,
  decision,
  disabled,
  eventReference,
  focusRequestId = 0,
  loginHref,
  mobileRoomMenuOpenerRef,
  onBodyChange,
  onClearReference,
  onCancelReply,
  onProfileAvatarChange,
  onProfileSave,
  onPresenceSettingChange,
  onMediaChange,
  onMobileSectionChange,
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
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  const handleProofPickerOpenChange = useCallback(
    (nextOpen: boolean) => {
      setProofPickerOpen(nextOpen);
      if (nextOpen) {
        setMediaPickerOpen(false);
        setRoomMenuOpen(false);
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
        setRoomMenuOpen(false);
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
    setRoomMenuOpen(false);
  }, [profileOpen]);

  const handleMobileSectionChange = (section: MobileLiveRoomSection) => {
    setRoomMenuOpen(false);
    window.requestAnimationFrame(() => onMobileSectionChange?.(section));
  };

  return (
    <div
      className={styles.composer}
      data-mobile-room-menu={onMobileSectionChange ? "true" : undefined}
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
                setRoomMenuOpen(false);
                setProfileOpen(!profileOpen);
              }
            }}
            ref={profileButtonRef}
            type="button"
          >
            {profile ? (
              <>
                <MemberAvatar
                  displayName={profile.displayName || "?"}
                  imageUrl={profile.avatarUrl}
                  size="small"
                />
                <span>
                  <strong>
                    {formatPublicChatName(profile.displayName)}
                  </strong>
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

        <label
          className={styles.messageField}
          data-has-value={body.length > 0}
        >
          <span className={styles.visuallyHidden}>Message</span>
          <textarea
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
        <div className={styles.desktopBrokeragePicker}>
          <BrokerageEvidencePicker
            isOpen={proofPickerOpen}
            loginHref={loginHref}
            onChange={onProofChange}
            onOpenChange={handleProofPickerOpenChange}
            placement="composer"
            value={proof}
          />
        </div>
        {onMobileSectionChange && mobileRoomMenuOpenerRef ? (
          <button
            aria-controls="live-room-mobile-room-menu"
            aria-expanded={roomMenuOpen}
            aria-haspopup="dialog"
            aria-label="Open Room menu"
            className={styles.roomMenuButton}
            onClick={() => {
              const nextOpen = !roomMenuOpen;
              setRoomMenuOpen(nextOpen);
              if (nextOpen) {
                setProofPickerOpen(false);
                setMediaPickerOpen(false);
                setProfileOpen(false);
              }
            }}
            ref={mobileRoomMenuOpenerRef}
            type="button"
          >
            <LayoutGrid aria-hidden="true" size={20} />
          </button>
        ) : null}
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
      <LiveRoomDisclosureNotice hideOnMobile={Boolean(onMobileSectionChange)} />
      {onMobileSectionChange && mobileRoomMenuOpenerRef ? (
        <BottomSheetShell
          aria-label="Room menu"
          closeLabel="Close Room menu"
          id="live-room-mobile-room-menu"
          isOpen={roomMenuOpen}
          layout="full-scroll"
          onDismiss={() => setRoomMenuOpen(false)}
          openerRef={mobileRoomMenuOpenerRef}
          overlayLabel="Close Room menu"
          viewport="mobile"
        >
          <div className={styles.roomMenuSheet}>
            <header className={styles.roomMenuHeading}>
              <h2>Room menu</h2>
              <p>Browse this room or add verified trading evidence.</p>
            </header>
            <nav aria-label="Room sections" className={styles.roomMenuSections}>
              {mobileRoomMenuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    aria-current={item.value === "chat" ? "page" : undefined}
                    className={
                      item.value === "chat"
                        ? styles.roomMenuActiveItem
                        : undefined
                    }
                    key={item.value}
                    onClick={() => handleMobileSectionChange(item.value)}
                    type="button"
                  >
                    <Icon aria-hidden="true" size={18} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className={styles.roomMenuBrokerage}>
              <BrokerageEvidencePicker
                loginHref={loginHref}
                onChange={onProofChange}
                placement="room-menu"
                value={proof}
              />
            </div>
          </div>
        </BottomSheetShell>
      ) : null}
    </div>
  );
}
