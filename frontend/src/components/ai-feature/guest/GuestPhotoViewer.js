"use client";
import { useEffect, useRef, useState } from "react";
import Download from "@mui/icons-material/Download";
import IosShare from "@mui/icons-material/IosShare";
import PersonOff from "@mui/icons-material/PersonOff";
import Lightbox from "@/components/ai-feature/shared/Lightbox";
import { downloadGuestPhoto, photoBaseName, shareGuestLink } from "./guestActions";

const ACTION = "inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/10 px-4 text-sm font-medium text-white transition hover:bg-white/20 disabled:opacity-50";

/**
 * The lightbox over a list, with the things a guest may do to the picture under it: save it
 * when the event allows downloads, share the event's link when it allows sharing, and on My
 * Photos say this is not them. Paging runs through the list it was opened from; reaching its end
 * asks the list for more.
 */
export default function GuestPhotoViewer({ items, index, total, onIndexChange, onClose, eventName, allowSharing, onNotMe, onNeedMore, hasMore, notify }) {
  const [busy, setBusy] = useState("");
  // Set when Next is pressed on the last loaded picture: the list is asked for another page, and
  // the viewer steps forward the moment it arrives. A ref, so waiting is not a render of its own.
  const advance = useRef(false);
  useEffect(() => { if (advance.current && items.length > index + 1) { advance.current = false; onIndexChange(index + 1); } }, [index, items.length, onIndexChange]);
  const item = items[index];
  if (!item) return null;
  const hasPrev = index > 0; const hasNext = index < items.length - 1 || hasMore;
  function next() { if (index < items.length - 1) onIndexChange(index + 1); else if (hasMore) { advance.current = true; onNeedMore?.(); } }
  async function save() {
    setBusy("download");
    try { const outcome = await downloadGuestPhoto(item, photoBaseName(eventName, index)); if (outcome === "opened") notify?.("The photo opened in a new tab - save it from there."); }
    catch (error) { notify?.(error.message || "Could not download the photo.", "error"); }
    finally { setBusy(""); }
  }
  async function share() {
    setBusy("share");
    const outcome = await shareGuestLink(eventName);
    if (outcome === "copied") notify?.("Link copied.", "success");
    if (outcome === "failed") notify?.("Could not copy the link. Copy it from the address bar.", "error");
    setBusy("");
  }
  async function notMe() {
    setBusy("reject");
    // A refusal has already been said by the caller; the viewer only has to stop waiting.
    try { await onNotMe(item); } catch { /* reported by the caller */ } finally { setBusy(""); }
  }
  return <Lightbox src={item.previewUrl || item.thumbnailUrl} alt={`Photo ${index + 1}`} onClose={onClose} onPrev={() => hasPrev && onIndexChange(index - 1)} onNext={next} hasPrev={hasPrev} hasNext={hasNext} caption={`${index + 1} of ${total || items.length}`}>
    {item.downloadUrl && <button type="button" onClick={save} disabled={Boolean(busy)} className={ACTION}><Download style={{ fontSize: 18 }} aria-hidden="true" />{busy === "download" ? "Saving..." : "Download"}</button>}
    {allowSharing && <button type="button" onClick={share} disabled={Boolean(busy)} className={ACTION}><IosShare style={{ fontSize: 18 }} aria-hidden="true" />Share</button>}
    {onNotMe && <button type="button" onClick={notMe} disabled={Boolean(busy)} className={ACTION}><PersonOff style={{ fontSize: 18 }} aria-hidden="true" />{busy === "reject" ? "Removing..." : "This is not me"}</button>}
  </Lightbox>;
}
