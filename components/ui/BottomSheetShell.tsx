"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import styles from "./BottomSheetShell.module.css";

type BottomSheetAccessibleName =
  | {
      "aria-label": string;
      "aria-labelledby"?: never;
    }
  | {
      "aria-label"?: never;
      "aria-labelledby": string;
    };

export type BottomSheetShellLayout = "content-footer" | "full-scroll";
export type BottomSheetShellViewport = "mobile" | "tablet" | "intermediate" | "all";

export type BottomSheetShellProps = BottomSheetAccessibleName & {
  children: ReactNode;
  closeLabel: string;
  fixedFooter?: ReactNode;
  id?: string;
  isOpen: boolean;
  layout: BottomSheetShellLayout;
  onDismiss: () => void;
  openerRef: RefObject<HTMLElement | null>;
  overlayLabel: string;
  showCloseButton?: boolean;
  showHandle?: boolean;
  surfaceClassName?: string;
  topControls?: ReactNode;
  viewport?: BottomSheetShellViewport;
};

const focusableSelector = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function isAvailableFocusTarget(element: HTMLElement) {
  if (!element.isConnected || element.closest("[hidden], [inert], [aria-hidden='true']")) {
    return false;
  }

  if (
    element.matches(":disabled, [aria-disabled='true']") ||
    window.getComputedStyle(element).display === "none" ||
    window.getComputedStyle(element).visibility === "hidden"
  ) {
    return false;
  }

  return element.getClientRects().length > 0;
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    isAvailableFocusTarget,
  );
}

function restoreFocus(opener: HTMLElement | null) {
  if (opener && isAvailableFocusTarget(opener)) {
    opener.focus({ preventScroll: true });
    return;
  }

  const fallback = document.querySelector<HTMLElement>("main, [role='main']");
  if (!fallback || !isAvailableFocusTarget(fallback)) {
    return;
  }

  const previousTabIndex = fallback.getAttribute("tabindex");
  fallback.tabIndex = -1;
  fallback.focus({ preventScroll: true });

  if (previousTabIndex === null) {
    fallback.removeAttribute("tabindex");
  } else {
    fallback.setAttribute("tabindex", previousTabIndex);
  }
}

