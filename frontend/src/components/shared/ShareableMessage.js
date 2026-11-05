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
 */
export default function ShareableMessage({ label = "Message", message, rows = 8, className = "" }) {
  const [text, setText] = useState(message || "");
  const [copied, setCopied] = useState(false);

  // The message is built from what was just created, which can arrive a moment after this renders.
  useEffect(() => { setText(message || ""); setCopied(false); }, [message]);

  async function copy() {
    const done = await copyToClipboard(text);
    setCopied(done);
    // Said and then forgotten, so a second copy says it again rather than sitting there confirming
    // something from a minute ago.
    if (done) window.setTimeout(() => setCopied(false), 2500);
  }

  return <div className={className}>
    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
      <span className="text-[11px] font-semibold text-slate-600 sm:text-xs">{label}</span>
      <Button type="button" size="sm" onClick={() => void copy()}>{copied ? "Copied" : "Copy message"}</Button>
    </div>
    <textarea
      value={text}
      onChange={(event) => { setText(event.target.value); setCopied(false); }}
      rows={rows}
      aria-label={label}
      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
    />
  </div>;
}
