"use client";

import { animate } from "animejs";
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from "react";
import { useChatLanguage } from "./chat-language";

// Panels use native light dismissal. A context menu opens during pointerdown
// on some platforms, so its opening pointerup must not dismiss it again.
// Keep this UI lifecycle separate from the conversation/session lifecycle.
export function ChatPopover({ id, label, anchor, placement = "panel", onClose, children, className = "" }: {
  id: string; label: string; anchor: RefObject<HTMLElement | null>;
  placement?: "panel" | "message" | "emoji"; onClose: () => void;
  children: ReactNode; className?: string;
}) {
  const { language, t } = useChatLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; }, [onClose]);
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const trigger = anchor.current;
    const dismiss = () => closeRef.current();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.contains(event.target) && !trigger?.contains(event.target)) dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); trigger?.focus({ preventScroll: true }); }
    };
    // Manual message menus and automatic panels still share one open surface.
    document.dispatchEvent(new Event("chat-popover-opening"));
    document.addEventListener("chat-popover-opening", dismiss);
    if (placement === "message") {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", escape);
    }
    panel.showPopover({ source: trigger ?? undefined });
    const position = () => {
      const rect = trigger?.getBoundingClientRect();
      if (!rect || (placement === "panel" && matchMedia("(max-width: 600px)").matches)) {
        panel.style.removeProperty("left"); panel.style.removeProperty("top"); return;
      }
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 12, topEdge = (viewport?.offsetTop ?? 0) + 12;
      const right = leftEdge + (viewport?.width ?? innerWidth) - 24;
      const bottom = topEdge + (viewport?.height ?? innerHeight) - 24;
      const width = panel.offsetWidth, height = panel.offsetHeight;
      const above = placement !== "panel" && rect.top - height - 8 >= topEdge;
      panel.style.left = `${Math.max(leftEdge, Math.min(rect.right - width, right - width))}px`;
      panel.style.top = `${Math.max(topEdge, Math.min(above ? rect.top - height - 8 : rect.bottom + 8, bottom - height))}px`;
    };
    position();
    const observer = new ResizeObserver(position); observer.observe(panel);
    window.addEventListener("resize", position); window.visualViewport?.addEventListener("resize", position);
    // Move keyboard focus without scrolling the selected message out of view.
    panel.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
    const animation = !matchMedia("(prefers-reduced-motion: reduce)").matches
      ? animate(panel, { opacity: [0, 1], translateY: [6, 0], duration: 160, ease: "out(3)" }) : undefined;
    return () => {
      observer.disconnect(); animation?.cancel();
      document.removeEventListener("chat-popover-opening", dismiss);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", position); window.visualViewport?.removeEventListener("resize", position);
      if (panel.matches(":popover-open")) panel.hidePopover();
    };
  }, [anchor, placement]);
  const close = () => { onClose(); anchor.current?.focus({ preventScroll: true }); };
  return <div ref={ref} id={id} popover={placement === "message" ? "manual" : "auto"} role="dialog" aria-label={label} lang={language}
    className={`chat-popover chat-popover-${placement} ${className}`}
    onToggle={event => { if (event.newState === "closed") onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <header className="chat-popover-header"><strong>{label}</strong><button type="button" className="chat-popover-close" onClick={close} aria-label={t("Close", "Закрыть")}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></header>
    {children}
  </div>;
}