export function BottomSheetShell(props: BottomSheetShellProps) {
  const {
    children,
    closeLabel,
    fixedFooter,
    id,
    isOpen,
    layout,
    onDismiss,
    openerRef,
    overlayLabel,
    showCloseButton = true,
    showHandle = true,
    surfaceClassName,
    topControls,
    viewport = "mobile",
  } = props;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLButtonElement>(null);
  const overlayPointerStartedRef = useRef(false);
  const surfaceRef = useRef<HTMLElement>(null);
  const dismissPendingRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const requestDismiss = useCallback(() => {
    if (dismissPendingRef.current) {
      return;
    }

    dismissPendingRef.current = true;
    onDismissRef.current();
  }, []);

  useEffect(() => {
    const viewportQuery =
      viewport === "all"
        ? "(min-width: 0px)"
        : viewport === "intermediate"
          ? "(min-width: 761px) and (max-width: 959.98px)"
          : viewport === "tablet"
            ? "(max-width: 1180px)"
          : "(max-width: 760.98px)";

    if (!isOpen || !window.matchMedia(viewportQuery).matches) {
      dismissPendingRef.current = false;
      return;
    }

    dismissPendingRef.current = false;
    const opener = openerRef.current;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) {
        return;
      }

      if (event.key === "Escape") {
        if (event.repeat) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        requestDismiss();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const surface = surfaceRef.current;
      if (!surface) {
        return;
      }

      const focusableElements = getFocusableElements(surface);
      if (focusableElements.length === 0) {
        event.preventDefault();
        surface.focus({ preventScroll: true });
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (!surface.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? lastFocusable : firstFocusable).focus({ preventScroll: true });
        return;
      }

      if (activeElement === surface) {
        event.preventDefault();
        (event.shiftKey ? lastFocusable : firstFocusable).focus({ preventScroll: true });
        return;
      }

      if (event.shiftKey && activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus({ preventScroll: true });
      } else if (!event.shiftKey && activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus({ preventScroll: true });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const initialFocus =
      layout === "full-scroll" || !showCloseButton
        ? surfaceRef.current
        : closeButtonRef.current ?? surfaceRef.current;
    initialFocus?.focus({ preventScroll: true });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;

      requestAnimationFrame(() => {
        const anotherModalIsOpen = document.querySelector('[role="dialog"][aria-modal="true"]');

        if (!anotherModalIsOpen) {
          restoreFocus(opener);
        }
      });
    };
  }, [isOpen, layout, openerRef, requestDismiss, showCloseButton, viewport]);

  if (!isOpen) {
    return null;
  }

  const ariaLabel = "aria-label" in props ? props["aria-label"] : undefined;
  const ariaLabelledBy = "aria-labelledby" in props ? props["aria-labelledby"] : undefined;
  const usesContentFooter = layout === "content-footer";
  const viewportClass =
    viewport === "all"
      ? styles.allRoot
      : viewport === "intermediate"
        ? styles.intermediateRoot
        : viewport === "tablet"
        ? styles.tabletRoot
        : styles.mobileRoot;
  const rootClasses = `${styles.root} ${viewportClass} ${usesContentFooter ? styles.contentFooterRoot : styles.fullScrollRoot}`;
  const overlayClasses = `${styles.overlay} ${usesContentFooter ? styles.contentFooterOverlay : styles.fullScrollOverlay}`;
  const surfaceClasses = `${styles.surface} ${usesContentFooter ? styles.contentFooterSurface : styles.fullScrollSurface} ${fixedFooter ? styles.surfaceWithFixedFooter : ""} ${topControls ? styles.surfaceWithTopControls : ""} ${surfaceClassName ?? ""}`;
  const closeClasses = `${styles.close} ${usesContentFooter ? styles.contentFooterClose : styles.fullScrollClose}`;
  const closeButton = showCloseButton ? (
    <button
      aria-label={closeLabel}
      className={closeClasses}
      onClick={requestDismiss}
      ref={closeButtonRef}
      type="button"
    >
      <X aria-hidden="true" size={18} />
    </button>
  ) : null;

  return (
    <div
      className={rootClasses}
      onPointerDownCapture={(event) => {
        overlayPointerStartedRef.current = event.target === overlayRef.current;
      }}
    >
      <button
        aria-label={overlayLabel}
        className={overlayClasses}
        onClick={(event) => {
          const keyboardActivation = event.detail === 0;
          const directOverlayActivation =
            overlayPointerStartedRef.current && event.target === event.currentTarget;
          overlayPointerStartedRef.current = false;

          if (keyboardActivation || directOverlayActivation) {
            requestDismiss();
          }
        }}
        ref={overlayRef}
        type="button"
      />
      <section
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-modal="true"
        className={surfaceClasses}
        data-sr-bottom-sheet-layout={layout}
        data-sr-bottom-sheet-viewport={viewport}
        id={id}
        ref={surfaceRef}
        role="dialog"
        tabIndex={-1}
      >
        {topControls ? (
          <div aria-label="Preview controls" className={styles.controlStrip} role="group">
            {showHandle ? <div aria-hidden="true" className={styles.handle} /> : null}
            <div className={styles.controlStripActions}>
              {topControls}
              {closeButton}
            </div>
          </div>
        ) : (
          <>
            {showHandle ? <div aria-hidden="true" className={styles.handle} /> : null}
            {closeButton}
          </>
        )}
        {fixedFooter ? (
          <>
            <div className={styles.footerScrollRegion}>{children}</div>
            <div className={styles.fixedFooter}>{fixedFooter}</div>
          </>
        ) : topControls ? (
          <div className={styles.topControlsScrollRegion}>{children}</div>
        ) : (
          children
        )}
      </section>
    </div>
  );
}
