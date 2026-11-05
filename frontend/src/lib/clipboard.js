/**
 * Puts text on the clipboard, and says whether it got there.
 *
 * The async Clipboard API is only available over https and on localhost, so a studio running the
 * OS over plain http on the VPS would silently get nothing from it. The textarea fallback is
 * deprecated but is the only thing that works there, and a value the reader is shown but cannot
 * copy defeats the point of showing it.
 *
 * It returns a boolean rather than throwing because every caller has the same two things to say -
 * "copied" or "copy that by hand, here it is" - and neither is an error worth a stack trace.
 */
export async function copyToClipboard(text) {
  const value = String(text ?? "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the textarea below: the API exists but was refused, which happens when the
    // page is not the focused document or the browser denied permission.
  }
  try {
    const holder = document.createElement("textarea");
    holder.value = value;
    holder.setAttribute("readonly", "");
    holder.style.position = "fixed";
    holder.style.opacity = "0";
    document.body.appendChild(holder);
    holder.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(holder);
    return copied;
  } catch {
    return false;
  }
}
