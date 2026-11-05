"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * A message the studio is about to send somebody, ready to copy.
 *
 * The same shape the cash receipt uses: the finished wording in a box, and a button that copies it.
 * A textarea rather than a paragraph, and deliberately — the message goes into WhatsApp, so somebody
 * will want to change a word before sending, and selecting text by hand has to work where the
 * clipboard API does not (plain http, which is where `copyToClipboard` falls back).
 *
 * Editing here changes what is copied and nothing else. Nothing about the record is rewritten by
 * what somebody types into this box.
 *
 * ── Sending it, where the screen can ──────────────────────────────────────────────────────────
 *
 * The box owns the wording and **publishes** it through `onTextChange`, rather than carrying a Send
 * button of its own. A dialog's actions belong in its footer, beside Close and Send Invite, where
 * the reader already looks for what to do next - and a footer is a sibling of this component, not
 * something it can render into. So the caller draws the button and this hands it the text.
 *
 * Published on every edit **and** when the message it was opened with arrives or changes, so a
 * footer button is never holding wording the box has moved on from. A caller that passes nothing
 * gets exactly the control this has always been, which is why the screens that only copy are
 * untouched.
 */
export default function ShareableMessage({ label = "Message", message, rows = 8, className = "", onTextChange }) {
  const [text, setText] = useState(message || "");
  const [copied, setCopied] = useState(false);

  // The message is built from what was just created, which can arrive a moment after this renders.
  // Published as it lands too, or a footer button would hold the empty string it was mounted with.
  useEffect(() => { setText(message || ""); setCopied(false); onTextChange?.(message || ""); }, [message, onTextChange]);

  async function copy() {
    const done = await copyToClipboard(text);
    setCopied(done);
    // Said and then forgotten, so a second copy says it again rather than sitting there confirming
    // something from a minute ago.
    if (done) window.setTimeout(() => setCopied(false), 2500);
  }

  return <div className={className}>
    {/* Wraps at 360px, where a long label and Copy do not sit on one line. */}
    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11px] font-semibold text-slate-600 sm:text-xs">{label}</span>
      <Button type="button" size="sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy message"}</Button>
    </div>
    <textarea
      value={text}
      onChange={(event) => { setText(event.target.value); setCopied(false); onTextChange?.(event.target.value); }}
      rows={rows}
      aria-label={label}
      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
    />
  </div>;
}
