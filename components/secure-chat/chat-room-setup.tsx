"use client";

import { useState } from "react";

export function ChatInviteLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return <div className="chat-invite-card"><p className="chat-eyebrow">INVITE A FRIEND</p><p>Share this link. Your friend creates a key and joins.</p><label>Private invitation link<input readOnly value={link} onFocus={event => event.target.select()} /></label><button type="button" className="chat-button" onClick={async () => { try { await navigator.clipboard.writeText(link); setCopied(true); setFailed(false); } catch { setFailed(true); } }}>{copied ? "✓ LINK COPIED" : "COPY INVITATION ↗"}</button>{failed && <p role="status">Select the link above and copy it manually.</p>}<small>Anyone with this link can join until the room expires. Earlier messages stay encrypted to their original recipients.</small></div>;
}
