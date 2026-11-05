"use client";

import CheckCircleOutlined from "@mui/icons-material/CheckCircleOutlined";
import ErrorOutlineOutlined from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlined from "@mui/icons-material/InfoOutlined";
import WarningAmberOutlined from "@mui/icons-material/WarningAmberOutlined";

/**
 * A message that belongs **beside the thing it is about** - under a field, inside a row, at the top
 * of a card - rather than floating over the screen as `FloatingNotice` does.
 *
 * The two are not the same job. A floating notice is for something that has just happened and will
 * be dismissed ("Saved"); this is for a state that is **still true** while it is read: why a send
 * failed, what an approver will do next, that somebody was invited rather than added. It stays until
 * the state changes.
 *
 * It exists because the same three lines of Tailwind were typed in more than fifty files, each with
 * its own tint, padding and text size, and a reader met a slightly different-looking message every
 * time. The tones are the four the app already used:
 *
 *   - `error` - it did not happen, and something has to be done;
 *   - `warning` - it happened differently, or will;
 *   - `success` - it happened;
 *   - `info` - what will happen, or how this works.
 *
 * **The colours are the plain Tailwind names on purpose.** `globals.css` repaints exactly those for
 * the dark appearances; a tint written with an opacity modifier (`bg-rose-50/70`) is a different
 * class as far as CSS is concerned, the dark rules miss it, and the block stays pastel with light
 * text on it.
 *
 * `role` follows the tone - an error announces itself to a screen reader, the rest are polite - and
 * can be overridden for a message that is read on arrival rather than when it changes.
 */
const TONES = {
  error: { className: "border-rose-200 bg-rose-50 text-rose-700", Icon: ErrorOutlineOutlined, role: "alert" },
  warning: { className: "border-amber-200 bg-amber-50 text-amber-800", Icon: WarningAmberOutlined, role: "status" },
  success: { className: "border-emerald-200 bg-emerald-50 text-emerald-700", Icon: CheckCircleOutlined, role: "status" },
  info: { className: "border-slate-200 bg-slate-50 text-slate-600", Icon: InfoOutlined, role: "status" },
};

const SIZES = {
  sm: { box: "px-2.5 py-1.5 text-xs", icon: 14 },
  md: { box: "px-3 py-2 text-xs sm:text-sm", icon: 16 },
};

/**
 * `tone` picks the colour and the icon; `size` is `sm` for a line inside a row and `md` for a block
 * of its own. `action` sits at the end - a Retry, a "Try again" - and keeps its own colour, since it
 * is a control rather than part of the sentence. `icon={false}` drops the icon for a message short
 * enough to read without one.
 */
export default function InlineAlert({ tone = "info", size = "md", children, action = null, icon = true, role, className = "" }) {
  if (!children) return null;
  const { className: toneClass, Icon, role: toneRole } = TONES[tone] || TONES.info;
  const { box, icon: iconSize } = SIZES[size] || SIZES.md;
  return <p role={role || toneRole} className={`flex items-start gap-1.5 rounded-lg border ${toneClass} ${box} ${className}`}>
    {icon && <Icon aria-hidden="true" sx={{ fontSize: iconSize }} className="mt-px shrink-0" />}
    {/* `min-w-0` so a long reason wraps inside the block rather than stretching the row it sits in. */}
    <span className="min-w-0 flex-1 break-words">{children}</span>
    {action && <span className="-my-0.5 shrink-0">{action}</span>}
  </p>;
}
