"use client";

import {
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Share2,
  X as CloseIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  LIVE_ROOM_SHARE_PLATFORMS,
  canUseLiveRoomNativeShare,
  copyLiveRoomInvite,
  createLiveRoomInviteShareDataForRoom,
  openLiveRoomPlatformIntent,
  shareLiveRoomInviteNatively,
  shareLiveRoomInviteToInstagram,
  type LiveRoomInviteActionResult,
  type LiveRoomInviteRoom,
  type LiveRoomInviteShareData,
  type LiveRoomSharePlatform,
} from "@/lib/live-room/inviteShare";
import styles from "./LiveRoomInviteMenu.module.css";

const PLATFORM_LABELS: Record<LiveRoomSharePlatform, string> = {
  facebook: "Facebook",
  linkedin: "LinkedIn",
  reddit: "Reddit",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  x: "X",
};

export function LiveRoomInviteMenu({
  ariaLabel,
  room,
}: {
  ariaLabel: string;
  room: LiveRoomInviteRoom;
}) {
  const generatedId = useId().replaceAll(":", "");
  const panelId = `live-room-invite-${generatedId}`;
  const titleId = `${panelId}-title`;
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [nativeShareAvailable, setNativeShareAvailable] =
    useState(false);
  const [shareData, setShareData] =
    useState<LiveRoomInviteShareData | null>(null);
  const [status, setStatus] = useState<{
    message: string;
    tone: "error" | "neutral";
  } | null>(null);

  const closeMenu = useCallback(() => {
    setIsOpen(false);
    setBusy(false);
    setStatus(null);
    window.requestAnimationFrame(() =>
      triggerRef.current?.focus({ preventScroll: true }),
    );
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    const locksPageScroll = window.matchMedia(
      "(max-width: 760px)",
    ).matches;
    const previousBodyOverflow = document.body.style.overflow;
    if (locksPageScroll) {
      document.body.style.overflow = "hidden";
    }
    const focusFrame = window.requestAnimationFrame(() =>
      firstActionRef.current?.focus({ preventScroll: true }),
    );
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        closeMenu();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ),
      ).filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      if (locksPageScroll) {
        document.body.style.overflow = previousBodyOverflow;
      }
    };
  }, [closeMenu, isOpen]);

  const openMenu = () => {
    if (isOpen) {
      closeMenu();
      return;
    }
    const nextShareData = createLiveRoomInviteShareDataForRoom(
      room,
      window.location.href,
    );
    setShareData(nextShareData);
    setNativeShareAvailable(
      Boolean(
        nextShareData &&
          canUseLiveRoomNativeShare(nextShareData),
      ),
    );
    setStatus(
      nextShareData
        ? null
        : {
            message: "This room link is unavailable.",
            tone: "error",
          },
    );
    setIsOpen(true);
  };

  const runAction = async (
    action: () => Promise<LiveRoomInviteActionResult>,
    platformLabel?: string,
  ) => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await action();
      setStatus(getInviteStatus(result, platformLabel));
    } catch {
      setStatus(getInviteStatus("error"));
    } finally {
      setBusy(false);
    }
  };

  const sharePlatform = (
    platform: LiveRoomSharePlatform,
  ) => {
    if (!shareData) return;
    void runAction(
      () =>
        openLiveRoomPlatformIntent({
          platform,
          shareData,
        }),
      PLATFORM_LABELS[platform],
    );
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        aria-controls={panelId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={ariaLabel}
        className={styles.trigger}
        onClick={openMenu}
        ref={triggerRef}
        type="button"
      >
        <Share2 aria-hidden="true" size={15} />
        <span>Invite</span>
      </button>

      {isOpen ? (
        <>
          <button
            aria-label="Close room sharing"
            className={styles.backdrop}
            onClick={closeMenu}
            type="button"
          />
          <section
            aria-labelledby={titleId}
            aria-modal="true"
            className={styles.panel}
            id={panelId}
            ref={panelRef}
            role="dialog"
          >
            <header>
              <div>
                <strong id={titleId}>Share this room</strong>
                <small>Public room link — no sign-in required</small>
              </div>
              <button
                aria-label="Close room sharing"
                className={styles.closeButton}
                onClick={closeMenu}
                type="button"
              >
                <CloseIcon aria-hidden="true" />
              </button>
            </header>

            <div className={styles.options}>
              {LIVE_ROOM_SHARE_PLATFORMS.map((platform, index) => (
                <button
                  aria-label={`Share this room on ${PLATFORM_LABELS[platform]}`}
                  className={styles.option}
                  data-platform={platform}
                  disabled={busy || !shareData}
                  key={platform}
                  onClick={() => sharePlatform(platform)}
                  ref={index === 0 ? firstActionRef : undefined}
                  type="button"
                >
                  <ExternalLink aria-hidden="true" />
                  <span>{PLATFORM_LABELS[platform]}</span>
                </button>
              ))}

              {nativeShareAvailable && shareData ? (
                <button
                  aria-label="Share this room with another app"
                  className={styles.option}
                  disabled={busy}
                  onClick={() =>
                    void runAction(() =>
                      shareLiveRoomInviteNatively({ shareData }),
                    )
                  }
                  type="button"
                >
                  <Share2 aria-hidden="true" />
                  <span>Share…</span>
                </button>
              ) : null}

              <button
                aria-label={
                  nativeShareAvailable
                    ? "Share this room to Instagram"
                    : "Copy this room link for Instagram"
                }
                className={styles.option}
                disabled={busy || !shareData}
                onClick={() => {
                  if (!shareData) return;
                  void runAction(() =>
                    shareLiveRoomInviteToInstagram({ shareData }),
                  );
                }}
                type="button"
              >
                <ImageIcon aria-hidden="true" />
                <span>
                  {nativeShareAvailable
                    ? "Share to Instagram"
                    : "Copy for Instagram"}
                </span>
              </button>

              <button
                aria-label="Copy this room link"
                className={styles.option}
                disabled={busy || !shareData}
                onClick={() => {
                  if (!shareData) return;
                  void runAction(() =>
                    copyLiveRoomInvite(shareData),
                  );
                }}
                type="button"
              >
                <Copy aria-hidden="true" />
                <span>Copy link</span>
              </button>
            </div>

            <p
              aria-live="polite"
              className={styles.status}
              data-tone={status?.tone || "neutral"}
              role="status"
            >
              {busy ? "Preparing share…" : status?.message || " "}
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}

function getInviteStatus(
  result: LiveRoomInviteActionResult,
  platformLabel?: string,
): { message: string; tone: "error" | "neutral" } {
  switch (result) {
    case "opened":
      return {
        message: `Opened ${platformLabel || "platform"} sharing.`,
        tone: "neutral",
      };
    case "shared":
      return { message: "Shared.", tone: "neutral" };
    case "cancelled":
      return { message: "Share cancelled.", tone: "neutral" };
    case "copied":
      return { message: "Link copied.", tone: "neutral" };
    case "instagram-copied":
      return {
        message: "Link copied. Paste it into Instagram.",
        tone: "neutral",
      };
    case "native-fallback-copied":
      return {
        message: "Share unavailable. Link copied instead.",
        tone: "neutral",
      };
    case "popup-fallback-copied":
      return {
        message: "Popup blocked. Link copied instead.",
        tone: "neutral",
      };
    case "error":
      return {
        message: "Sharing failed. Copy the room link and try again.",
        tone: "error",
      };
  }
}
