// The session owns this loop, not a visible React component. Hidden pages still
// admit guests. Browser/OS suspension can delay timers; wake events catch up.
export function startChatPolling(poll: () => Promise<void>, interval = 2000, events?: { window: EventTarget; document: EventTarget }) {
  let stopped = false, running = false;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    if (stopped || running) return;
    clearTimeout(timer); running = true;
    try { await poll(); } catch { /* The session retains its connection error for the UI. */ }
    finally { running = false; if (!stopped) timer = setTimeout(tick, interval); }
  };
  const wake = () => { void tick(); };
  timer = setTimeout(tick, 0);
  events?.window.addEventListener("online", wake);
  events?.window.addEventListener("focus", wake);
  events?.document.addEventListener("visibilitychange", wake);
  return () => {
    stopped = true; clearTimeout(timer);
    events?.window.removeEventListener("online", wake);
    events?.window.removeEventListener("focus", wake);
    events?.document.removeEventListener("visibilitychange", wake);
  };
}
